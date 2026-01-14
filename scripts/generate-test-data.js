const db = require('../config/database');
const moment = require('moment');

async function generateTestData() {
  try {
    console.log('📝 开始生成测试数据...');
    
    // 获取所有员工
    const [employees] = await db.promise.execute('SELECT id, employee_no FROM employees');
    
    if (employees.length === 0) {
      console.log('❌ 没有员工数据，请先添加员工');
      process.exit(1);
    }
    
    console.log(`找到 ${employees.length} 名员工`);
    
    // 生成最近30天的数据（包括今天）
    const endDate = moment();
    const startDate = moment().subtract(29, 'days'); // 包括今天共30天
    
    let totalRecords = 0;
    
    for (let d = moment(startDate); d.isSameOrBefore(endDate); d.add(1, 'day')) {
      const dateStr = d.format('YYYY-MM-DD');
      const dayOfWeek = d.day(); // 0=周日, 6=周六
      
      // 跳过周末（可选）
      // if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      for (const emp of employees) {
        // 80%概率有打卡记录
        if (Math.random() < 0.8) {
          // 生成上班打卡时间（8:00-9:30之间，大部分在8:30-9:00）
          let checkinHour, checkinMinute;
          if (Math.random() < 0.7) {
            // 70%概率在8:30-9:00之间（正常）
            checkinHour = 8;
            checkinMinute = 30 + Math.floor(Math.random() * 30);
          } else if (Math.random() < 0.5) {
            // 15%概率在8:00-8:30之间（早到）
            checkinHour = 8;
            checkinMinute = Math.floor(Math.random() * 30);
          } else {
            // 15%概率在9:00-9:30之间（可能迟到）
            checkinHour = 9;
            checkinMinute = Math.floor(Math.random() * 30);
          }
          const checkinTime = moment(d).hour(checkinHour).minute(checkinMinute).second(0);
          
          // 判断是否迟到（9:15之后）
          let checkinStatus = 'normal';
          let lateMinutes = 0;
          if (checkinTime.hour() > 9 || (checkinTime.hour() === 9 && checkinTime.minute() > 15)) {
            checkinStatus = 'late';
            const lateTime = moment(d).hour(9).minute(15).second(0);
            lateMinutes = Math.floor(checkinTime.diff(lateTime, 'minutes'));
          }
          
          // 生成下班打卡时间（17:30-19:00之间，或者夜班到第二天凌晨）
          let checkoutTime;
          let checkoutStatus = 'normal';
          let earlyMinutes = 0;
          
          // 20%概率是夜班（下班时间在第二天凌晨）
          if (Math.random() < 0.2) {
            // 夜班：下班时间在第二天凌晨 0:00-3:00
            const nextDay = moment(d).add(1, 'day');
            const checkoutHour = Math.floor(Math.random() * 3); // 0-2点
            const checkoutMinute = Math.floor(Math.random() * 60);
            checkoutTime = moment(nextDay).hour(checkoutHour).minute(checkoutMinute).second(0);
            checkoutStatus = 'normal'; // 夜班不算早退
          } else {
            // 正常班：下班时间在当天 17:30-18:30（大部分正常）
            let checkoutHour, checkoutMinute;
            if (Math.random() < 0.8) {
              // 80%概率在17:45-18:30之间（正常）
              checkoutHour = 17;
              checkoutMinute = 45 + Math.floor(Math.random() * 45);
            } else {
              // 20%概率在18:00-19:00之间（加班）
              checkoutHour = 18;
              checkoutMinute = Math.floor(Math.random() * 60);
            }
            checkoutTime = moment(d).hour(checkoutHour).minute(checkoutMinute).second(0);
            
            // 判断是否早退（17:45之前）
            if (checkoutTime.hour() < 17 || (checkoutTime.hour() === 17 && checkoutTime.minute() < 45)) {
              checkoutStatus = 'early';
              const earlyTime = moment(d).hour(17).minute(45).second(0);
              earlyMinutes = Math.floor(earlyTime.diff(checkoutTime, 'minutes'));
            }
          }
          
          // 插入上班打卡
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkin', checkinTime.format('YYYY-MM-DD HH:mm:ss'), checkinStatus, lateMinutes, 0, checkinTime.format('YYYY-MM-DD HH:mm:ss')]
          );
          totalRecords++;
          
          // 插入下班打卡
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkout', checkoutTime.format('YYYY-MM-DD HH:mm:ss'), checkoutStatus, 0, earlyMinutes, checkoutTime.format('YYYY-MM-DD HH:mm:ss')]
          );
          totalRecords++;
        }
      }
    }
    
    console.log(`✅ 测试数据生成完成！共生成 ${totalRecords} 条打卡记录`);
    console.log(`   时间范围：${startDate.format('YYYY-MM-DD')} 至 ${endDate.format('YYYY-MM-DD')}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ 生成测试数据失败:', error);
    process.exit(1);
  }
}

generateTestData();
