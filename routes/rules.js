const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取默认考勤规则
router.get('/default', async (req, res) => {
  try {
    const [rules] = await db.promise.execute(
      'SELECT * FROM attendance_rules WHERE is_default = 1 LIMIT 1'
    );
    
    if (rules.length === 0) {
      // 如果没有默认规则，返回系统默认值
      return res.json({
        success: true,
        data: {
          id: null,
          rule_name: '默认规则',
          checkin_time: '09:00:00',
          checkin_late_time: '09:15:00',
          checkout_time: '18:00:00',
          checkout_early_time: '17:45:00',
          is_default: 1
        }
      });
    }
    
    res.json({
      success: true,
      data: rules[0]
    });
  } catch (error) {
    console.error('获取考勤规则错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 获取所有考勤规则
router.get('/', async (req, res) => {
  try {
    const [rules] = await db.promise.execute(
      'SELECT * FROM attendance_rules ORDER BY is_default DESC, created_at DESC'
    );
    
    res.json({
      success: true,
      data: rules
    });
  } catch (error) {
    console.error('获取考勤规则列表错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 创建或更新考勤规则
router.post('/', async (req, res) => {
  try {
    const { rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default } = req.body;
    
    if (!checkin_time || !checkin_late_time || !checkout_time || !checkout_early_time) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    // 如果设置为默认规则，先取消其他默认规则
    if (is_default) {
      await db.promise.execute(
        'UPDATE attendance_rules SET is_default = 0 WHERE is_default = 1'
      );
    }

    // 检查是否已存在默认规则
    const [existing] = await db.promise.execute(
      'SELECT * FROM attendance_rules WHERE is_default = 1 LIMIT 1'
    );

    if (existing.length > 0) {
      // 更新现有默认规则
      await db.promise.execute(
        `UPDATE attendance_rules 
         SET rule_name = ?, checkin_time = ?, checkin_late_time = ?, 
             checkout_time = ?, checkout_early_time = ?, is_default = ?
         WHERE is_default = 1`,
        [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default ? 1 : 0]
      );
    } else {
      // 创建新规则
      await db.promise.execute(
        `INSERT INTO attendance_rules 
         (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default ? 1 : 0]
      );
    }

    res.json({
      success: true,
      message: '考勤规则保存成功'
    });
  } catch (error) {
    console.error('保存考勤规则错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

// 更新考勤规则
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default } = req.body;
    
    if (!checkin_time || !checkin_late_time || !checkout_time || !checkout_early_time) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数' 
      });
    }

    // 如果设置为默认规则，先取消其他默认规则
    if (is_default) {
      await db.promise.execute(
        'UPDATE attendance_rules SET is_default = 0 WHERE is_default = 1 AND id != ?',
        [id]
      );
    }

    await db.promise.execute(
      `UPDATE attendance_rules 
       SET rule_name = ?, checkin_time = ?, checkin_late_time = ?, 
           checkout_time = ?, checkout_early_time = ?, is_default = ?
       WHERE id = ?`,
      [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default ? 1 : 0, id]
    );

    res.json({
      success: true,
      message: '考勤规则更新成功'
    });
  } catch (error) {
    console.error('更新考勤规则错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器错误', 
      error: error.message 
    });
  }
});

module.exports = router;
