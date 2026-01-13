const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3333,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root123456',
  database: process.env.DB_NAME || 'kaoqinyi',
  charset: 'utf8mb4',
  multipleStatements: true
});

connection.connect((err) => {
  if (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }
  
  // 设置连接字符集
  connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  
  console.log('数据库连接成功，开始迁移...');
  
  // 检查字段是否已存在
  connection.query(`
    SELECT COUNT(*) as count 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = 'attendance' 
    AND COLUMN_NAME = 'address'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查字段失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results[0].count > 0) {
      console.log('位置字段已存在，跳过迁移');
      connection.end();
      process.exit(0);
    }
    
    // 添加位置相关字段
    const alterTable = `
      ALTER TABLE attendance 
      ADD COLUMN address VARCHAR(255) DEFAULT '' COMMENT '打卡地址' AFTER punch_time,
      ADD COLUMN longitude DECIMAL(10, 7) DEFAULT NULL COMMENT '经度' AFTER address,
      ADD COLUMN latitude DECIMAL(10, 7) DEFAULT NULL COMMENT '纬度' AFTER longitude,
      ADD INDEX idx_location (longitude, latitude);
    `;
    
    connection.query(alterTable, (err) => {
      if (err) {
        console.error('添加字段失败:', err);
        connection.end();
        process.exit(1);
      }
      
      console.log('位置字段添加成功！');
      connection.end();
      process.exit(0);
    });
  });
});
