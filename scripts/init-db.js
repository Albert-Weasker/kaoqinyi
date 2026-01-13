const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
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
  
  console.log('数据库连接成功，开始初始化...');
  
  const dbName = process.env.DB_NAME || 'kaoqinyi';
  
  // 创建数据库
  connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, (err) => {
    if (err) {
      console.error('创建数据库失败:', err);
      connection.end();
      process.exit(1);
    }
    
    console.log(`数据库 ${dbName} 创建成功`);
    
    // 使用数据库
    connection.query(`USE ${dbName}`, (err) => {
      if (err) {
        console.error('选择数据库失败:', err);
        connection.end();
        process.exit(1);
      }
      
      // 创建部门表
      const createDepartmentsTable = `
        CREATE TABLE IF NOT EXISTS departments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL COMMENT '部门名称',
          code VARCHAR(20) UNIQUE COMMENT '部门代码',
          description TEXT DEFAULT NULL COMMENT '部门描述',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          INDEX idx_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表';
      `;
      
      // 创建员工表
      const createEmployeesTable = `
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
      `;
      
      // 创建打卡记录表
      const createAttendanceTable = `
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
      `;
      
      // 创建考勤规则表
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
      
      // 创建请假申请表
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
      
      // 先删除旧表（如果存在）
      const dropTables = `
        SET FOREIGN_KEY_CHECKS = 0;
        DROP TABLE IF EXISTS leave_requests;
        DROP TABLE IF EXISTS attendance;
        DROP TABLE IF EXISTS attendance_rules;
        DROP TABLE IF EXISTS employees;
        DROP TABLE IF EXISTS departments;
        SET FOREIGN_KEY_CHECKS = 1;
      `;
      
      connection.query(dropTables, (err) => {
        if (err) {
          console.error('删除旧表失败:', err);
        } else {
          console.log('旧表清理完成');
        }
        
        connection.query(createDepartmentsTable, (err) => {
          if (err) {
            console.error('创建部门表失败:', err);
            connection.end();
            process.exit(1);
          }
          console.log('部门表创建成功');
          
          // 插入示例部门数据
          const insertDepartments = `
            INSERT INTO departments (name, code, description) VALUES
            ('生产部', 'PROD', '生产制造部门'),
            ('质检部', 'QC', '质量检验部门'),
            ('仓储部', 'WH', '仓储管理部门'),
            ('行政部', 'ADMIN', '行政管理部门'),
            ('财务部', 'FIN', '财务管理部门');
          `;
          
          connection.query(insertDepartments, (err) => {
            if (err) {
              console.error('插入部门数据失败:', err);
              connection.end();
              process.exit(1);
            }
            console.log('部门数据插入成功');
            
            connection.query(createEmployeesTable, (err) => {
              if (err) {
                console.error('创建员工表失败:', err);
                connection.end();
                process.exit(1);
              }
              console.log('员工表创建成功');
              
              // 生成100个员工数据
              const surnames = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗'];
              const givenNames = ['伟', '芳', '娜', '秀英', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀兰', '霞', '平', '刚', '桂英', '建华', '文', '华', '建国', '红', '志强', '建国'];
              const positions = ['操作工', '质检员', '仓管员', '班组长', '技术员', '主管', '助理', '文员', '会计', '出纳'];
              const employees = [];
              
              // 先插入100个有部门的员工
              for (let i = 1; i <= 100; i++) {
                const surname = surnames[Math.floor(Math.random() * surnames.length)];
                const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
                const name = surname + givenName;
                const employeeNo = 'E' + String(i).padStart(3, '0');
                const departmentId = Math.floor(Math.random() * 5) + 1; // 1-5
                const position = positions[Math.floor(Math.random() * positions.length)];
                const phone = '138' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
                employees.push(`('${name}', '${employeeNo}', ${departmentId}, '${position}', '${phone}')`);
              }
              
              const insertEmployees = `INSERT INTO employees (name, employee_no, department_id, position, phone) VALUES ${employees.join(',')};`;
              
              connection.query(insertEmployees, (err) => {
                if (err) {
                  console.error('插入员工数据失败:', err);
                  connection.end();
                  process.exit(1);
                }
                console.log('100条员工数据插入成功');
                
                // 再插入100个无部门的员工
                const unassignedEmployees = [];
                for (let i = 101; i <= 200; i++) {
                  const surname = surnames[Math.floor(Math.random() * surnames.length)];
                  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
                  const name = surname + givenName;
                  const employeeNo = 'E' + String(i).padStart(3, '0');
                  const position = positions[Math.floor(Math.random() * positions.length)];
                  const phone = '138' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
                  unassignedEmployees.push(`('${name}', '${employeeNo}', NULL, '${position}', '${phone}')`);
                }
                
                const insertUnassigned = `INSERT INTO employees (name, employee_no, department_id, position, phone) VALUES ${unassignedEmployees.join(',')};`;
                
                connection.query(insertUnassigned, (err) => {
                  if (err) {
                    console.error('插入未分配员工数据失败:', err);
                  } else {
                    console.log('100条未分配员工数据插入成功');
                  }
                  
                  connection.query(createAttendanceTable, (err) => {
                  if (err) {
                    console.error('创建打卡记录表失败:', err);
                    connection.end();
                    process.exit(1);
                  }
                  console.log('打卡记录表创建成功');
                  
                  // 为每个员工生成最近30天的考勤记录
                  const attendanceRecords = [];
                  const today = new Date();
                  
                  for (let employeeId = 1; employeeId <= 100; employeeId++) {
                    for (let day = 0; day < 30; day++) {
                      const date = new Date(today);
                      date.setDate(date.getDate() - day);
                      
                      // 上班打卡（80%正常，20%迟到）
                      const checkinHour = Math.random() < 0.8 ? 8 : 8 + Math.floor(Math.random() * 3) + 1; // 8-10点
                      const checkinMinute = Math.floor(Math.random() * 60);
                      const checkinTime = new Date(date);
                      checkinTime.setHours(checkinHour, checkinMinute, 0);
                      
                      let status = 'normal';
                      let lateMinutes = 0;
                      if (checkinHour > 9 || (checkinHour === 9 && checkinMinute > 15)) {
                        status = 'late';
                        const lateTime = new Date(date);
                        lateTime.setHours(9, 15, 0);
                        lateMinutes = Math.floor((checkinTime - lateTime) / (1000 * 60));
                      }
                      
                      attendanceRecords.push(`(${employeeId}, 'checkin', '${checkinTime.toISOString().slice(0, 19).replace('T', ' ')}', '${status}', ${lateMinutes}, 0)`);
                      
                      // 下班打卡（80%正常，20%早退）
                      const isEarly = Math.random() < 0.2;
                      const checkoutHour = isEarly ? 17 : 18;
                      const checkoutMinute = isEarly ? Math.floor(Math.random() * 45) : Math.floor(Math.random() * 60); // 早退：17:00-17:44，正常：18:00-18:59
                      const checkoutTime = new Date(date);
                      checkoutTime.setHours(checkoutHour, checkoutMinute, 0);
                      
                      let checkoutStatus = 'normal';
                      let earlyMinutes = 0;
                      if (isEarly) {
                        checkoutStatus = 'early';
                        const earlyTime = new Date(date);
                        earlyTime.setHours(17, 45, 0);
                        earlyMinutes = Math.floor((earlyTime - checkoutTime) / (1000 * 60));
                      }
                      
                      attendanceRecords.push(`(${employeeId}, 'checkout', '${checkoutTime.toISOString().slice(0, 19).replace('T', ' ')}', '${checkoutStatus}', 0, ${earlyMinutes})`);
                    }
                  }
                  
                  // 分批插入（每批1000条）
                  const batchSize = 1000;
                  let batchIndex = 0;
                  
                  const insertBatch = () => {
                    const batch = attendanceRecords.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
                    if (batch.length === 0) {
                      console.log('考勤记录插入完成');
                      
                      connection.query(createRulesTable, (err) => {
                        if (err) {
                          console.error('创建考勤规则表失败:', err);
                          connection.end();
                          process.exit(1);
                        }
                        console.log('考勤规则表创建成功');
                        
                        // 插入默认考勤规则
                        const insertDefaultRule = `
                          INSERT INTO attendance_rules (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) VALUES
                          ('默认规则', '09:00:00', '09:15:00', '18:00:00', '17:45:00', 1);
                        `;
                        
                        connection.query(insertDefaultRule, (err) => {
                          if (err) {
                            console.error('插入默认规则失败:', err);
                          } else {
                            console.log('默认规则插入成功');
                          }
                          
                          connection.query(createLeaveTable, (err) => {
                            if (err) {
                              console.error('创建请假申请表失败:', err);
                              connection.end();
                              process.exit(1);
                            }
                            console.log('请假申请表创建成功');
                            
                            // 生成一些请假记录
                            const leaveTypes = ['事假', '病假', '年假', '调休', '婚假', '产假', '陪产假', '丧假', '其他'];
                            const leaveReasons = ['家中有事', '身体不适', '年假休息', '调休', '结婚', '生产', '陪产', '家中有丧事', '其他原因'];
                            const leaveRecords = [];
                            
                            // 随机生成50条请假记录
                            for (let i = 0; i < 50; i++) {
                              const employeeId = Math.floor(Math.random() * 100) + 1;
                              const leaveTypeIndex = Math.floor(Math.random() * leaveTypes.length);
                              const startDate = new Date(today);
                              startDate.setDate(startDate.getDate() - Math.floor(Math.random() * 60));
                              const days = Math.floor(Math.random() * 5) + 1;
                              const endDate = new Date(startDate);
                              endDate.setDate(endDate.getDate() + days - 1);
                              
                              const statuses = ['pending', 'approved', 'rejected'];
                              const status = statuses[Math.floor(Math.random() * statuses.length)];
                              const approverId = status !== 'pending' ? Math.floor(Math.random() * 10) + 1 : null;
                              const approveTime = status !== 'pending' ? new Date(startDate.getTime() + Math.random() * 86400000).toISOString().slice(0, 19).replace('T', ' ') : null;
                              
                              leaveRecords.push(`(${employeeId}, '${leaveTypes[leaveTypeIndex]}', '${startDate.toISOString().slice(0, 10)}', '${endDate.toISOString().slice(0, 10)}', ${days}, '${leaveReasons[leaveTypeIndex]}', '${status}', ${approverId || 'NULL'}, ${approveTime ? `'${approveTime}'` : 'NULL'}, '${approveTime ? '审批通过' : ''}')`);
                            }
                            
                            const insertLeave = `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status, approver_id, approve_time, approve_remark) VALUES ${leaveRecords.join(',')};`;
                            
                            connection.query(insertLeave, (err) => {
                              if (err) {
                                console.error('插入请假记录失败:', err);
                              } else {
                                console.log('50条请假记录插入成功');
                              }
                              
                              console.log('\n数据库初始化完成！');
                              console.log('已生成：');
                              console.log('- 5个部门');
                              console.log('- 100个有部门员工');
                              console.log('- 100个无部门员工');
                              console.log('- 6000条考勤记录（前100个员工，每个员工30天）');
                              console.log('- 50条请假记录');
                              connection.end();
                              process.exit(0);
                            });
                          });
                        });
                      });
                      return;
                    }
                    
                    const insertAttendance = `INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes) VALUES ${batch.join(',')};`;
                    connection.query(insertAttendance, (err) => {
                      if (err) {
                        console.error(`插入考勤记录批次 ${batchIndex + 1} 失败:`, err);
                        connection.end();
                        process.exit(1);
                      }
                      console.log(`考勤记录批次 ${batchIndex + 1} 插入成功 (${batch.length}条)`);
                      batchIndex++;
                      insertBatch();
                    });
                  };
                  
                  insertBatch();
                });
                });
              });
            });
          });
        });
      });
    });
  });
});
