const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kaoqinyi',
  charset: 'utf8mb4'
});

connection.connect((err) => {
  if (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }
  
  console.log('数据库连接成功，开始添加标签字段...');
  
  // 检查字段是否存在
  connection.query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = 'employees' 
    AND COLUMN_NAME = 'tag'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查字段失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results.length > 0) {
      console.log('标签字段已存在，跳过');
      connection.end();
      process.exit(0);
    }
    
    // 添加标签字段
    connection.query(`
      ALTER TABLE employees 
      ADD COLUMN tag VARCHAR(20) DEFAULT NULL COMMENT '员工标签'
    `, (err) => {
      if (err) {
        console.error('添加标签字段失败:', err);
        connection.end();
        process.exit(1);
      } else {
        console.log('标签字段添加成功');
      }
      
      connection.end();
      console.log('迁移完成！');
      process.exit(0);
    });
  });
});
