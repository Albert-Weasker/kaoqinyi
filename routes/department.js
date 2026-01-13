const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取所有部门
router.get('/', async (req, res) => {
  try {
    const [departments] = await db.promise.execute(
      'SELECT d.*, COUNT(e.id) as employee_count FROM departments d LEFT JOIN employees e ON d.id = e.department_id GROUP BY d.id ORDER BY d.name'
    );
    
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('获取部门列表错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 创建部门
router.post('/', async (req, res) => {
  try {
    const { name, code, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: '部门名称不能为空' 
      });
    }

    await db.promise.execute(
      'INSERT INTO departments (name, code, description) VALUES (?, ?, ?)',
      [name, code || null, description || null]
    );

    res.json({
      success: true,
      message: '部门创建成功'
    });
  } catch (error) {
    console.error('创建部门错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新部门
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: '部门名称不能为空' 
      });
    }

    await db.promise.execute(
      'UPDATE departments SET name = ?, code = ?, description = ? WHERE id = ?',
      [name, code || null, description || null, id]
    );

    res.json({
      success: true,
      message: '部门更新成功'
    });
  } catch (error) {
    console.error('更新部门错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 删除部门
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查是否有员工在该部门
    const [employees] = await db.promise.execute(
      'SELECT COUNT(*) as count FROM employees WHERE department_id = ?',
      [id]
    );
    
    if (employees[0].count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '该部门下还有员工，无法删除' 
      });
    }

    await db.promise.execute('DELETE FROM departments WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '部门删除成功'
    });
  } catch (error) {
    console.error('删除部门错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新员工部门
router.put('/:departmentId/employees/:employeeId', async (req, res) => {
  try {
    const { departmentId, employeeId } = req.params;
    
    await db.promise.execute(
      'UPDATE employees SET department_id = ? WHERE id = ?',
      [departmentId === '0' ? null : departmentId, employeeId]
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

// 获取部门下的员工
router.get('/:id/employees', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [employees] = await db.promise.execute(
      'SELECT * FROM employees WHERE department_id = ? ORDER BY employee_no',
      [id]
    );
    
    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    console.error('获取部门员工错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

module.exports = router;
