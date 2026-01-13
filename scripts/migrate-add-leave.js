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
  
  // 检查表是否已存在
  connection.query(`
    SELECT COUNT(*) as count 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = 'leave_requests'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查表失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results[0].count > 0) {
      console.log('请假表已存在，跳过迁移');
      connection.end();
      process.exit(0);
    }
    
    // 创建请假表
    const createLeaveTable = `
      CREATE TABLE IF NOT EXISTS leave_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL COMMENT '员工ID',
        leave_type ENUM('事假', '病假', '年假', '调休', '婚假', '产假', '陪产假', '丧假', '其他') NOT NULL COMMENT '请假类型',
        start_date DATE NOT NULL COMMENT '开始日期',
        end_date DATE NOT NULL COMMENT '结束日期',
        days DECIMAL(5, 1) NOT NULL COMMENT '请假天数',
        reason TEXT NOT NULL COMMENT '请假原因',
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' COMMENT '状态：pending-待审批，approved-已批准，rejected-已拒绝',
        approver_id INT DEFAULT NULL COMMENT '审批人ID',
        approve_time DATETIME DEFAULT NULL COMMENT '审批时间',
        approve_remark TEXT DEFAULT NULL COMMENT '审批备注',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        INDEX idx_employee_id (employee_id),
        INDEX idx_status (status),
        INDEX idx_start_date (start_date),
        INDEX idx_end_date (end_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='请假申请表';
    `;
    
    connection.query(createLeaveTable, (err) => {
      if (err) {
        console.error('创建请假表失败:', err);
        connection.end();
        process.exit(1);
      }
      
      console.log('请假表创建成功！');
      console.log('\n迁移完成！');
      connection.end();
      process.exit(0);
    });
  });
});
