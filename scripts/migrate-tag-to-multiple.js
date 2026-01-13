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
  
  console.log('数据库连接成功，开始修改标签字段以支持多个标签...');
  
  // 修改标签字段大小以支持多个标签（用逗号分隔）
  connection.query(`
    ALTER TABLE employees 
    MODIFY COLUMN tag VARCHAR(255) DEFAULT NULL COMMENT '员工标签（多个标签用逗号分隔）'
  `, (err) => {
    if (err) {
      console.error('修改标签字段失败:', err);
      connection.end();
      process.exit(1);
    } else {
      console.log('标签字段修改成功，现在支持多个标签');
    }
    
    connection.end();
    console.log('迁移完成！');
    process.exit(0);
  });
});
