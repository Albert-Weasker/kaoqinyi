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

// 员工标签选项
const EMPLOYEE_TAGS = [
    '稳定', '不稳定', '老黄牛', '刺头', '要离职',
    '优秀', '一般', '待改进', '新人', '老员工',
    '积极', '消极', '能力强', '能力弱', '潜力股',
    '问题员工', '核心员工', '普通员工', '重点关注', '待观察'
];

// 标签分配规则（可以根据需要修改）
function assignTags(employee, index) {
    const tags = [];
    
    // 根据员工ID或索引分配标签（示例逻辑，可以根据实际需求修改）
    
    // 前20个员工：优秀员工
    if (index < 20) {
        tags.push('优秀');
        tags.push('稳定');
        if (index < 5) {
            tags.push('核心员工');
        }
    }
    // 21-40：普通员工
    else if (index < 40) {
        tags.push('普通员工');
        tags.push('稳定');
    }
    // 41-60：新人或待观察
    else if (index < 60) {
        tags.push('新人');
        tags.push('待观察');
    }
    // 61-80：潜力股
    else if (index < 80) {
        tags.push('潜力股');
        tags.push('积极');
    }
    // 81-100：一般员工
    else if (index < 100) {
        tags.push('一般');
        tags.push('普通员工');
    }
    // 101-150：未分配部门的员工，标记为新人或待观察
    else if (index < 150) {
        const random = Math.random();
        if (random < 0.3) {
            tags.push('新人');
        } else if (random < 0.6) {
            tags.push('待观察');
        } else {
            tags.push('一般');
        }
    }
    // 151-200：未分配部门的员工
    else {
        const random = Math.random();
        if (random < 0.2) {
            tags.push('不稳定');
        } else if (random < 0.4) {
            tags.push('待改进');
        } else {
            tags.push('待观察');
        }
    }
    
    // 随机添加一些额外标签
    const randomExtra = Math.random();
    if (randomExtra < 0.1 && !tags.includes('老黄牛')) {
        tags.push('老黄牛');
    }
    if (randomExtra < 0.05 && !tags.includes('刺头')) {
        tags.push('刺头');
    }
    if (randomExtra < 0.03 && !tags.includes('要离职')) {
        tags.push('要离职');
    }
    
    return tags.join(',');
}

connection.connect((err) => {
  if (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }
  
  console.log('数据库连接成功，开始给员工添加标签...');
  
  // 获取所有员工
  connection.query('SELECT id, name, employee_no FROM employees ORDER BY id', (err, employees) => {
    if (err) {
      console.error('获取员工列表失败:', err);
      connection.end();
      process.exit(1);
    }
    
    console.log(`找到 ${employees.length} 个员工，开始分配标签...`);
    
    let updated = 0;
    let index = 0;
    
    // 逐个更新员工标签
    const updateNext = () => {
      if (index >= employees.length) {
        console.log(`\n完成！共更新了 ${updated} 个员工的标签`);
        connection.end();
        process.exit(0);
      }
      
      const employee = employees[index];
      const tags = assignTags(employee, index);
      
      connection.query(
        'UPDATE employees SET tag = ? WHERE id = ?',
        [tags, employee.id],
        (err) => {
          if (err) {
            console.error(`更新员工 ${employee.name} (${employee.employee_no}) 失败:`, err);
          } else {
            console.log(`${employee.name} (${employee.employee_no}): ${tags}`);
            updated++;
          }
          
          index++;
          updateNext();
        }
      );
    };
    
    updateNext();
  });
});
