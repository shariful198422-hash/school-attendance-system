const express = require('express');
const cors = require('cors');
require('dotenv').config();
const mysql = require('mysql2');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// ============================================================
// DATABASE CONNECTION
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'school_attendance',
    port: parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false
    }
});

console.log('📊 Database Configuration:');
console.log(`   Host: ${process.env.DB_HOST || 'localhost'}`);
console.log(`   User: ${process.env.DB_USER || 'root'}`);
console.log(`   Database: ${process.env.DB_NAME || 'school_attendance'}`);
console.log(`   Port: ${parseInt(process.env.DB_PORT) || 3306}`);

const promisePool = pool.promise();

// ============================================================
// USER LOGIN
// ============================================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const [rows] = await promisePool.query(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];

        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await promisePool.query(
            'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt]
        );

        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                assigned_class: user.assigned_class,
                assigned_section: user.assigned_section,
                assigned_branch: user.assigned_branch
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// VERIFY TOKEN
// ============================================================
app.post('/api/verify', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const [rows] = await promisePool.query(
            'SELECT * FROM sessions WHERE token = ? AND expires_at > NOW()',
            [token]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const [userRows] = await promisePool.query(
            'SELECT id, username, name, role, assigned_class, assigned_section, assigned_branch FROM users WHERE id = ?',
            [rows[0].user_id]
        );

        if (userRows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            user: userRows[0]
        });

    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// LOGOUT
// ============================================================
app.post('/api/logout', async (req, res) => {
    try {
        const { token } = req.body;

        if (token) {
            await promisePool.query(
                'DELETE FROM sessions WHERE token = ?',
                [token]
            );
        }

        res.json({ success: true, message: 'Logged out successfully' });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET FILTER OPTIONS - FIXED!
// ============================================================
app.get('/api/filters', async (req, res) => {
    try {
        const [branches] = await promisePool.query(
            'SELECT DISTINCT branch FROM students WHERE branch IS NOT NULL AND branch != "" ORDER BY branch'
        );
        const [classes] = await promisePool.query(
            'SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != "" ORDER BY class'
        );
        const [sections] = await promisePool.query(
            'SELECT DISTINCT section FROM students WHERE section IS NOT NULL AND section != "" ORDER BY section'
        );

        console.log('Branches found:', branches.length);
        console.log('Classes found:', classes.length);
        console.log('Sections found:', sections.length);

        res.json({
            branches: branches.map(b => b.branch),
            classes: classes.map(c => c.class),
            sections: sections.map(s => s.section)
        });
    } catch (error) {
        console.error('Error fetching filters:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET STUDENTS
// ============================================================
app.get('/api/students', async (req, res) => {
    try {
        const { class: className, section, branch } = req.query;

        let query = 'SELECT * FROM students WHERE 1=1';
        const params = [];

        if (className) {
            query += ' AND class = ?';
            params.push(className);
        }
        if (section) {
            query += ' AND section = ?';
            params.push(section);
        }
        if (branch) {
            query += ' AND branch = ?';
            params.push(branch);
        }

        query += ' ORDER BY name';

        const [rows] = await promisePool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ADD STUDENT
// ============================================================
app.post('/api/students/add', async (req, res) => {
    try {
        const { unique_id, student_code, name, class: className, section, branch, parent_mobile, parent_name } = req.body;

        if (!unique_id || !student_code || !name || !className) {
            return res.status(400).json({ error: 'Unique ID, Student code, name, and class are required' });
        }

        const [existingUnique] = await promisePool.query(
            'SELECT id FROM students WHERE unique_id = ?',
            [unique_id]
        );

        if (existingUnique.length > 0) {
            return res.status(400).json({ error: `Unique ID "${unique_id}" already exists` });
        }

        const [existingCode] = await promisePool.query(
            'SELECT id FROM students WHERE student_code = ?',
            [student_code]
        );

        if (existingCode.length > 0) {
            return res.status(400).json({ error: `Student code "${student_code}" already exists` });
        }

        const [result] = await promisePool.query(
            `INSERT INTO students 
             (unique_id, student_code, name, class, section, branch, parent_mobile, parent_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [unique_id, student_code, name, className, section || 'A', branch || 'Main', parent_mobile || '', parent_name || '']
        );

        res.json({
            success: true,
            message: `✅ Student "${name}" added successfully!`,
            id: result.insertId
        });

    } catch (error) {
        console.error('Error adding student:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// SAVE ATTENDANCE
// ============================================================
app.post('/api/attendance/save', async (req, res) => {
    try {
        const { 
            attendance, 
            date, 
            class: className, 
            section, 
            branch,
            teacherId 
        } = req.body;

        if (!attendance || attendance.length === 0) {
            return res.status(400).json({ error: 'No attendance data provided' });
        }

        const connection = await promisePool.getConnection();
        await connection.beginTransaction();

        let savedCount = 0;

        for (const record of attendance) {
            const [existing] = await connection.query(
                'SELECT id FROM attendance WHERE student_id = ? AND attendance_date = ?',
                [record.id, date]
            );

            if (existing.length > 0) {
                await connection.query(
                    `UPDATE attendance 
                     SET status = ?, class = ?, section = ?, branch = ?, teacher_id = ?
                     WHERE student_id = ? AND attendance_date = ?`,
                    [record.status, className, section, branch, teacherId, record.id, date]
                );
            } else {
                await connection.query(
                    `INSERT INTO attendance 
                     (student_id, attendance_date, status, class, section, branch, teacher_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [record.id, date, record.status, className, section, branch, teacherId]
                );
            }
            savedCount++;
        }

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `${savedCount} attendance records saved successfully`
        });

    } catch (error) {
        console.error('Error saving attendance:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// SAVE SMS LOGS
// ============================================================
app.post('/api/sms/save', async (req, res) => {
    try {
        const { smsLogs } = req.body;

        if (!smsLogs || smsLogs.length === 0) {
            return res.status(400).json({ error: 'No SMS logs provided' });
        }

        const connection = await promisePool.getConnection();
        await connection.beginTransaction();

        let savedCount = 0;

        for (const sms of smsLogs) {
            await connection.query(
                `INSERT INTO sms_logs 
                 (student_id, student_name, parent_mobile, status, message, delivered)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    sms.studentId,
                    sms.name,
                    sms.parent,
                    sms.status === 'Absent' ? 'A' : 'L',
                    `Alert: ${sms.name} was ${sms.status} on ${new Date().toLocaleDateString()}`,
                    true
                ]
            );
            savedCount++;
        }

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `${savedCount} SMS logs saved successfully`
        });

    } catch (error) {
        console.error('Error saving SMS logs:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// TEST DATABASE CONNECTION
// ============================================================
app.get('/api/test-db', async (req, res) => {
    try {
        const [result] = await promisePool.query('SELECT 1+1 AS result');
        res.json({ 
            success: true, 
            message: '✅ Database connected successfully!',
            result: result,
            config: {
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                database: process.env.DB_NAME || 'school_attendance',
                port: parseInt(process.env.DB_PORT) || 3306
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            config: {
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                database: process.env.DB_NAME || 'school_attendance',
                port: parseInt(process.env.DB_PORT) || 3306
            }
        });
    }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Database: ${process.env.DB_NAME || 'school_attendance'}`);
    console.log(`🗄️  Host: ${process.env.DB_HOST || 'localhost'}`);
});
