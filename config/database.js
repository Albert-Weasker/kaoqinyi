require('dotenv').config();

// 检测数据库类型：优先使用 DATABASE_URL (PostgreSQL) 或 POSTGRES_URL，否则使用 MySQL
const dbType = process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'postgresql' : 'mysql';

let pool, promisePool;

if (dbType === 'postgresql') {
  // PostgreSQL 配置
  const { Pool } = require('pg');
  
  // 从 DATABASE_URL 或单独的环境变量构建连接配置
  let pgConfig;
  
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    pgConfig = {
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: process.env.DATABASE_URL?.includes('sslmode=require') || process.env.POSTGRES_URL?.includes('sslmode=require') 
        ? { rejectUnauthorized: false } 
        : false
    };
  } else {
    pgConfig = {
      host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || process.env.POSTGRES_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || '',
      database: process.env.PGDATABASE || process.env.POSTGRES_DATABASE || 'kaoqinyi',
      ssl: process.env.POSTGRES_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
    };
  }
  
  pool = new Pool({
    ...pgConfig,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // 增加到 10 秒，适应远程数据库
    statement_timeout: 30000, // 查询超时 30 秒
    query_timeout: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  
  // 添加连接池错误处理
  pool.on('error', (err, client) => {
    console.error('PostgreSQL 连接池错误:', err.message);
  });
  
  pool.on('connect', (client) => {
    // 设置客户端参数
    client.query('SET timezone = \'UTC\'');
  });
  
  // PostgreSQL 适配器：将 MySQL 风格的 execute 转换为 PostgreSQL
  const originalQuery = pool.query.bind(pool);
  
  // 转换 MySQL 占位符 ? 为 PostgreSQL 占位符 $1, $2, $3...
  function convertQuery(sql, params = []) {
    if (!params || params.length === 0) {
      return { sql, params: [] };
    }
    
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    return { sql: convertedSql, params };
  }
  
  // 重试函数
  async function retryQuery(queryFn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await queryFn();
      } catch (err) {
        const isConnectionError = err.message.includes('Connection terminated') || 
                                  err.message.includes('timeout') ||
                                  err.message.includes('ECONNRESET') ||
                                  err.code === '57P01'; // 连接终止错误码
        
        if (isConnectionError && i < retries - 1) {
          console.warn(`查询失败，${delay}ms 后重试 (${i + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // 指数退避
          continue;
        }
        throw err;
      }
    }
  }
  
  // 创建兼容 MySQL 的 promise 接口
  promisePool = {
    execute: async (sql, params) => {
      const { sql: convertedSql, params: convertedParams } = convertQuery(sql, params);
      return await retryQuery(async () => {
        const result = await originalQuery(convertedSql, convertedParams);
        // PostgreSQL 返回格式：{ rows: [...], rowCount: N }
        // MySQL 返回格式：[[...], fields]
        // 转换为 MySQL 格式以保持兼容
        return [result.rows, result.fields || []];
      });
    },
    query: async (sql, params) => {
      const { sql: convertedSql, params: convertedParams } = convertQuery(sql, params);
      return await retryQuery(async () => {
        const result = await originalQuery(convertedSql, convertedParams);
        return result.rows;
      });
    }
  };
  
  // 兼容 MySQL 的 getConnection 方法
  pool.getConnection = (callback) => {
    pool.connect((err, client, release) => {
      if (err) {
        console.error('获取 PostgreSQL 连接失败:', err.message);
        return callback(err);
      }
      // 创建一个兼容 MySQL connection 的对象
      const connection = {
        query: (sql, params, cb) => {
          const { sql: convertedSql, params: convertedParams } = convertQuery(sql, params || []);
          client.query(convertedSql, convertedParams, (err, result) => {
            if (cb) {
              cb(err, result ? result.rows : null, result ? result.fields : null);
            }
          });
        },
        release: release
      };
      callback(null, connection);
    });
  };
  
  console.log('✓ 使用 PostgreSQL 数据库');
  
} else {
  // MySQL 配置（保持原有逻辑）
  const mysql = require('mysql2');
  
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kaoqinyi',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    typeCast: function (field, next) {
      if (field.type === 'VAR_STRING' || field.type === 'STRING' || field.type === 'TEXT') {
        return field.string();
      }
      return next();
    }
  });
  
  // 确保连接使用UTF-8编码
  pool.on('connection', (connection) => {
    connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  });
  
  promisePool = pool.promise();
  
  console.log('✓ 使用 MySQL 数据库');
}

module.exports = pool;
module.exports.promise = promisePool;
module.exports.dbType = dbType;
