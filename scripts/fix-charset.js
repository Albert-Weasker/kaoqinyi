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
  
  console.log('数据库连接成功，开始修复字符集...');
  
  // 设置连接字符集
  connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
    if (err) {
      console.error('设置连接字符集失败:', err);
      connection.end();
      process.exit(1);
    }
    
    // 修复数据库字符集
    const dbName = process.env.DB_NAME || 'kaoqinyi';
    connection.query(`ALTER DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (err) => {
      if (err) {
        console.error('修复数据库字符集失败:', err);
      } else {
        console.log('数据库字符集修复成功');
      }
      
      // 修复所有表的字符集
      const tables = ['departments', 'employees', 'attendance', 'attendance_rules', 'leave_requests'];
      let completed = 0;
      
      tables.forEach(table => {
        connection.query(`
          ALTER TABLE ${table} 
          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `, (err) => {
          if (err) {
            console.error(`修复表 ${table} 字符集失败:`, err);
          } else {
            console.log(`表 ${table} 字符集修复成功`);
          }
          
          completed++;
          if (completed === tables.length) {
            console.log('\n字符集修复完成！');
            connection.end();
            process.exit(0);
          }
        });
      });
    });
  });
});
