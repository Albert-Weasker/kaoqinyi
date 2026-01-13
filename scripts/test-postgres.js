#!/usr/bin/env node

require('dotenv').config();
const db = require('../config/database');

async function testConnection() {
  console.log('🔍 测试数据库连接...\n');
  
  try {
    // 测试查询
    const [result] = await db.promise.execute('SELECT NOW() as current_time, version() as db_version');
    console.log('✅ 数据库连接成功！');
    console.log('📅 当前时间:', result[0].current_time);
    console.log('📊 数据库版本:', result[0].db_version);
    
    // 测试表是否存在
    const tables = ['departments', 'employees', 'attendance', 'attendance_rules', 'leave_requests'];
    console.log('\n📋 检查表结构...');
    
    for (const table of tables) {
      try {
        const [rows] = await db.promise.execute(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ✓ ${table}: ${rows[0].count} 条记录`);
      } catch (err) {
        console.log(`  ✗ ${table}: 表不存在或查询失败`);
      }
    }
    
    console.log('\n✅ 测试完成！');
    process.exit(0);
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  }
}

testConnection();
