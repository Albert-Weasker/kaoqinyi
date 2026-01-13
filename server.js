const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const db = require('./config/database');
const attendanceRoutes = require('./routes/attendance');
const employeeRoutes = require('./routes/employee');
const rulesRoutes = require('./routes/rules');
const leaveRoutes = require('./routes/leave');
const departmentRoutes = require('./routes/department');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// 设置响应头，确保UTF-8编码
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api/attendance', attendanceRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/department', departmentRoutes);

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 测试数据库连接
db.getConnection((err, connection) => {
  if (err) {
    console.error('数据库连接失败:', err);
  } else {
    // 设置连接字符集
    connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
      if (err) {
        console.error('设置字符集失败:', err);
      }
    });
    console.log('数据库连接成功');
    connection.release();
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
