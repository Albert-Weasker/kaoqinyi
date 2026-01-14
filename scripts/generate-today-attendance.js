const db = require('../config/database');
const moment = require('moment');
const cacheStore = require('../utils/cache-store');

async function generateTodayAttendance() {
  try {
    console.log('📝 开始生成今天的打卡记录...');
    
    // 等待缓存同步完成（最多等待10秒）
    let waitCount = 0;
    while (cacheStore.employees.size === 0 && waitCount < 10) {
      console.log('⏳ 等待缓存同步...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      waitCount++;
    }
    
    // 如果缓存还没有数据，直接从数据库读取
    let employees = cacheStore.getAllEmployees();
    if (employees.length === 0) {
      console.log('📊 缓存未就绪，从数据库读取员工数据...');
      const [dbEmployees] = await db.promise.execute(`
        SELECT e.*, d.name as department_name 
        FROM employees e 
        LEFT JOIN departments d ON e.department_id = d.id
      `);
      employees = dbEmployees;
    }
    
    if (employees.length === 0) {
      console.log('❌ 没有员工数据，请先添加员工');
      process.exit(1);
    }
    
    console.log(`找到 ${employees.length} 名员工`);
    
    // 获取今天的日期
    const today = moment();
    const todayStr = today.format('YYYY-MM-DD');
    
    // 获取考勤规则（从缓存或数据库）
    let rule = cacheStore.getDefaultRule();
    if (!rule || !rule.checkin_late_time) {
      console.log('📊 从数据库读取考勤规则...');
      const dbType = require('../config/database').dbType;
      const isDefaultValue = dbType === 'postgresql' ? true : 1;
      const [rules] = await db.promise.execute(
        'SELECT * FROM attendance_rules WHERE is_default = ? LIMIT 1',
        [isDefaultValue]
      );
      if (rules.length > 0) {
        rule = rules[0];
      } else {
        rule = {
          checkin_time: '09:00:00',
          checkin_late_time: '09:15:00',
          checkout_time: '18:00:00',
          checkout_early_time: '17:45:00'
        };
      }
    }
    const checkinLateTime = moment(`${todayStr} ${rule.checkin_late_time}`);
    const checkoutEarlyTime = moment(`${todayStr} ${rule.checkout_early_time}`);
    
    let checkinCount = 0;
    let checkoutCount = 0;
    
    for (const emp of employees) {
      // 检查今天是否已有打卡记录（从缓存或数据库）
      let existingAttendance = cacheStore.getAttendance(emp.id, todayStr);
      if (!existingAttendance) {
        // 如果缓存没有，从数据库检查
        const dbType = require('../config/database').dbType;
        const dateExpr = dbType === 'postgresql' ? 'punch_time::date' : 'DATE(punch_time)';
        const [records] = await db.promise.execute(
          `SELECT * FROM attendance WHERE employee_id = ? AND ${dateExpr} = ?`,
          [emp.id, todayStr]
        );
        if (records.length > 0) {
          existingAttendance = {
            checkins: records.filter(r => r.type === 'checkin'),
            checkouts: records.filter(r => r.type === 'checkout')
          };
        }
      }
      
      // 90%概率有上班打卡
      if (Math.random() < 0.9) {
        // 如果已经有上班打卡记录，跳过
        if (existingAttendance && existingAttendance.checkins.length > 0) {
          console.log(`  ⏭️  员工 ${emp.name} (${emp.employee_no}) 今天已有上班打卡记录，跳过`);
          continue;
        }
        
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
        const checkinTime = moment(today).hour(checkinHour).minute(checkinMinute).second(0);
        
        // 判断是否迟到（9:15之后）
        let checkinStatus = 'normal';
        let lateMinutes = 0;
        if (checkinTime.isAfter(checkinLateTime)) {
          checkinStatus = 'late';
          lateMinutes = Math.floor(checkinTime.diff(checkinLateTime, 'minutes'));
        }
        
        // 先插入数据库
        await db.promise.execute(
          'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [emp.id, 'checkin', checkinTime.format('YYYY-MM-DD HH:mm:ss'), checkinStatus, lateMinutes, 0, checkinTime.format('YYYY-MM-DD HH:mm:ss')]
        );
        
        // 再更新缓存
        cacheStore.addAttendance({
          employee_id: emp.id,
          type: 'checkin',
          punch_time: checkinTime.format('YYYY-MM-DD HH:mm:ss'),
          status: checkinStatus,
          late_minutes: lateMinutes
        });
        
        checkinCount++;
        console.log(`  ✅ 员工 ${emp.name} (${emp.employee_no}) 上班打卡：${checkinTime.format('HH:mm:ss')} ${checkinStatus === 'late' ? `(迟到${lateMinutes}分钟)` : ''}`);
      }
      
      // 如果有上班打卡，80%概率有下班打卡
      const hasCheckin = existingAttendance && existingAttendance.checkins.length > 0;
      if (hasCheckin || checkinCount > 0) {
        if (Math.random() < 0.8) {
          // 如果已经有下班打卡记录，跳过
          if (existingAttendance && existingAttendance.checkouts.length > 0) {
            console.log(`  ⏭️  员工 ${emp.name} (${emp.employee_no}) 今天已有下班打卡记录，跳过`);
            continue;
          }
          
          // 生成下班打卡时间（17:30-18:30，大部分正常）
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
          const checkoutTime = moment(today).hour(checkoutHour).minute(checkoutMinute).second(0);
          
          // 判断是否早退（17:45之前）
          let checkoutStatus = 'normal';
          let earlyMinutes = 0;
          if (checkoutTime.isBefore(checkoutEarlyTime)) {
            checkoutStatus = 'early';
            earlyMinutes = Math.floor(checkoutEarlyTime.diff(checkoutTime, 'minutes'));
          }
          
          // 先插入数据库
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkout', checkoutTime.format('YYYY-MM-DD HH:mm:ss'), checkoutStatus, 0, earlyMinutes, checkoutTime.format('YYYY-MM-DD HH:mm:ss')]
          );
          
          // 再更新缓存
          cacheStore.addAttendance({
            employee_id: emp.id,
            type: 'checkout',
            punch_time: checkoutTime.format('YYYY-MM-DD HH:mm:ss'),
            status: checkoutStatus,
            early_minutes: earlyMinutes
          });
          
          checkoutCount++;
          console.log(`  ✅ 员工 ${emp.name} (${emp.employee_no}) 下班打卡：${checkoutTime.format('HH:mm:ss')} ${checkoutStatus === 'early' ? `(早退${earlyMinutes}分钟)` : ''}`);
        }
      }
    }
    
    console.log(`\n✅ 今天打卡记录生成完成！`);
    console.log(`   上班打卡：${checkinCount} 条`);
    console.log(`   下班打卡：${checkoutCount} 条`);
    console.log(`   日期：${todayStr}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 生成今天打卡记录失败:', error);
    process.exit(1);
  }
}

generateTodayAttendance();
