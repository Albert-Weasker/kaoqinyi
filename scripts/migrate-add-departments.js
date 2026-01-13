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
  
  // 检查部门表是否已存在
  connection.query(`
    SELECT COUNT(*) as count 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = 'departments'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查表失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results[0].count > 0) {
      console.log('部门表已存在，检查员工表结构...');
      
      // 检查员工表是否有department_id字段
      connection.query(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'employees' 
        AND COLUMN_NAME = 'department_id'
      `, [process.env.DB_NAME || 'kaoqinyi'], (err, colResults) => {
        if (err) {
          console.error('检查字段失败:', err);
          connection.end();
          process.exit(1);
        }
        
        if (colResults[0].count > 0) {
          console.log('员工表已包含department_id字段，迁移完成');
          connection.end();
          process.exit(0);
        } else {
          // 需要迁移员工表
          migrateEmployeesTable();
        }
      });
    } else {
      // 创建部门表并迁移
      createDepartmentsAndMigrate();
    }
  });
});

function createDepartmentsAndMigrate() {
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
  
  connection.query(createDepartmentsTable, (err) => {
    if (err) {
      console.error('创建部门表失败:', err);
      connection.end();
      process.exit(1);
    }
    
    console.log('部门表创建成功');
    
    // 获取现有员工的所有部门名称
    connection.query('SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != ""', (err, deptResults) => {
      if (err) {
        console.error('获取部门列表失败:', err);
        connection.end();
        process.exit(1);
      }
      
      // 插入部门数据
      const departments = deptResults.map(row => row.department);
      if (departments.length > 0) {
        const insertDepts = departments.map((dept, index) => {
          const code = `DEPT${String(index + 1).padStart(3, '0')}`;
          return `('${dept}', '${code}', NULL)`;
        }).join(',');
        
        connection.query(`INSERT IGNORE INTO departments (name, code, description) VALUES ${insertDepts}`, (err) => {
          if (err) {
            console.error('插入部门数据失败:', err);
          } else {
            console.log('部门数据插入成功');
          }
          
          migrateEmployeesTable();
        });
      } else {
        // 插入默认部门
        const insertDefaultDepts = `
          INSERT IGNORE INTO departments (name, code, description) VALUES
          ('生产部', 'PROD', '生产制造部门'),
          ('质检部', 'QC', '质量检验部门'),
          ('仓储部', 'WH', '仓储管理部门'),
          ('行政部', 'ADMIN', '行政管理部门'),
          ('财务部', 'FIN', '财务管理部门');
        `;
        
        connection.query(insertDefaultDepts, (err) => {
          if (err) {
            console.error('插入默认部门失败:', err);
          } else {
            console.log('默认部门插入成功');
          }
          
          migrateEmployeesTable();
        });
      }
    });
  });
}

function migrateEmployeesTable() {
  // 检查是否有department字段
  connection.query(`
    SELECT COUNT(*) as count 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = ? 
    AND TABLE_NAME = 'employees' 
    AND COLUMN_NAME = 'department'
  `, [process.env.DB_NAME || 'kaoqinyi'], (err, results) => {
    if (err) {
      console.error('检查字段失败:', err);
      connection.end();
      process.exit(1);
    }
    
    if (results[0].count === 0) {
      // 没有department字段，直接添加department_id
      connection.query(`
        ALTER TABLE employees 
        ADD COLUMN department_id INT DEFAULT NULL COMMENT '部门ID' AFTER employee_no,
        ADD FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        ADD INDEX idx_department_id (department_id)
      `, (err) => {
        if (err) {
          console.error('添加department_id字段失败:', err);
          connection.end();
          process.exit(1);
        }
        
        console.log('department_id字段添加成功');
        console.log('\n迁移完成！');
        connection.end();
        process.exit(0);
      });
    } else {
      // 有department字段，需要迁移数据
      // 先添加department_id字段
      connection.query(`
        ALTER TABLE employees 
        ADD COLUMN department_id INT DEFAULT NULL COMMENT '部门ID' AFTER employee_no
      `, (err) => {
        if (err) {
          console.error('添加department_id字段失败:', err);
          connection.end();
          process.exit(1);
        }
        
        console.log('department_id字段添加成功');
        
        // 迁移数据：根据部门名称匹配部门ID
        connection.query(`
          UPDATE employees e
          INNER JOIN departments d ON e.department = d.name
          SET e.department_id = d.id
          WHERE e.department IS NOT NULL AND e.department != ''
        `, (err) => {
          if (err) {
            console.error('迁移部门数据失败:', err);
          } else {
            console.log('部门数据迁移成功');
          }
          
          // 删除旧的department字段并添加外键
          connection.query(`
            ALTER TABLE employees 
            DROP COLUMN department,
            ADD FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
            ADD INDEX idx_department_id (department_id)
          `, (err) => {
            if (err) {
              console.error('删除旧字段失败:', err);
              // 如果删除失败，至少添加索引
              connection.query('ALTER TABLE employees ADD INDEX idx_department_id (department_id)', () => {});
            } else {
              console.log('旧字段删除成功');
            }
            
            console.log('\n迁移完成！');
            connection.end();
            process.exit(0);
          });
        });
      });
    }
  });
}
