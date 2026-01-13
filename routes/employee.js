const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取所有员工
router.get('/', async (req, res) => {
  try {
    const { departmentId, keyword } = req.query;
    
    let query = `
      SELECT 
        e.*,
        d.name as department_name
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE 1=1
    `;
    const params = [];
    
    if (departmentId) {
      query += ' AND e.department_id = ?';
      params.push(departmentId);
    }
    
    if (keyword) {
      query += ' AND (e.name LIKE ? OR e.employee_no LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    
    query += ' ORDER BY e.employee_no';
    
    const [employees] = await db.promise.execute(query, params);
    
    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('获取员工列表错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 根据ID获取员工
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [id]
    );
    
    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }
    
    res.json({
      success: true,
      data: employees[0]
    });
  } catch (error) {
    console.error('获取员工信息错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 创建员工
router.post('/', async (req, res) => {
  try {
    const { name, employeeNo, departmentId, position, phone } = req.body;
    
    if (!name || !employeeNo) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数：姓名和工号' 
      });
    }

    // 检查工号是否已存在
    const [existing] = await db.promise.execute(
      'SELECT * FROM employees WHERE employee_no = ?',
      [employeeNo]
    );

    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '工号已存在' 
      });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.promise.execute(
      'INSERT INTO employees (name, employee_no, department_id, position, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, employeeNo, departmentId || null, position || '', phone || '', now]
    );

    res.json({
      success: true,
      message: '员工创建成功'
    });
  } catch (error) {
    console.error('创建员工错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新员工信息
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, employeeNo, departmentId, position, phone, tag } = req.body;
    
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [id]
    );
    
    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    await db.promise.execute(
      'UPDATE employees SET name = ?, employee_no = ?, department_id = ?, position = ?, phone = ?, tag = ? WHERE id = ?',
      [name, employeeNo, departmentId || null, position || '', phone || '', tag || null, id]
    );

    res.json({
      success: true,
      message: '员工信息更新成功'
    });
  } catch (error) {
    console.error('更新员工信息错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新员工标签
router.put('/:id/tag', async (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;
    
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [id]
    );
    
    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    await db.promise.execute(
      'UPDATE employees SET tag = ? WHERE id = ?',
      [tag || null, id]
    );

    res.json({
      success: true,
      message: '员工标签更新成功'
    });
  } catch (error) {
    console.error('更新员工标签错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新员工部门
router.put('/:id/department', async (req, res) => {
  try {
    const { id } = req.params;
    const { departmentId } = req.body;
    
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [id]
    );
    
    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    await db.promise.execute(
      'UPDATE employees SET department_id = ? WHERE id = ?',
      [departmentId || null, id]
    );

    res.json({
      success: true,
      message: '员工部门更新成功'
    });
  } catch (error) {
    console.error('更新员工部门错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 删除员工
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE id = ?',
      [id]
    );
    
    if (employees.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '员工不存在' 
      });
    }

    await db.promise.execute('DELETE FROM employees WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '员工删除成功'
    });
  } catch (error) {
    console.error('删除员工错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

module.exports = router;
