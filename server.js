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

// 测试数据库连接（带重试）
const dbType = require('./config/database').dbType;

async function testDatabaseConnection() {
  const maxRetries = 3;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      if (dbType === 'mysql') {
        await new Promise((resolve, reject) => {
          db.getConnection((err, connection) => {
            if (err) {
              reject(err);
              return;
            }
            // MySQL 设置连接字符集
            connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
              if (err) {
                console.warn('设置字符集警告:', err.message);
              }
            });
            console.log('✅ 数据库连接成功');
            connection.release();
            resolve();
          });
        });
      } else {
        // PostgreSQL 连接测试
        await db.promise.query('SELECT NOW()');
        console.log('✅ 数据库连接成功');
      }
      break; // 成功则退出循环
    } catch (err) {
      retries++;
      if (retries < maxRetries) {
        console.warn(`数据库连接失败，${2 * retries}秒后重试 (${retries}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * retries));
      } else {
        console.error('❌ 数据库连接失败，已达到最大重试次数:', err.message);
        console.warn('⚠️  服务器将继续启动，但数据库操作可能会失败');
      }
    }
  }
}

// 异步测试连接（不阻塞服务器启动）
testDatabaseConnection();

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
