const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');
const XLSX = require('xlsx');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun } = require('docx');
const cache = require('../utils/cache');
const cacheStore = require('../utils/cache-store');
const CACHE_PREFIXES = ['worktime', 'stats', 'today', 'today-stats', 'attendance'];

// 获取数据库类型
const dbType = require('../config/database').dbType;

// 日期表达式辅助函数（兼容 MySQL 和 PostgreSQL）
function getDateExpr(column) {
  return dbType === 'postgresql' 
    ? `${column}::date`
    : `DATE(${column})`;
}

// 统一清理与考勤相关的缓存
function invalidateAttendanceCache() {
  CACHE_PREFIXES.forEach(prefix => cache.clearPrefix(prefix));
}

// 打卡（上班/下班）
router.post('/punch', async (req, res) => {
  try {
    const { employeeId, type, address, longitude, latitude } = req.body; // type: 'checkin' 或 'checkout'
    
    if (!employeeId || !type) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数：员工ID和打卡类型' 
      });
    }

    if (type !== 'checkin' && type !== 'checkout') {
      return res.status(400).json({ 
        success: false, 
        message: '打卡类型错误，必须是 checkin 或 checkout' 
      });
    }

    const now = moment();
    const nowStr = now.format('YYYY-MM-DD HH:mm:ss');
    const today = now.format('YYYY-MM-DD');
    const todayDate = now.format('YYYY-MM-DD');

    // 从缓存获取员工信息
    const employee = cacheStore.getEmployee(employeeId);
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    // 从缓存获取考勤规则
    const rule = cacheStore.getDefaultRule();
    if (!rule) {
      return res.status(404).json({ 
        success: false, 
        message: '未设置考勤规则' 
      });
    }

    // 从缓存检查今天是否已有打卡记录
    const existingAttendance = cacheStore.getAttendance(employeeId, today);
    const existingRecords = [];
    if (existingAttendance) {
      existingAttendance.checkins.forEach(c => {
        existingRecords.push({ type: 'checkin', punch_time: c.punch_time });
      });
      existingAttendance.checkouts.forEach(c => {
        existingRecords.push({ type: 'checkout', punch_time: c.punch_time });
      });
    }

    if (type === 'checkin') {
      // 检查是否已经打过上班卡
      const hasCheckin = existingRecords.some(record => record.type === 'checkin');
      if (hasCheckin) {
        return res.status(400).json({ 
          success: false, 
          message: '今天已经打过上班卡了' 
        });
      }

      // 计算是否迟到
      const checkinLateTime = moment(`${todayDate} ${rule.checkin_late_time}`);
      let status = 'normal';
      let lateMinutes = 0;
      
      if (now.isAfter(checkinLateTime)) {
        status = 'late';
        lateMinutes = Math.floor(now.diff(checkinLateTime, 'minutes', true));
      }

      // 先更新数据库
      await db.promise.execute(
        'INSERT INTO attendance (employee_id, type, punch_time, address, longitude, latitude, status, late_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [employeeId, 'checkin', nowStr, address || '', longitude || null, latitude || null, status, lateMinutes, nowStr]
      );

      // 再更新缓存
      cacheStore.addAttendance({
        employee_id: employeeId,
        type: 'checkin',
        punch_time: nowStr,
        status: status,
        late_minutes: lateMinutes
      });

      // 清除相关缓存
      cache.clearPrefix('today-stats');
      cache.clearPrefix('worktime');
      cache.clearPrefix('stats');

      let message = '上班打卡成功';
      if (status === 'late') {
        message = `上班打卡成功（迟到 ${lateMinutes} 分钟）`;
      }

      res.json({
        success: true,
        message: message,
        data: {
          employeeName: employee.name,
          employeeId: employee.id,
          type: 'checkin',
          punchTime: nowStr,
          address: address || '',
          longitude: longitude || null,
          latitude: latitude || null,
          status: status,
          lateMinutes: lateMinutes
        }
      });
    } else if (type === 'checkout') {
      // 检查是否已经打过下班卡
      const hasCheckout = existingRecords.some(record => record.type === 'checkout');
      if (hasCheckout) {
        return res.status(400).json({ 
          success: false, 
          message: '今天已经打过下班卡了' 
        });
      }

      // 检查是否打过上班卡
      const hasCheckin = existingRecords.some(record => record.type === 'checkin');
      if (!hasCheckin) {
        return res.status(400).json({ 
          success: false, 
          message: '请先打上班卡' 
        });
      }

      // 计算是否早退
      const checkoutEarlyTime = moment(`${todayDate} ${rule.checkout_early_time}`);
      let status = 'normal';
      let earlyMinutes = 0;
      
      if (now.isBefore(checkoutEarlyTime)) {
        status = 'early';
        earlyMinutes = Math.floor(checkoutEarlyTime.diff(now, 'minutes', true));
      }

      // 先更新数据库
      await db.promise.execute(
        'INSERT INTO attendance (employee_id, type, punch_time, address, longitude, latitude, status, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [employeeId, 'checkout', nowStr, address || '', longitude || null, latitude || null, status, earlyMinutes, nowStr]
      );

      // 再更新缓存
      cacheStore.addAttendance({
        employee_id: employeeId,
        type: 'checkout',
        punch_time: nowStr,
        status: status,
        early_minutes: earlyMinutes
      });

      // 清除相关缓存
      cache.clearPrefix('today-stats');
      cache.clearPrefix('worktime');
      cache.clearPrefix('stats');

      let message = '下班打卡成功';
      if (status === 'early') {
        message = `下班打卡成功（早退 ${earlyMinutes} 分钟）`;
      }

      res.json({
        success: true,
        message: message,
        data: {
          employeeName: employee.name,
          employeeId: employee.id,
          type: 'checkout',
          punchTime: nowStr,
          address: address || '',
          longitude: longitude || null,
          latitude: latitude || null,
          status: status,
          earlyMinutes: earlyMinutes
        }
      });
    }
  } catch (error) {
    console.error('打卡错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 获取打卡记录
router.get('/records', async (req, res) => {
  try {
    const { employeeId, startDate, endDate, status, page = 1, pageSize = 20 } = req.query;
    
    let query = `
      SELECT 
        a.*,
        e.name as employee_name,
        e.employee_no,
        d.name as department
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (employeeId) {
      // 支持多个员工ID（逗号分隔）
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          query += ` AND a.employee_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      } else {
        query += ' AND a.employee_id = ?';
        params.push(parseInt(employeeId));
      }
    }

    if (startDate) {
      query += ' AND DATE(a.punch_time) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND DATE(a.punch_time) <= ?';
      params.push(endDate);
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.punch_time DESC';

    // 分页
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 20;
    const offset = (pageNum - 1) * pageSizeNum;
    // 使用 PostgreSQL 兼容的 LIMIT/OFFSET 语法（MySQL 也支持）
    query += ` LIMIT ${pageSizeNum} OFFSET ${offset}`;

    const [records] = await db.promise.execute(query, params);

    // 获取总数
    let countQuery = `
      SELECT COUNT(*) as total
      FROM attendance a
      WHERE 1=1
    `;
    const countParams = [];
    
    if (employeeId) {
      // 支持多个员工ID（逗号分隔）
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          countQuery += ` AND a.employee_id IN (${ids.map(() => '?').join(',')})`;
          countParams.push(...ids);
        }
      } else {
        countQuery += ' AND a.employee_id = ?';
        countParams.push(parseInt(employeeId));
      }
    }
    if (startDate) {
      countQuery += ' AND DATE(a.punch_time) >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ' AND DATE(a.punch_time) <= ?';
      countParams.push(endDate);
    }
    if (status) {
      countQuery += ' AND a.status = ?';
      countParams.push(status);
    }

    const [countResult] = await db.promise.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: records,
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total,
        totalPages: Math.ceil(total / pageSizeNum)
      }
    });
  } catch (error) {
    console.error('获取打卡记录错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 获取今日打卡统计（完全基于缓存）
router.get('/today-stats', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    
    // 生成缓存键（今日统计缓存1分钟）
    const cacheKey = cache.generateKey('today-stats', { date: today });
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    // 从缓存获取所有员工
    const allEmployees = cacheStore.getAllEmployees();
    const expectedCount = allEmployees.length;

    // 从缓存获取今日请假员工
    const leaveEmployeeIds = new Set();
    const pendingLeaveIds = new Set();
    const approvedLeaveIds = new Set();
    
    allEmployees.forEach(emp => {
      const leave = cacheStore.getLeave(emp.id, today);
      if (leave) {
        if (leave.status === 'approved') {
          approvedLeaveIds.add(emp.id);
          leaveEmployeeIds.add(emp.id);
        } else if (leave.status === 'pending') {
          pendingLeaveIds.add(emp.id);
          leaveEmployeeIds.add(emp.id);
        }
      }
    });

    // 从缓存获取今日到岗员工（有checkin记录就算上班）
    const presentIds = new Set();
    const abnormalCheckins = [];
    
    allEmployees.forEach(emp => {
      const attendance = cacheStore.getAttendance(emp.id, today);
      // 只要打了上班卡就算上班
      if (attendance && attendance.checkins.length > 0) {
        presentIds.add(emp.id);
        
        // 检查是否有迟到（取最早的checkin记录）
        const earliestCheckin = attendance.checkins[0];
        if (earliestCheckin && earliestCheckin.status === 'late') {
          abnormalCheckins.push({
            employee_id: emp.id,
            name: emp.name,
            department: emp.department_name || '未分配',
            status: 'late',
            punch_time: earliestCheckin.punch_time,
            reason: moment(earliestCheckin.punch_time).format('HH:mm')
          });
        }
        
        // 检查是否有早退（取最晚的checkout记录）
        if (attendance.checkouts.length > 0) {
          const latestCheckout = attendance.checkouts[attendance.checkouts.length - 1];
          if (latestCheckout && latestCheckout.status === 'early') {
            abnormalCheckins.push({
              employee_id: emp.id,
              name: emp.name,
              department: emp.department_name || '未分配',
              status: 'early',
              punch_time: latestCheckout.punch_time,
              reason: moment(latestCheckout.punch_time).format('HH:mm')
            });
          }
        }
      }
    });
    
    const presentCount = presentIds.size;

    // 未到：未上班到岗且未请假的员工
    const absentEmployees = allEmployees.filter(emp => 
      !presentIds.has(emp.id) && !leaveEmployeeIds.has(emp.id)
    );
    const absentCount = absentEmployees.length;

    // 组装异常列表：优先展示迟到/早退，其次未到
    const anomalies = [];
    abnormalCheckins.slice(0, 50).forEach(item => {
      const statusLabel = item.status === 'late' ? '迟到' : '早退';
      anomalies.push({
        employee_id: item.employee_id,
        name: item.name,
        department: item.department,
        status: statusLabel,
        punch_time: item.punch_time,
        reason: item.reason
      });
    });

    // 限制未到员工列表数量（最多显示100个）
    absentEmployees.slice(0, 100).forEach(emp => {
      anomalies.push({
        employee_id: emp.id,
        name: emp.name,
        department: emp.department_name || '未分配',
        status: '未到',
        punch_time: null,
        reason: '未请假'
      });
    });

    // 顶部提示
    let alertText = '✅ 今日考勤正常';
    let alertType = 'normal';
    const lateCount = abnormalCheckins.filter(a => a.status === 'late').length;
    const earlyCount = abnormalCheckins.filter(a => a.status === 'early').length;
    const notArrivedCount = absentCount;
    const anomalyTotal = lateCount + earlyCount + notArrivedCount;
    if (anomalyTotal > 0) {
      alertType = 'warning';
      const parts = [];
      if (notArrivedCount > 0) parts.push(`${notArrivedCount} 人未到`);
      if (lateCount > 0) parts.push(`${lateCount} 人迟到`);
      if (earlyCount > 0) parts.push(`${earlyCount} 人早退`);
      alertText = `⚠️ 今日异常：${parts.join('｜')}`;
    }

    const resultData = {
      date: today,
      expectedCount,
      presentCount,
      absentCount,
      leaveCount: leaveEmployeeIds.size, // 请假人数
      anomalies,
      pendingLeaveCount: pendingLeaveIds.size,
      approvedLeaveCount: approvedLeaveIds.size,
      alertText,
      alertType
    };
    
    // 缓存结果（1分钟）
    cache.set(cacheKey, resultData, 60 * 1000);
    
    res.json({
      success: true,
      data: resultData
    });
  } catch (error) {
    console.error('获取今日统计错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 导出考勤记录（Excel）
router.get('/export/excel', async (req, res) => {
  try {
    const { employeeId, startDate, endDate, status } = req.query;
    
    // 构建查询（与records接口相同的逻辑）
    let query = `
      SELECT 
        a.*,
        e.name as employee_name,
        e.employee_no,
        d.name as department
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (employeeId) {
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          query += ` AND a.employee_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      } else {
        query += ' AND a.employee_id = ?';
        params.push(parseInt(employeeId));
      }
    }

    if (startDate) {
      query += ' AND DATE(a.punch_time) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND DATE(a.punch_time) <= ?';
      params.push(endDate);
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.punch_time DESC';

    const [records] = await db.promise.execute(query, params);

    // 准备Excel数据
    const excelData = records.map(record => ({
      '时间': moment(record.punch_time).format('YYYY-MM-DD HH:mm:ss'),
      '员工姓名': record.employee_name || '',
      '工号': record.employee_no || '',
      '部门': record.department || '未分配',
      '打卡类型': record.type === 'checkin' ? '上班' : '下班',
      '状态': record.status === 'normal' ? '正常' : (record.status === 'late' ? '迟到' : '早退'),
      '迟到分钟数': record.late_minutes || 0,
      '早退分钟数': record.early_minutes || 0,
      '异常时长': record.status === 'late' ? `${record.late_minutes}分钟` : (record.status === 'early' ? `${record.early_minutes}分钟` : '-')
    }));

    // 创建工作簿
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '考勤记录');

    // 设置列宽
    const colWidths = [
      { wch: 20 }, // 时间
      { wch: 12 }, // 员工姓名
      { wch: 10 }, // 工号
      { wch: 12 }, // 部门
      { wch: 10 }, // 打卡类型
      { wch: 8 },  // 状态
      { wch: 12 }, // 迟到分钟数
      { wch: 12 }, // 早退分钟数
      { wch: 12 }  // 异常时长
    ];
    worksheet['!cols'] = colWidths;

    // 生成Excel文件
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // 设置响应头
    const filename = `考勤记录_${moment().format('YYYYMMDD_HHmmss')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    res.send(excelBuffer);
  } catch (error) {
    console.error('导出Excel失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '导出失败', 
      error: error.message 
    });
  }
});

// 导出考勤记录（Word）
router.get('/export/word', async (req, res) => {
  try {
    const { employeeId, startDate, endDate, status } = req.query;
    
    // 构建查询（与records接口相同的逻辑）
    let query = `
      SELECT 
        a.*,
        e.name as employee_name,
        e.employee_no,
        d.name as department
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (employeeId) {
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          query += ` AND a.employee_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      } else {
        query += ' AND a.employee_id = ?';
        params.push(parseInt(employeeId));
      }
    }

    if (startDate) {
      query += ' AND DATE(a.punch_time) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND DATE(a.punch_time) <= ?';
      params.push(endDate);
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.punch_time DESC';

    const [records] = await db.promise.execute(query, params);

    // 创建Word文档表格行
    const tableRows = [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: '时间' })] }),
          new TableCell({ children: [new Paragraph({ text: '员工姓名' })] }),
          new TableCell({ children: [new Paragraph({ text: '工号' })] }),
          new TableCell({ children: [new Paragraph({ text: '部门' })] }),
          new TableCell({ children: [new Paragraph({ text: '打卡类型' })] }),
          new TableCell({ children: [new Paragraph({ text: '状态' })] }),
          new TableCell({ children: [new Paragraph({ text: '异常时长' })] })
        ]
      })
    ];

    records.forEach(record => {
      const statusText = record.status === 'normal' ? '正常' : (record.status === 'late' ? '迟到' : '早退');
      const abnormalTime = record.status === 'late' ? `${record.late_minutes}分钟` : (record.status === 'early' ? `${record.early_minutes}分钟` : '-');
      
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: moment(record.punch_time).format('YYYY-MM-DD HH:mm:ss') })] }),
            new TableCell({ children: [new Paragraph({ text: record.employee_name || '' })] }),
            new TableCell({ children: [new Paragraph({ text: record.employee_no || '' })] }),
            new TableCell({ children: [new Paragraph({ text: record.department || '未分配' })] }),
            new TableCell({ children: [new Paragraph({ text: record.type === 'checkin' ? '上班' : '下班' })] }),
            new TableCell({ children: [new Paragraph({ text: statusText })] }),
            new TableCell({ children: [new Paragraph({ text: abnormalTime })] })
          ]
        })
      );
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [new TextRun({ text: '考勤记录表', bold: true, size: 32 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
          }),
          new Paragraph({
            children: [new TextRun({ text: `导出时间：${moment().format('YYYY年MM月DD日 HH:mm:ss')}` })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
          }),
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          })
        ]
      }]
    });

    // 生成Word文件
    const buffer = await Packer.toBuffer(doc);

    // 设置响应头
    const filename = `考勤记录_${moment().format('YYYYMMDD_HHmmss')}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    res.send(buffer);
  } catch (error) {
    console.error('导出Word失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '导出失败', 
      error: error.message 
    });
  }
});

// 获取统计数据
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate, departmentId } = req.query;
    
    // 生成缓存键
    const cacheKey = cache.generateKey('stats', { startDate, endDate, departmentId });
    
    // 尝试从缓存获取
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    // 构建基础查询条件
    let whereConditions = [];
    const params = [];
    
    // 优化：使用日期范围查询而不是 DATE() 函数，提高性能
    const dateExpr = getDateExpr('a.punch_time');
    
    if (startDate) {
      whereConditions.push(`${dateExpr} >= ?`);
      params.push(startDate);
    }
    
    if (endDate) {
      whereConditions.push(`${dateExpr} <= ?`);
      params.push(endDate);
    }
    
    if (departmentId) {
      whereConditions.push('e.department_id = ?');
      params.push(departmentId);
    }
    
    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';
    
    // 1. 每日考勤趋势（优化：使用日期表达式）
    const dailyTrendQuery = `
      SELECT 
        ${dateExpr} as date,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      ${departmentId ? 'LEFT JOIN employees e ON a.employee_id = e.id' : ''}
      ${whereClause}
      GROUP BY ${dateExpr}
      ORDER BY date ASC
    `;
    
    // 2. 部门考勤统计
    const departmentStatsQuery = `
      SELECT 
        COALESCE(d.name, '未分配') as department_name,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      ${whereClause}
      GROUP BY d.id, d.name
      ORDER BY checkin_count DESC
    `;
    
    // 3. 考勤状态分布
    const statusStatsQuery = `
      SELECT 
        a.status,
        COUNT(*) as count
      FROM attendance a
      ${departmentId ? 'LEFT JOIN employees e ON a.employee_id = e.id' : ''}
      ${whereClause}
      GROUP BY a.status
    `;
    
    // 4. 迟到早退统计（按员工）
    const dbType = require('../config/database').dbType;
    // PostgreSQL 的 HAVING 子句不能直接使用别名，需要重复表达式
    const lateCountExpr = "COUNT(CASE WHEN a.status = 'late' THEN 1 END)";
    const earlyCountExpr = "COUNT(CASE WHEN a.status = 'early' THEN 1 END)";
    const abnormalStatsQuery = `
      SELECT 
        e.name as employee_name,
        e.employee_no,
        ${lateCountExpr} as late_count,
        ${earlyCountExpr} as early_count,
        SUM(CASE WHEN a.status = 'late' THEN a.late_minutes ELSE 0 END) as total_late_minutes,
        SUM(CASE WHEN a.status = 'early' THEN a.early_minutes ELSE 0 END) as total_early_minutes
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      ${whereClause}
      GROUP BY a.employee_id, e.name, e.employee_no
      HAVING ${lateCountExpr} > 0 OR ${earlyCountExpr} > 0
      ORDER BY (${lateCountExpr} + ${earlyCountExpr}) DESC
      LIMIT 10
    `;
    
    // 5. 月度考勤汇总
    // MySQL 使用 DATE_FORMAT，PostgreSQL 使用 TO_CHAR
    const monthExpr = dbType === 'postgresql' 
      ? "TO_CHAR(a.punch_time, 'YYYY-MM')"
      : "DATE_FORMAT(a.punch_time, '%Y-%m')";
    const monthlyStatsQuery = `
      SELECT 
        ${monthExpr} as month,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      ${departmentId ? 'LEFT JOIN employees e ON a.employee_id = e.id' : ''}
      ${whereClause}
      GROUP BY ${monthExpr}
      ORDER BY month ASC
    `;
    
    // 并行执行所有查询以提高性能
    const [dailyTrend, departmentStats, statusStats, abnormalStats, monthlyStats] = await Promise.all([
      db.promise.execute(dailyTrendQuery, params),
      db.promise.execute(departmentStatsQuery, params),
      db.promise.execute(statusStatsQuery, params),
      db.promise.execute(abnormalStatsQuery, params),
      db.promise.execute(monthlyStatsQuery, params)
    ]);
    
    const resultData = {
      dailyTrend: dailyTrend[0],
      departmentStats: departmentStats[0],
      statusStats: statusStats[0],
      abnormalStats: abnormalStats[0],
      monthlyStats: monthlyStats[0]
    };
    
    // 缓存结果（5分钟）
    cache.set(cacheKey, resultData, 5 * 60 * 1000);
    
    res.json({
      success: true,
      data: resultData
    });
  } catch (error) {
    console.error('获取统计数据错误:', error);
    
    // 返回更友好的错误信息
    let errorMessage = '服务器错误';
    if (error.message && error.message.includes('timeout')) {
      errorMessage = '查询超时，请缩小日期范围后重试';
    } else if (error.message && error.message.includes('connection')) {
      errorMessage = '数据库连接失败，请稍后重试';
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage, 
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 连接考勤机
router.post('/connect-device', async (req, res) => {
  try {
    const { ip, port, user, password } = req.body;
    
    if (!ip || !port) {
      return res.status(400).json({
        success: false,
        message: '请提供考勤机IP地址和端口'
      });
    }
    
    // 模拟连接考勤机（实际项目中需要集成真实的考勤机SDK）
    // 这里返回模拟数据，实际使用时需要调用考勤机SDK
    console.log(`尝试连接考勤机: ${ip}:${port}, 用户: ${user}`);
    
    // 模拟连接延迟
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 模拟连接成功（实际应该验证连接）
    res.json({
      success: true,
      message: '连接成功',
      data: {
        deviceInfo: '中控考勤机 ZKTeco',
        ip,
        port,
        connected: true
      }
    });
  } catch (error) {
    console.error('连接考勤机错误:', error);
    res.status(500).json({
      success: false,
      message: '连接失败',
      error: error.message
    });
  }
});

// 从考勤机导入数据
router.post('/import-device', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: '请提供日期范围'
      });
    }
    
    // 模拟从考勤机获取数据（实际项目中需要调用考勤机SDK获取真实数据）
    console.log(`从考勤机导入数据: ${startDate} 至 ${endDate}`);
    
    // 模拟获取考勤数据
    // 实际应该调用考勤机SDK，例如：
    // const records = await deviceSDK.getAttendanceRecords(startDate, endDate);
    
    // 这里我们模拟一些数据，实际使用时需要替换为真实数据
    const mockRecords = [];
    
    // 获取该日期范围内的员工
    const [employees] = await db.promise.execute(
      'SELECT id, employee_no FROM employees LIMIT 10'
    );
    
    // 生成模拟数据
    const start = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      for (const emp of employees) {
        // 模拟上班打卡（80%正常，20%迟到）
        const checkinHour = Math.random() < 0.8 ? 8 : 8 + Math.floor(Math.random() * 3) + 1;
        const checkinMinute = Math.floor(Math.random() * 60);
        const checkinTime = new Date(d);
        checkinTime.setHours(checkinHour, checkinMinute, 0);
        
        let status = 'normal';
        let lateMinutes = 0;
        if (checkinHour > 9 || (checkinHour === 9 && checkinMinute > 15)) {
          status = 'late';
          const lateTime = new Date(d);
          lateTime.setHours(9, 15, 0);
          lateMinutes = Math.floor((checkinTime - lateTime) / (1000 * 60));
        }
        
        // 模拟下班打卡（80%正常，20%早退）
        const isEarly = Math.random() < 0.2;
        const checkoutHour = isEarly ? 17 : 18;
        const checkoutMinute = isEarly ? Math.floor(Math.random() * 45) : Math.floor(Math.random() * 60);
        const checkoutTime = new Date(d);
        checkoutTime.setHours(checkoutHour, checkoutMinute, 0);
        
        let checkoutStatus = 'normal';
        let earlyMinutes = 0;
        if (isEarly) {
          checkoutStatus = 'early';
          const earlyTime = new Date(d);
          earlyTime.setHours(17, 45, 0);
          earlyMinutes = Math.floor((earlyTime - checkoutTime) / (1000 * 60));
        }
        
        // 检查是否已存在相同的打卡记录（避免重复导入）
        const checkinDateExpr = getDateExpr('punch_time');
        const checkinDate = moment(checkinTime).format('YYYY-MM-DD');
        const [existingCheckin] = await db.promise.execute(
          `SELECT id FROM attendance WHERE employee_id = ? AND type = ? AND ${checkinDateExpr} = ?`,
          [emp.id, 'checkin', checkinDate]
        );
        
        if (existingCheckin.length === 0) {
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes) VALUES (?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkin', checkinTime, status, lateMinutes, 0]
          );
          count++;
        }
        
        // 检查是否已存在相同的打卡记录
        const checkoutDateExpr = getDateExpr('punch_time');
        const checkoutDate = moment(checkoutTime).format('YYYY-MM-DD');
        const [existingCheckout] = await db.promise.execute(
          `SELECT id FROM attendance WHERE employee_id = ? AND type = ? AND ${checkoutDateExpr} = ?`,
          [emp.id, 'checkout', checkoutDate]
        );
        
        if (existingCheckout.length === 0) {
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes) VALUES (?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkout', checkoutTime, checkoutStatus, 0, earlyMinutes]
          );
          count++;
        }
      }
    }
    
    // 数据变动后清理缓存
    invalidateAttendanceCache();
    
    res.json({
      success: true,
      message: '导入成功',
      data: {
        count,
        startDate,
        endDate
      }
    });
  } catch (error) {
    console.error('导入考勤机数据错误:', error);
    res.status(500).json({
      success: false,
      message: '导入失败',
      error: error.message
    });
  }
});

// 获取员工工作时长统计
router.get('/worktime', async (req, res) => {
  try {
    const { employeeId, employeeName, departmentId, startDate, endDate, groupBy = 'day' } = req.query;
    
    // 支持按员工ID、员工姓名或部门查询
    if (!employeeId && !employeeName && !departmentId) {
      return res.status(400).json({
        success: false,
        message: '请选择员工、输入员工姓名或选择部门'
      });
    }
    
    // 构建查询条件
    let employeeIds = [];
    let employeeList = [];
    
    if (employeeId) {
      // 按员工ID查询
      const empId = parseInt(employeeId);
      if (isNaN(empId)) {
        return res.status(400).json({
          success: false,
          message: '员工ID无效'
        });
      }
      employeeIds = [empId];
    } else if (employeeName) {
      // 按员工姓名搜索
      const [employees] = await db.promise.execute(
        `SELECT id FROM employees WHERE name LIKE ? OR employee_no LIKE ?`,
        [`%${employeeName}%`, `%${employeeName}%`]
      );
      if (employees.length === 0) {
        return res.status(404).json({
          success: false,
          message: '未找到匹配的员工'
        });
      }
      employeeIds = employees.map(emp => emp.id);
    } else if (departmentId) {
      // 按部门查询
      const deptId = parseInt(departmentId);
      if (isNaN(deptId)) {
        return res.status(400).json({
          success: false,
          message: '部门ID无效'
        });
      }
      const [employees] = await db.promise.execute(
        `SELECT id FROM employees WHERE department_id = ?`,
        [deptId]
      );
      if (employees.length === 0) {
        return res.status(404).json({
          success: false,
          message: '该部门没有员工'
        });
      }
      employeeIds = employees.map(emp => emp.id);
    }
    
    if (employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '未找到符合条件的员工'
      });
    }
    
    // 生成缓存键
    const cacheKey = cache.generateKey('worktime', { 
      employeeIds: employeeIds.sort().join(','), 
      startDate, 
      endDate, 
      groupBy 
    });
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    // 获取员工信息
    const placeholders = employeeIds.map(() => '?').join(',');
    const [employees] = await db.promise.execute(
      `SELECT e.*, d.name as department_name 
       FROM employees e 
       LEFT JOIN departments d ON e.department_id = d.id 
       WHERE e.id IN (${placeholders})`,
      employeeIds
    );
    
    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: '员工不存在'
      });
    }
    
    employeeList = employees;
    
    // 构建日期范围
    const dateExpr = getDateExpr('a.punch_time');
    let whereConditions = [`a.employee_id IN (${placeholders})`];
    const params = [...employeeIds];
    
    if (startDate) {
      whereConditions.push(`${dateExpr} >= ?`);
      params.push(startDate);
    }
    
    if (endDate) {
      whereConditions.push(`${dateExpr} <= ?`);
      params.push(endDate);
    }
    
    const whereClause = 'WHERE ' + whereConditions.join(' AND ');
    
    // 获取所有打卡记录（按日期分组，计算每天的工作时长）
    let groupByExpr;
    if (groupBy === 'day') {
      groupByExpr = dateExpr;
    } else if (groupBy === 'week') {
      groupByExpr = dbType === 'postgresql' 
        ? `DATE_TRUNC('week', a.punch_time)`
        : `DATE_SUB(${dateExpr}, INTERVAL WEEKDAY(${dateExpr}) DAY)`;
    } else if (groupBy === 'month') {
      groupByExpr = dbType === 'postgresql'
        ? `TO_CHAR(a.punch_time, 'YYYY-MM')`
        : `DATE_FORMAT(a.punch_time, '%Y-%m')`;
    } else {
      groupByExpr = dateExpr;
    }
    
    // 查询所有打卡记录（按日期分组处理）
    const [allRecords] = await db.promise.execute(`
      SELECT 
        ${dateExpr} as date,
        ${groupByExpr} as period,
        a.employee_id,
        a.type,
        a.punch_time,
        a.status
      FROM attendance a
      ${whereClause}
      ORDER BY a.employee_id, a.punch_time ASC
    `, params);
    
    // 获取请假记录
    const leavePlaceholders = employeeIds.map(() => '?').join(',');
    const leaveWhereConditions = [`employee_id IN (${leavePlaceholders})`];
    const leaveParams = [...employeeIds];
    if (startDate) {
      leaveWhereConditions.push('start_date <= ? AND end_date >= ?');
      leaveParams.push(endDate || '9999-12-31', startDate);
    }
    
    const [leaveRecords] = await db.promise.execute(`
      SELECT employee_id, start_date, end_date, leave_type, status, days
      FROM leave_requests
      WHERE ${leaveWhereConditions.join(' AND ')}
      ORDER BY employee_id, start_date DESC
    `, leaveParams);
    
    // 创建请假日期映射（按员工ID和日期）
    const leaveDateMap = new Map();
    leaveRecords.forEach(leave => {
      const empId = leave.employee_id;
      const start = moment(leave.start_date);
      const end = moment(leave.end_date);
      for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
        const dateKey = `${empId}_${d.format('YYYY-MM-DD')}`;
        if (!leaveDateMap.has(dateKey)) {
          leaveDateMap.set(dateKey, {
            leave_type: leave.leave_type,
            status: leave.status,
            days: leave.days
          });
        }
      }
    });
    
    // 处理每天的记录（按日期分组）
    const dateMap = new Map();
    allRecords.forEach(record => {
      // 处理日期格式
      let dateKey;
      if (record.date instanceof Date) {
        dateKey = moment(record.date).format('YYYY-MM-DD');
      } else if (typeof record.date === 'string') {
        dateKey = moment(record.date).format('YYYY-MM-DD');
      } else {
        dateKey = record.date;
      }
      
      const empId = record.employee_id;
      const fullDateKey = `${empId}_${dateKey}`;
      
      // 处理period格式（可能是Date对象或字符串）
      let periodKey;
      if (record.period instanceof Date) {
        if (groupBy === 'day') {
          periodKey = moment(record.period).format('YYYY-MM-DD');
        } else if (groupBy === 'week') {
          periodKey = moment(record.period).format('YYYY-MM-DD');
        } else if (groupBy === 'month') {
          periodKey = moment(record.period).format('YYYY-MM');
        } else {
          periodKey = moment(record.period).format('YYYY-MM-DD');
        }
      } else if (typeof record.period === 'string') {
        // 如果是ISO字符串，转换为日期格式
        if (record.period.includes('T')) {
          if (groupBy === 'day') {
            periodKey = moment(record.period).format('YYYY-MM-DD');
          } else if (groupBy === 'week') {
            periodKey = moment(record.period).format('YYYY-MM-DD');
          } else if (groupBy === 'month') {
            periodKey = moment(record.period).format('YYYY-MM');
          } else {
            periodKey = moment(record.period).format('YYYY-MM-DD');
          }
        } else {
          periodKey = record.period;
        }
      } else {
        periodKey = record.period;
      }
      
      if (!dateMap.has(fullDateKey)) {
        dateMap.set(fullDateKey, {
          employee_id: empId,
          date: dateKey,
          period: periodKey,
          checkins: [],
          checkouts: []
        });
      }
      
      const dayData = dateMap.get(fullDateKey);
      if (record.type === 'checkin') {
        dayData.checkins.push({
          punch_time: record.punch_time,
          status: record.status
        });
      } else if (record.type === 'checkout') {
        dayData.checkouts.push({
          punch_time: record.punch_time,
          status: record.status
        });
      }
    });
    
    // 计算每个员工每天的工作时长
    const periodMap = new Map();
    const employeeStatsMap = new Map();
    
    // 初始化员工统计
    employeeList.forEach(emp => {
      employeeStatsMap.set(emp.id, {
        employee: emp,
        totalDays: 0,
        workDays: 0,
        leaveDays: 0,
        absentDays: 0,
        totalSeconds: 0
      });
    });
    
    dateMap.forEach((dayData, fullDateKey) => {
      const empId = dayData.employee_id;
      const dateKey = dayData.date;
      const date = moment(dateKey);
      const leaveInfo = leaveDateMap.get(fullDateKey);
      const employeeStats = employeeStatsMap.get(empId);
      
      if (!employeeStats) return; // 跳过不存在的员工
      
      let workSeconds = 0;
      let hasCheckin = false;
      let hasCheckout = false;
      let checkinTime = null;
      let checkoutTime = null;
      let status = '正常';
      
      // 获取最早的 checkin 和最晚的 checkout
      if (dayData.checkins.length > 0) {
        hasCheckin = true;
        // 找到最早的 checkin（按时间排序取第一个）
        dayData.checkins.sort((a, b) => {
          return moment(a.punch_time).diff(moment(b.punch_time));
        });
        const earliestCheckin = dayData.checkins[0];
        checkinTime = moment(earliestCheckin.punch_time);
        if (earliestCheckin.status === 'late') {
          status = '迟到';
        }
      }
      
      if (dayData.checkouts.length > 0) {
        hasCheckout = true;
        // 找到最晚的 checkout（按时间排序取最后一个）
        dayData.checkouts.sort((a, b) => {
          return moment(a.punch_time).diff(moment(b.punch_time));
        });
        const latestCheckout = dayData.checkouts[dayData.checkouts.length - 1];
        checkoutTime = moment(latestCheckout.punch_time);
        if (latestCheckout.status === 'early') {
          status = status === '迟到' ? '迟到早退' : '早退';
        }
      }
      
      // 处理跨天情况：如果只有checkin没有checkout，尝试查找第二天的checkout
      if (hasCheckin && !hasCheckout) {
        const nextDateKey = moment(dateKey).add(1, 'day').format('YYYY-MM-DD');
        const nextFullDateKey = `${empId}_${nextDateKey}`;
        const nextDayData = dateMap.get(nextFullDateKey);
        if (nextDayData && nextDayData.checkouts.length > 0) {
          // 找到第二天的第一个checkout（可能是夜班的下班时间）
          nextDayData.checkouts.sort((a, b) => {
            return moment(a.punch_time).diff(moment(b.punch_time));
          });
          const nextDayCheckout = nextDayData.checkouts[0];
          const nextCheckoutTime = moment(nextDayCheckout.punch_time);
          
          // 检查是否是夜班（checkin在当天12点后，checkout在第二天12点前）
          if (checkinTime.hour() >= 12 && nextCheckoutTime.hour() < 12) {
            hasCheckout = true;
            checkoutTime = nextCheckoutTime;
            if (nextDayCheckout.status === 'early') {
              status = status === '迟到' ? '迟到早退' : '早退';
            }
          }
        }
      }
      
      // 处理跨天情况：如果只有checkout没有checkin，尝试查找前一天的checkin
      if (!hasCheckin && hasCheckout) {
        const prevDateKey = moment(dateKey).subtract(1, 'day').format('YYYY-MM-DD');
        const prevFullDateKey = `${empId}_${prevDateKey}`;
        const prevDayData = dateMap.get(prevFullDateKey);
        if (prevDayData && prevDayData.checkins.length > 0) {
          // 找到前一天最后一个checkin（可能是夜班的上班时间）
          prevDayData.checkins.sort((a, b) => {
            return moment(a.punch_time).diff(moment(b.punch_time));
          });
          const prevDayCheckin = prevDayData.checkins[prevDayData.checkins.length - 1];
          const prevCheckinTime = moment(prevDayCheckin.punch_time);
          
          // 检查是否是夜班（checkin在前一天12点后，checkout在当天12点前）
          if (prevCheckinTime.hour() >= 12 && checkoutTime.hour() < 12) {
            hasCheckin = true;
            checkinTime = prevCheckinTime;
            if (prevDayCheckin.status === 'late') {
              status = '迟到';
            }
          }
        }
      }
      
      // 计算工作时长（秒）
      if (hasCheckin && hasCheckout && checkinTime && checkoutTime) {
        const checkinDate = checkinTime.format('YYYY-MM-DD');
        const checkoutDate = checkoutTime.format('YYYY-MM-DD');
        const diffSeconds = checkoutTime.diff(checkinTime, 'seconds');
        const diffHours = checkoutTime.diff(checkinTime, 'hours', true);
        
        // 判断是否为跨天情况
        const isCrossDay = checkinDate !== checkoutDate;
        
        // 判断是否为同一天但checkout时间早于checkin时间（可能是夜班，checkout被错误地标记为当天）
        const isSameDayButReversed = checkinDate === checkoutDate && 
                                      checkoutTime.hour() < checkinTime.hour() && 
                                      checkoutTime.hour() < 12 && 
                                      checkinTime.hour() >= 12;
        
        if (isCrossDay || isSameDayButReversed) {
          // 跨天情况：处理夜班
          let actualCheckoutTime = checkoutTime;
          
          // 如果是同一天但时间倒置，说明checkout应该是第二天的
          if (isSameDayButReversed) {
            actualCheckoutTime = moment(checkoutTime).add(1, 'day');
          }
          
          const diffDays = actualCheckoutTime.diff(checkinTime, 'days');
          const actualDiffHours = actualCheckoutTime.diff(checkinTime, 'hours', true);
          const actualDiffSeconds = actualCheckoutTime.diff(checkinTime, 'seconds');
          
          // 判断是否为夜班：checkin在12点之后，checkout在第二天12点之前，且时间差在24小时内
          const isNightShift = checkinTime.hour() >= 12 && actualCheckoutTime.hour() < 12 && diffDays === 1 && actualDiffHours <= 24;
          
          if (isNightShift) {
            // 夜班：计算从checkin到checkout的工作时长
            const endOfDay = moment(checkinTime).endOf('day');
            const startOfNextDay = actualCheckoutTime.startOf('day');
            const firstPart = endOfDay.diff(checkinTime, 'seconds'); // 当天剩余时间
            const secondPart = actualCheckoutTime.diff(startOfNextDay, 'seconds'); // 第二天到checkout的时间
            workSeconds = firstPart + secondPart;
            
            if (workSeconds > 0 && workSeconds <= 24 * 3600) {
              employeeStats.workDays++;
              employeeStats.totalSeconds += workSeconds;
              status = '夜班';
            } else {
              workSeconds = 0;
              status = '数据异常（跨天异常）';
              console.warn(`员工 ${empId} 在 ${dateKey} 的夜班工作时长异常：${Math.floor(workSeconds / 3600)}小时`);
            }
          } else if (diffDays === 1 && actualDiffHours <= 24 && actualDiffSeconds > 0) {
            // 其他跨天情况，但时间差在24小时内且为正数
            workSeconds = actualDiffSeconds;
            if (workSeconds > 0 && workSeconds <= 24 * 3600) {
              employeeStats.workDays++;
              employeeStats.totalSeconds += workSeconds;
              status = '跨天';
            } else {
              workSeconds = 0;
              status = '数据异常（跨天异常）';
            }
          } else {
            workSeconds = 0;
            status = '数据异常（跨天）';
            console.warn(`员工 ${empId} 在 ${dateKey} 的打卡跨天异常：上班 ${checkinTime.format('YYYY-MM-DD HH:mm:ss')}，下班 ${actualCheckoutTime.format('YYYY-MM-DD HH:mm:ss')}，diffDays=${diffDays}, diffHours=${actualDiffHours.toFixed(2)}`);
          }
        } else {
          // 同一天的情况
          if (diffSeconds > 0) {
            // 如果工作时长超过24小时，可能是数据错误，限制为24小时
            if (diffSeconds > 24 * 3600) {
              workSeconds = 24 * 3600;
              status = '数据异常（超过24小时）';
              console.warn(`员工 ${empId} 在 ${dateKey} 的工作时长异常：${Math.floor(diffSeconds / 3600)}小时`);
            } else {
              workSeconds = diffSeconds;
              employeeStats.workDays++;
              employeeStats.totalSeconds += workSeconds;
            }
          } else {
            // 下班时间早于或等于上班时间，可能是数据错误
            workSeconds = 0;
            status = '数据异常';
            console.warn(`员工 ${empId} 在 ${dateKey} 的打卡时间异常：上班 ${checkinTime.format('YYYY-MM-DD HH:mm:ss')}，下班 ${checkoutTime.format('YYYY-MM-DD HH:mm:ss')}`);
          }
        }
      } else if (hasCheckin) {
        status = '未下班';
        employeeStats.workDays++;
      } else if (hasCheckout) {
        status = '未上班';
      }
      
      // 判断未上班原因
      if (!hasCheckin && !hasCheckout) {
        if (leaveInfo) {
          if (leaveInfo.status === 'approved') {
            status = `请假(${leaveInfo.leave_type})`;
            employeeStats.leaveDays++;
          } else if (leaveInfo.status === 'pending') {
            status = `待审批(${leaveInfo.leave_type})`;
            employeeStats.leaveDays++;
          } else {
            status = '未到';
            employeeStats.absentDays++;
          }
        } else {
          status = '未到';
          employeeStats.absentDays++;
        }
      }
      
      // 按时间段分组
      let periodKey = dayData.period;
      // 格式化periodKey用于分组（统一格式）
      if (typeof periodKey === 'string' && periodKey.includes('T')) {
        // 如果是ISO日期字符串，转换为日期格式
        const date = moment(periodKey);
        if (date.isValid()) {
          if (groupBy === 'day') {
            periodKey = date.format('YYYY-MM-DD');
          } else if (groupBy === 'week') {
            periodKey = date.format('YYYY-MM-DD');
          } else if (groupBy === 'month') {
            periodKey = date.format('YYYY-MM');
          }
        }
      } else if (periodKey instanceof Date) {
        const date = moment(periodKey);
        if (groupBy === 'day') {
          periodKey = date.format('YYYY-MM-DD');
        } else if (groupBy === 'week') {
          periodKey = date.format('YYYY-MM-DD');
        } else if (groupBy === 'month') {
          periodKey = date.format('YYYY-MM');
        }
      }
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodKey,
          days: 0,
          workDays: 0,
          leaveDays: 0,
          absentDays: 0,
          totalSeconds: 0,
          details: []
        });
      }
      
      const periodData = periodMap.get(periodKey);
      periodData.days++;
      // 只累加有效的工作时长（大于0且小于24小时）
      if (workSeconds > 0 && workSeconds <= 24 * 3600) {
        periodData.totalSeconds += workSeconds;
      }
      if (hasCheckin && hasCheckout && workSeconds > 0) {
        periodData.workDays++;
      } else if (leaveInfo && leaveInfo.status === 'approved') {
        periodData.leaveDays++;
      } else if (!hasCheckin && !hasCheckout && !leaveInfo) {
        periodData.absentDays++;
      }
      
      periodData.details.push({
        employee_id: empId,
        employee_name: employeeStats.employee.name,
        date: dateKey,
        checkin_time: checkinTime ? checkinTime.format('HH:mm:ss') : null,
        checkout_time: checkoutTime ? checkoutTime.format('HH:mm:ss') : null,
        work_seconds: workSeconds,
        work_hours: Math.floor(workSeconds / 3600),
        work_minutes: Math.floor((workSeconds % 3600) / 60),
        work_seconds_remain: workSeconds % 60,
        status: status,
        leave_type: leaveInfo ? leaveInfo.leave_type : null
      });
    });
    
    // 转换为数组并排序（处理period格式）
    const periodStats = Array.from(periodMap.values()).map(period => {
      // 格式化period显示
      let periodDisplay = period.period;
      if (typeof period.period === 'string' && period.period.includes('T')) {
        // 如果是ISO日期字符串，转换为日期格式
        const date = moment(period.period);
        if (date.isValid()) {
          if (groupBy === 'day') {
            periodDisplay = date.format('YYYY-MM-DD');
          } else if (groupBy === 'week') {
            periodDisplay = date.format('YYYY-MM-DD');
          } else if (groupBy === 'month') {
            periodDisplay = date.format('YYYY-MM');
          }
        }
      } else if (period.period instanceof Date) {
        const date = moment(period.period);
        if (groupBy === 'day') {
          periodDisplay = date.format('YYYY-MM-DD');
        } else if (groupBy === 'week') {
          periodDisplay = date.format('YYYY-MM-DD');
        } else if (groupBy === 'month') {
          periodDisplay = date.format('YYYY-MM');
        }
      }
      return {
        ...period,
        period: periodDisplay,
        periodKey: period.period // 保留原始值用于排序和查找
      };
    }).sort((a, b) => {
      // 使用格式化后的period进行排序
      return moment(b.period).diff(moment(a.period));
    });
    
    // 计算汇总统计（所有员工的总和）
    // 总天数应该是实际有数据的日期数（使用uniqueDates）
    const uniqueDates = new Set();
    dateMap.forEach((dayData, fullDateKey) => {
      uniqueDates.add(dayData.date);
    });
    
    let totalDays = uniqueDates.size;
    let totalWorkDays = 0;
    let totalLeaveDays = 0;
    let totalAbsentDays = 0;
    let totalSeconds = 0;
    
    employeeStatsMap.forEach(stats => {
      totalWorkDays += stats.workDays;
      totalLeaveDays += stats.leaveDays;
      totalAbsentDays += stats.absentDays;
      totalSeconds += stats.totalSeconds;
    });
    
    // 格式化总时长
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
    const totalSecondsRemain = totalSeconds % 60;
    
    // 构建结果数据
    const resultData = {
      employees: employeeList.map(emp => ({
        id: emp.id,
        name: emp.name,
        employee_no: emp.employee_no,
        department: emp.department_name || '未分配',
        position: emp.position
      })),
      employeeStats: Array.from(employeeStatsMap.values()).map(stats => {
        const hours = Math.floor(stats.totalSeconds / 3600);
        const minutes = Math.floor((stats.totalSeconds % 3600) / 60);
        const seconds = stats.totalSeconds % 60;
        // 计算该员工实际有数据的日期数
        const empDates = new Set();
        dateMap.forEach((dayData, fullDateKey) => {
          if (dayData.employee_id === stats.employee.id) {
            empDates.add(dayData.date);
          }
        });
        return {
          employee: stats.employee,
          totalDays: empDates.size, // 实际有数据的日期数
          workDays: stats.workDays,
          leaveDays: stats.leaveDays,
          absentDays: stats.absentDays,
          totalSeconds: stats.totalSeconds,
          formattedTime: `${hours}小时${minutes}分钟${seconds}秒`,
          avgWorkHours: stats.workDays > 0 ? (hours / stats.workDays).toFixed(2) : 0
        };
      }),
      summary: {
        totalDays,
        workDays: totalWorkDays,
        leaveDays: totalLeaveDays,
        absentDays: totalAbsentDays,
        totalSeconds,
        totalHours,
        totalMinutes,
        totalSecondsRemain,
        formattedTime: `${totalHours}小时${totalMinutes}分钟${totalSecondsRemain}秒`,
        avgWorkHours: totalWorkDays > 0 ? (totalHours / totalWorkDays).toFixed(2) : 0
      },
      periodStats
    };
    
    // 缓存结果（5分钟）
    cache.set(cacheKey, resultData, 5 * 60 * 1000);
    
    res.json({
      success: true,
      data: resultData
    });
  } catch (error) {
    console.error('获取工作时长统计错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
