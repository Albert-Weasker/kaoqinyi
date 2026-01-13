const mysql = require('mysql2');
require('dotenv').config();

// 本地数据库配置（从.env读取）
const localConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3333,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kaoqinyi',
  charset: 'utf8mb4'
};

// 云数据库配置（从.env读取，需要添加CLOUD_前缀的配置）
const cloudConfig = {
  host: '8.153.173.210',
  port: 3333,
  user: 'root',
  password: 'root123456',
  database: 'kaoqinyi',
  charset: 'utf8mb4'
};

// 需要同步的表（按依赖顺序）
const tables = [
  'departments',
  'employees',
  'attendance_rules',
  'attendance',
  'leave_requests'
];

// 创建数据库连接
function createConnection(config, label) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection({
      ...config,
      multipleStatements: true
    });
    
    connection.connect((err) => {
      if (err) {
        console.error(`❌ ${label}数据库连接失败:`, err.message);
        reject(err);
      } else {
        console.log(`✅ ${label}数据库连接成功`);
        // 设置字符集
        connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci', (err) => {
          if (err) {
            console.warn(`⚠️  设置${label}字符集警告:`, err.message);
          }
        });
        resolve(connection);
      }
    });
  });
}

// 获取表的所有数据
function getTableData(connection, tableName) {
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

// 获取表结构
function getTableStructure(connection, tableName) {
  return new Promise((resolve, reject) => {
    connection.query(`SHOW CREATE TABLE ${tableName}`, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results[0]['Create Table']);
      }
    });
  });
}

// 清空表数据（保留表结构）
function truncateTable(connection, tableName) {
  return new Promise((resolve, reject) => {
    // 禁用外键检查
    connection.query('SET FOREIGN_KEY_CHECKS = 0', (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      connection.query(`TRUNCATE TABLE ${tableName}`, (err) => {
        // 重新启用外键检查
        connection.query('SET FOREIGN_KEY_CHECKS = 1', () => {});
        
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

// 插入数据到表
function insertTableData(connection, tableName, data) {
  return new Promise((resolve, reject) => {
    if (!data || data.length === 0) {
      resolve(0);
      return;
    }
    
    // 获取列名
    const columns = Object.keys(data[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const values = data.map(row => columns.map(col => row[col]));
    
    // 批量插入（每批1000条）
    const batchSize = 1000;
    let inserted = 0;
    
    const insertBatch = (index) => {
      if (index >= values.length) {
        resolve(inserted);
        return;
      }
      
      const batch = values.slice(index, index + batchSize);
      const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ?`;
      
      connection.query(sql, [batch], (err) => {
        if (err) {
          reject(err);
        } else {
          inserted += batch.length;
          insertBatch(index + batchSize);
        }
      });
    };
    
    insertBatch(0);
  });
}

// 确保表存在（如果不存在则创建）
async function ensureTableExists(cloudConn, tableName, createTableSQL) {
  return new Promise((resolve, reject) => {
    cloudConn.query(`SHOW TABLES LIKE '${tableName}'`, (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (results.length === 0) {
        // 表不存在，创建表
        console.log(`   创建表: ${tableName}`);
        cloudConn.query(createTableSQL, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  });
}

// 同步单个表
async function syncTable(localConn, cloudConn, tableName) {
  try {
    console.log(`\n📋 同步表: ${tableName}`);
    
    // 1. 获取本地表结构
    const createTableSQL = await getTableStructure(localConn, tableName);
    
    // 2. 确保云数据库表存在
    await ensureTableExists(cloudConn, tableName, createTableSQL);
    
    // 3. 获取本地数据
    console.log(`   从本地读取数据...`);
    const data = await getTableData(localConn, tableName);
    console.log(`   读取到 ${data.length} 条记录`);
    
    if (data.length === 0) {
      console.log(`   ⚠️  表 ${tableName} 无数据，跳过`);
      return;
    }
    
    // 4. 清空云数据库表
    console.log(`   清空云数据库表...`);
    await truncateTable(cloudConn, tableName);
    
    // 5. 插入数据到云数据库
    console.log(`   插入数据到云数据库...`);
    const inserted = await insertTableData(cloudConn, tableName, data);
    console.log(`   ✅ 成功插入 ${inserted} 条记录`);
    
  } catch (error) {
    console.error(`   ❌ 同步表 ${tableName} 失败:`, error.message);
    throw error;
  }
}

// 主函数
async function main() {
  let localConn = null;
  let cloudConn = null;
  
  try {
    console.log('🚀 开始数据同步...\n');
    console.log('📊 本地数据库:', `${localConfig.host}:${localConfig.port}/${localConfig.database}`);
    console.log('☁️  云数据库:', `${cloudConfig.host}:${cloudConfig.port}/${cloudConfig.database}\n`);
    
    // 确认同步
    if (process.argv.includes('--confirm')) {
      console.log('⚠️  警告：此操作将清空云数据库的所有数据！');
      console.log('   按 Ctrl+C 取消，或等待5秒后继续...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // 连接数据库
    localConn = await createConnection(localConfig, '本地');
    cloudConn = await createConnection(cloudConfig, '云');
    
    // 同步每个表
    for (const table of tables) {
      await syncTable(localConn, cloudConn, table);
    }
    
    console.log('\n✅ 数据同步完成！');
    console.log(`   共同步 ${tables.length} 个表`);
    
  } catch (error) {
    console.error('\n❌ 数据同步失败:', error.message);
    process.exit(1);
  } finally {
    // 关闭连接
    if (localConn) {
      localConn.end();
      console.log('\n🔌 本地数据库连接已关闭');
    }
    if (cloudConn) {
      cloudConn.end();
      console.log('🔌 云数据库连接已关闭');
    }
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { main };
