const db = require('../config/database');

async function clearAttendanceData() {
  try {
    console.log('🗑️  开始清除考勤数据...');
    
    // 清除所有打卡记录
    await db.promise.execute('DELETE FROM attendance');
    console.log('✓ 已清除所有打卡记录');
    
    // 清除请假记录（可选）
    // await db.promise.execute('DELETE FROM leave_requests');
    // console.log('✓ 已清除所有请假记录');
    
    console.log('✅ 数据清除完成！');
    process.exit(0);
  } catch (error) {
    console.error('❌ 清除数据失败:', error);
    process.exit(1);
  }
}

clearAttendanceData();
