const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');
const XLSX = require('xlsx');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun } = require('docx');

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

    // 获取默认考勤规则
    const [rules] = await db.promise.execute(
      'SELECT * FROM attendance_rules WHERE is_default = 1 LIMIT 1'
    );
    
    let rule = {
      checkin_time: '09:00:00',
      checkin_late_time: '09:15:00',
      checkout_time: '18:00:00',
      checkout_early_time: '17:45:00'
    };
    
    if (rules.length > 0) {
      rule = rules[0];
    }

    // 检查员工是否存在
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [employeeId]
    );

    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    const employee = employees[0];

    // 检查今天是否已有打卡记录
    const [existingRecords] = await db.promise.execute(
      'SELECT * FROM attendance WHERE employee_id = ? AND DATE(punch_time) = ?',
      [employeeId, today]
    );

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

      // 插入上班打卡记录
      await db.promise.execute(
        'INSERT INTO attendance (employee_id, type, punch_time, address, longitude, latitude, status, late_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [employeeId, 'checkin', nowStr, address || '', longitude || null, latitude || null, status, lateMinutes, nowStr]
      );

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

      // 插入下班打卡记录
      await db.promise.execute(
        'INSERT INTO attendance (employee_id, type, punch_time, address, longitude, latitude, status, early_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [employeeId, 'checkout', nowStr, address || '', longitude || null, latitude || null, status, earlyMinutes, nowStr]
      );

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
    query += ` LIMIT ${offset}, ${pageSizeNum}`;

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

// 获取今日打卡统计
router.get('/today-stats', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    
    // 应到人数：员工总数
    const [allEmployees] = await db.promise.execute(`
      SELECT e.id, e.name, e.employee_no, d.name AS department
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
    `);
    const expectedCount = allEmployees.length;

    // 今日到岗（上班到岗视为实到）
    const [todayCheckins] = await db.promise.execute(`
      SELECT DISTINCT employee_id 
      FROM attendance 
      WHERE DATE(punch_time) = ? AND type = 'checkin'
    `, [today]);
    const presentIds = todayCheckins.map(r => r.employee_id);
    const presentCount = presentIds.length;

    // 迟到、早退记录
    const [abnormalCheckins] = await db.promise.execute(`
      SELECT a.employee_id, a.type, a.status, a.punch_time, e.name, e.employee_no, d.name AS department
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE DATE(a.punch_time) = ? AND a.status IN ('late', 'early')
      ORDER BY a.punch_time DESC
    `, [today]);

    // 未到：未上班到岗的员工
    const absentEmployees = allEmployees.filter(emp => !presentIds.includes(emp.id));
    const absentCount = absentEmployees.length;

    // 组装异常列表：优先展示迟到/早退，其次未到
    const anomalies = [];
    abnormalCheckins.forEach(item => {
      const statusLabel = item.status === 'late' ? '迟到' : '早退';
      anomalies.push({
        employee_id: item.employee_id,
        name: item.name,
        department: item.department || '未分配',
        status: statusLabel,
        punch_time: item.punch_time,
        reason: moment(item.punch_time).format('HH:mm')
      });
    });

    absentEmployees.forEach(emp => {
      anomalies.push({
        employee_id: emp.id,
        name: emp.name,
        department: emp.department || '未分配',
        status: '未到',
        punch_time: null,
        reason: '未请假'
      });
    });

    // 今日待审批请假数量
    const [pendingLeaves] = await db.promise.execute(`
      SELECT COUNT(*) AS pending_count
      FROM leave_requests
      WHERE status = 'pending'
        AND start_date <= ? AND end_date >= ?
    `, [today, today]);

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

    res.json({
      success: true,
      data: {
        date: today,
        expectedCount,
        presentCount,
        absentCount,
        anomalies,
        pendingLeaveCount: pendingLeaves[0].pending_count || 0,
        alertText,
        alertType
      }
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
    
    // 构建基础查询条件
    let whereConditions = [];
    const params = [];
    
    if (startDate) {
      whereConditions.push('DATE(a.punch_time) >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      whereConditions.push('DATE(a.punch_time) <= ?');
      params.push(endDate);
    }
    
    if (departmentId) {
      whereConditions.push('e.department_id = ?');
      params.push(departmentId);
    }
    
    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';
    
    // 1. 每日考勤趋势
    const dailyTrendQuery = `
      SELECT 
        DATE(a.punch_time) as date,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      ${departmentId ? 'LEFT JOIN employees e ON a.employee_id = e.id' : ''}
      ${whereClause}
      GROUP BY DATE(a.punch_time)
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
    const abnormalStatsQuery = `
      SELECT 
        e.name as employee_name,
        e.employee_no,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count,
        SUM(CASE WHEN a.status = 'late' THEN a.late_minutes ELSE 0 END) as total_late_minutes,
        SUM(CASE WHEN a.status = 'early' THEN a.early_minutes ELSE 0 END) as total_early_minutes
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      ${whereClause}
      GROUP BY a.employee_id, e.name, e.employee_no
      HAVING late_count > 0 OR early_count > 0
      ORDER BY (late_count + early_count) DESC
      LIMIT 10
    `;
    
    // 5. 月度考勤汇总
    const monthlyStatsQuery = `
      SELECT 
        DATE_FORMAT(a.punch_time, '%Y-%m') as month,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      ${departmentId ? 'LEFT JOIN employees e ON a.employee_id = e.id' : ''}
      ${whereClause}
      GROUP BY DATE_FORMAT(a.punch_time, '%Y-%m')
      ORDER BY month ASC
    `;
    
    // 执行查询（每个查询使用相同的参数）
    const [dailyTrend] = await db.promise.execute(dailyTrendQuery, params);
    
    // 部门统计需要独立的参数（因为whereClause可能不同）
    const deptWhereConditions = [];
    const deptParams = [];
    if (startDate) {
      deptWhereConditions.push('DATE(a.punch_time) >= ?');
      deptParams.push(startDate);
    }
    if (endDate) {
      deptWhereConditions.push('DATE(a.punch_time) <= ?');
      deptParams.push(endDate);
    }
    if (departmentId) {
      deptWhereConditions.push('e.department_id = ?');
      deptParams.push(departmentId);
    }
    const deptWhereClause = deptWhereConditions.length > 0 
      ? 'WHERE ' + deptWhereConditions.join(' AND ')
      : '';
    
    const departmentStatsQueryFinal = `
      SELECT 
        COALESCE(d.name, '未分配') as department_name,
        COUNT(CASE WHEN a.type = 'checkin' THEN 1 END) as checkin_count,
        COUNT(CASE WHEN a.type = 'checkout' THEN 1 END) as checkout_count,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'early' THEN 1 END) as early_count
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      ${deptWhereClause}
      GROUP BY d.id, d.name
      ORDER BY checkin_count DESC
    `;
    
    const [departmentStats] = await db.promise.execute(departmentStatsQueryFinal, deptParams);
    const [statusStats] = await db.promise.execute(statusStatsQuery, params);
    const [abnormalStats] = await db.promise.execute(abnormalStatsQuery, params);
    const [monthlyStats] = await db.promise.execute(monthlyStatsQuery, params);
    
    res.json({
      success: true,
      data: {
        dailyTrend,
        departmentStats,
        statusStats,
        abnormalStats,
        monthlyStats
      }
    });
  } catch (error) {
    console.error('获取统计数据错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
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
        const [existingCheckin] = await db.promise.execute(
          'SELECT id FROM attendance WHERE employee_id = ? AND type = ? AND DATE(punch_time) = DATE(?)',
          [emp.id, 'checkin', checkinTime]
        );
        
        if (existingCheckin.length === 0) {
          await db.promise.execute(
            'INSERT INTO attendance (employee_id, type, punch_time, status, late_minutes, early_minutes) VALUES (?, ?, ?, ?, ?, ?)',
            [emp.id, 'checkin', checkinTime, status, lateMinutes, 0]
          );
          count++;
        }
        
        // 检查是否已存在相同的打卡记录
        const [existingCheckout] = await db.promise.execute(
          'SELECT id FROM attendance WHERE employee_id = ? AND type = ? AND DATE(punch_time) = DATE(?)',
          [emp.id, 'checkout', checkoutTime]
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

module.exports = router;
