-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS kaoqinyi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE kaoqinyi;

-- 创建部门表
CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '部门名称',
  code VARCHAR(20) UNIQUE COMMENT '部门代码',
  description TEXT DEFAULT NULL COMMENT '部门描述',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表';

-- 创建员工表
CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '姓名',
  employee_no VARCHAR(20) UNIQUE NOT NULL COMMENT '工号',
  department_id INT DEFAULT NULL COMMENT '部门ID',
  position VARCHAR(50) DEFAULT '' COMMENT '职位',
  phone VARCHAR(20) DEFAULT '' COMMENT '电话',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  INDEX idx_employee_no (employee_no),
  INDEX idx_department_id (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工表';

-- 创建打卡记录表
CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL COMMENT '员工ID',
  type ENUM('checkin', 'checkout') NOT NULL COMMENT '打卡类型：checkin-上班，checkout-下班',
  punch_time DATETIME NOT NULL COMMENT '打卡时间',
  address VARCHAR(255) DEFAULT '' COMMENT '打卡地址',
  longitude DECIMAL(10, 7) DEFAULT NULL COMMENT '经度',
  latitude DECIMAL(10, 7) DEFAULT NULL COMMENT '纬度',
  status ENUM('normal', 'late', 'early') DEFAULT 'normal' COMMENT '打卡状态：normal-正常，late-迟到，early-早退',
  late_minutes INT DEFAULT 0 COMMENT '迟到分钟数（仅上班打卡）',
  early_minutes INT DEFAULT 0 COMMENT '早退分钟数（仅下班打卡）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_employee_id (employee_id),
  INDEX idx_punch_time (punch_time),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_location (longitude, latitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录表';

-- 创建考勤规则表
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

-- 创建请假申请表
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

-- 插入默认考勤规则
INSERT IGNORE INTO attendance_rules (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) VALUES
('默认规则', '09:00:00', '09:15:00', '18:00:00', '17:45:00', 1);

-- 插入示例部门数据
INSERT IGNORE INTO departments (name, code, description) VALUES
('生产部', 'PROD', '生产制造部门'),
('质检部', 'QC', '质量检验部门'),
('仓储部', 'WH', '仓储管理部门'),
('行政部', 'ADMIN', '行政管理部门'),
('财务部', 'FIN', '财务管理部门');

-- 插入示例员工数据
INSERT IGNORE INTO employees (name, employee_no, department_id, position, phone) VALUES
('张三', 'E001', 1, '操作工', '13800138001'),
('李四', 'E002', 1, '操作工', '13800138002'),
('王五', 'E003', 2, '质检员', '13800138003'),
('赵六', 'E004', 1, '班组长', '13800138004'),
('钱七', 'E005', 3, '仓管员', '13800138005');
