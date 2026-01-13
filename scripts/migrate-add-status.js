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
    AND COLUMN_NAME = 'status'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查字段失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results[0].count > 0) {
      console.log('状态字段已存在，跳过迁移');
      connection.end();
      process.exit(0);
    }
    
    // 添加状态相关字段
    const alterTable = `
      ALTER TABLE attendance 
      ADD COLUMN status ENUM('normal', 'late', 'early') DEFAULT 'normal' COMMENT '打卡状态：normal-正常，late-迟到，early-早退' AFTER latitude,
      ADD COLUMN late_minutes INT DEFAULT 0 COMMENT '迟到分钟数（仅上班打卡）' AFTER status,
      ADD COLUMN early_minutes INT DEFAULT 0 COMMENT '早退分钟数（仅下班打卡）' AFTER late_minutes,
      ADD INDEX idx_status (status);
    `;
    
    connection.query(alterTable, (err) => {
      if (err) {
        console.error('添加字段失败:', err);
        connection.end();
        process.exit(1);
      }
      
      console.log('状态字段添加成功！');
      
      // 创建考勤规则表（如果不存在）
      const createRulesTable = `
        CREATE TABLE IF NOT EXISTS attendance_rules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          rule_name VARCHAR(50) DEFAULT '默认规则' COMMENT '规则名称',
          checkin_time TIME NOT NULL DEFAULT '09:00:00' COMMENT '上班时间',
          checkin_late_time TIME NOT NULL DEFAULT '09:15:00' COMMENT '迟到时间（超过此时间算迟到）',
          checkout_time TIME NOT NULL DEFAULT '18:00:00' COMMENT '下班时间',
          checkout_early_time TIME NOT NULL DEFAULT '17:45:00' COMMENT '早退时间（早于此时间算早退）',
          is_default TINYINT(1) DEFAULT 0 COMMENT '是否默认规则',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          INDEX idx_is_default (is_default)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤规则表';
      `;
      
      connection.query(createRulesTable, (err) => {
        if (err) {
          console.error('创建考勤规则表失败:', err);
          connection.end();
          process.exit(1);
        }
        
        // 插入默认规则（如果不存在）
        connection.query(`
          INSERT IGNORE INTO attendance_rules 
          (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) 
          VALUES ('默认规则', '09:00:00', '09:15:00', '18:00:00', '17:45:00', 1)
        `, (err) => {
          if (err) {
            console.error('插入默认规则失败:', err);
          } else {
            console.log('默认规则创建成功');
          }
          
          console.log('\n迁移完成！');
          connection.end();
          process.exit(0);
        });
      });
    });
  });
});
