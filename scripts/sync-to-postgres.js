#!/usr/bin/env node

require('dotenv').config();
const mysql = require('mysql2');
const { Pool } = require('pg');

// 本地 MySQL 数据库配置
const mysqlConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3333,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kaoqinyi',
  charset: 'utf8mb4'
};

// PostgreSQL 数据库配置（从环境变量读取）
let pgConfig;
if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  pgConfig = {
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  };
} else {
  pgConfig = {
    host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.POSTGRES_DATABASE || 'neondb',
    ssl: process.env.POSTGRES_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  };
}

// 需要同步的表（按依赖顺序）
const tables = [
  'departments',
  'employees',
  'attendance_rules',
  'attendance',
  'leave_requests'
];

// 创建 MySQL 连接
function createMySQLConnection() {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection({
      ...mysqlConfig,
      multipleStatements: true
    });
    
    connection.connect((err) => {
      if (err) {
        console.error('❌ MySQL 数据库连接失败:', err.message);
        reject(err);
      } else {
        console.log('✅ MySQL 数据库连接成功');
        connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
          if (err) console.warn('⚠️  设置字符集警告:', err.message);
        });
        resolve(connection);
      }
    });
  });
}

// 创建 PostgreSQL 连接池
const pgPool = new Pool(pgConfig);

// 测试 PostgreSQL 连接
async function testPostgreSQLConnection() {
  try {
    const client = await pgPool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✅ PostgreSQL 数据库连接成功');
    client.release();
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL 数据库连接失败:', err.message);
    return false;
  }
}

// 获取 MySQL 表的所有数据
function getMySQLTableData(connection, tableName) {
  return new Promise((resolve, reject) => {
    connection.query(`SELECT * FROM ${tableName}`, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
}

// 检查 PostgreSQL 表是否存在
async function checkPostgreSQLTable(tableName) {
  try {
    const result = await pgPool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  } catch (err) {
    console.error(`检查表 ${tableName} 失败:`, err.message);
    return false;
  }
}

// 创建 PostgreSQL 表（如果不存在）
async function createPostgreSQLTables() {
  console.log('\n📋 检查并创建 PostgreSQL 表结构...');
  
  // 创建部门表
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      code VARCHAR(20) UNIQUE,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ departments 表已就绪');

  // 创建员工表
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      employee_no VARCHAR(20) UNIQUE NOT NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      position VARCHAR(50) DEFAULT '',
      phone VARCHAR(20) DEFAULT '',
      tag VARCHAR(50) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ employees 表已就绪');

  // 创建打卡记录表
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type VARCHAR(10) NOT NULL CHECK (type IN ('checkin', 'checkout')),
      punch_time TIMESTAMP NOT NULL,
      address VARCHAR(255) DEFAULT '',
      longitude DECIMAL(10, 7) DEFAULT NULL,
      latitude DECIMAL(10, 7) DEFAULT NULL,
      status VARCHAR(10) DEFAULT 'normal' CHECK (status IN ('normal', 'late', 'early')),
      late_minutes INTEGER DEFAULT 0,
      early_minutes INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ attendance 表已就绪');

  // 创建考勤规则表
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS attendance_rules (
      id SERIAL PRIMARY KEY,
      rule_name VARCHAR(50) DEFAULT '默认规则',
      checkin_time TIME NOT NULL DEFAULT '09:00:00',
      checkin_late_time TIME NOT NULL DEFAULT '09:15:00',
      checkout_time TIME NOT NULL DEFAULT '18:00:00',
      checkout_early_time TIME NOT NULL DEFAULT '17:45:00',
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ attendance_rules 表已就绪');

  // 创建请假申请表
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      leave_type VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      days DECIMAL(5, 1) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(10) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      approver_id INTEGER DEFAULT NULL,
      approve_time TIMESTAMP DEFAULT NULL,
      approve_remark TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ leave_requests 表已就绪');

  // 创建索引
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_employee_no ON employees(employee_no)');
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_department_id ON employees(department_id)');
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance(employee_id)');
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_attendance_punch_time ON attendance(punch_time)');
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_leave_employee_id ON leave_requests(employee_id)');
  await pgPool.query('CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status)');
  console.log('✓ 索引已创建');
}

// 清空 PostgreSQL 表数据
async function truncatePostgreSQLTable(tableName) {
  try {
    await pgPool.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);
    return true;
  } catch (err) {
    console.error(`清空表 ${tableName} 失败:`, err.message);
    return false;
  }
}

// 插入数据到 PostgreSQL
async function insertDataToPostgreSQL(tableName, data) {
  if (!data || data.length === 0) {
    console.log(`  ⚠️  ${tableName} 表无数据，跳过`);
    return 0;
  }

  try {
    // 获取第一条数据的字段名
    const columns = Object.keys(data[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnNames = columns.join(', ');
    
    // 批量插入（每批 1000 条）
    const batchSize = 1000;
    let inserted = 0;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const values = batch.map(row => 
        columns.map(col => {
          const value = row[col];
          // 处理 NULL 值
          if (value === null || value === undefined) return null;
          // 处理日期时间
          if (value instanceof Date) return value.toISOString();
          // 处理布尔值字段（MySQL 的 TINYINT(1) 需要转换为 PostgreSQL 的 BOOLEAN）
          if (col === 'is_default' && (value === 0 || value === 1)) {
            return value === 1;
          }
          return value;
        })
      );
      
      const query = `
        INSERT INTO ${tableName} (${columnNames})
        VALUES ${batch.map((_, idx) => 
          `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(', ')})`
        ).join(', ')}
      `;
      
      const flatValues = values.flat();
      await pgPool.query(query, flatValues);
      inserted += batch.length;
    }
    
    return inserted;
  } catch (err) {
    console.error(`插入数据到 ${tableName} 失败:`, err.message);
    throw err;
  }
}

// 同步单个表
async function syncTable(mysqlConnection, tableName) {
  console.log(`\n📦 同步表: ${tableName}`);
  
  try {
    // 从 MySQL 获取数据
    const data = await getMySQLTableData(mysqlConnection, tableName);
    console.log(`  📥 从 MySQL 读取 ${data.length} 条记录`);
    
    if (data.length === 0) {
      console.log(`  ⚠️  表 ${tableName} 无数据，跳过`);
      return 0;
    }
    
    // 清空 PostgreSQL 表
    await truncatePostgreSQLTable(tableName);
    console.log(`  🗑️  已清空 PostgreSQL 表 ${tableName}`);
    
    // 插入数据到 PostgreSQL
    const inserted = await insertDataToPostgreSQL(tableName, data);
    console.log(`  ✅ 已插入 ${inserted} 条记录到 PostgreSQL`);
    
    return inserted;
  } catch (err) {
    console.error(`  ❌ 同步表 ${tableName} 失败:`, err.message);
    throw err;
  }
}

// 主函数
async function main() {
  console.log('🚀 开始同步数据：MySQL -> PostgreSQL\n');
  
  let mysqlConnection = null;
  
  try {
    // 连接 MySQL
    mysqlConnection = await createMySQLConnection();
    
    // 测试 PostgreSQL 连接
    const pgConnected = await testPostgreSQLConnection();
    if (!pgConnected) {
      throw new Error('PostgreSQL 连接失败，请检查环境变量配置');
    }
    
    // 创建 PostgreSQL 表结构
    await createPostgreSQLTables();
    
    // 同步数据
    let totalSynced = 0;
    for (const table of tables) {
      const count = await syncTable(mysqlConnection, table);
      totalSynced += count;
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ 数据同步完成！共同步 ${totalSynced} 条记录`);
    console.log('='.repeat(50));
    
  } catch (err) {
    console.error('\n❌ 同步失败:', err.message);
    process.exit(1);
  } finally {
    if (mysqlConnection) {
      mysqlConnection.end();
    }
    await pgPool.end();
  }
}

// 运行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
