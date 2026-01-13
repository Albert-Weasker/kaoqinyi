const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');

// 获取所有请假申请
router.get('/', async (req, res) => {
  try {
    const { status, employeeId, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    
    let query = `
      SELECT 
        l.*,
        e.name as employee_name,
        e.employee_no,
        d.name as department,
        e.position,
        a.name as approver_name
      FROM leave_requests l
      LEFT JOIN employees e ON l.employee_id = e.id
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN employees a ON l.approver_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND l.status = ?';
      params.push(status);
    }

    if (employeeId) {
      // 支持多个员工ID（逗号分隔）
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          query += ` AND l.employee_id IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      } else {
        query += ' AND l.employee_id = ?';
        params.push(parseInt(employeeId));
      }
    }

    if (startDate) {
      query += ' AND l.start_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND l.end_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY l.created_at DESC';

    // 分页
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 20;
    const offset = (pageNum - 1) * pageSizeNum;
    query += ` LIMIT ${offset}, ${pageSizeNum}`;

    const [requests] = await db.promise.execute(query, params);

    // 获取总数
    let countQuery = `
      SELECT COUNT(*) as total
      FROM leave_requests l
      WHERE 1=1
    `;
    const countParams = [];
    
    if (status) {
      countQuery += ' AND l.status = ?';
      countParams.push(status);
    }
    if (employeeId) {
      // 支持多个员工ID（逗号分隔）
      if (employeeId.includes(',')) {
        const ids = employeeId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (ids.length > 0) {
          countQuery += ` AND l.employee_id IN (${ids.map(() => '?').join(',')})`;
          countParams.push(...ids);
        }
      } else {
        countQuery += ' AND l.employee_id = ?';
        countParams.push(parseInt(employeeId));
      }
    }
    if (startDate) {
      countQuery += ' AND l.start_date >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ' AND l.end_date <= ?';
      countParams.push(endDate);
    }

    const [countResult] = await db.promise.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: requests,
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total,
        totalPages: Math.ceil(total / pageSizeNum)
      }
    });
  } catch (error) {
    console.error('获取请假申请错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 创建请假申请
router.post('/', async (req, res) => {
  try {
    const { employeeId, leaveType, startDate, endDate, days, reason } = req.body;
    
    if (!employeeId || !leaveType || !startDate || !endDate || !days || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    // 验证日期
    const start = moment(startDate);
    const end = moment(endDate);
    if (end.isBefore(start)) {
      return res.status(400).json({ 
        success: false, 
        message: '结束日期不能早于开始日期' 
      });
    }

    await db.promise.execute(
      `INSERT INTO leave_requests 
       (employee_id, leave_type, start_date, end_date, days, reason, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [employeeId, leaveType, startDate, endDate, days, reason]
    );

    res.json({
      success: true,
      message: '请假申请提交成功'
    });
  } catch (error) {
    console.error('创建请假申请错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 审批请假申请
router.put('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approverId, remark } = req.body;
    
    if (!status || (status !== 'approved' && status !== 'rejected')) {
      return res.status(400).json({ 
        success: false, 
        message: '状态参数错误' 
      });
    }

    const approveTime = moment().format('YYYY-MM-DD HH:mm:ss');

    await db.promise.execute(
      `UPDATE leave_requests 
       SET status = ?, approver_id = ?, approve_time = ?, approve_remark = ? 
       WHERE id = ?`,
      [status, approverId || null, approveTime, remark || null, id]
    );

    res.json({
      success: true,
      message: status === 'approved' ? '请假申请已批准' : '请假申请已拒绝'
    });
  } catch (error) {
    console.error('审批请假申请错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 获取请假统计
router.get('/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        leave_type,
        status,
        COUNT(*) as count,
        SUM(days) as total_days
      FROM leave_requests
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      query += ' AND start_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND end_date <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY leave_type, status';

    const [stats] = await db.promise.execute(query, params);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取请假统计错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 删除请假申请
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [requests] = await db.promise.execute(
      'SELECT * FROM leave_requests WHERE id = ?',
      [id]
    );
    
    if (requests.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '请假申请不存在' 
      });
    }

    await db.promise.execute('DELETE FROM leave_requests WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '请假申请删除成功'
    });
  } catch (error) {
    console.error('删除请假申请错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

module.exports = router;
