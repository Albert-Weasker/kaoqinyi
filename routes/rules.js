const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取默认考勤规则
router.get('/default', async (req, res) => {
  try {
    const dbType = require('../config/database').dbType;
    const isDefaultValue = dbType === 'postgresql' ? true : 1;
    const [rules] = await db.promise.execute(
      `SELECT * FROM attendance_rules WHERE is_default = ? LIMIT 1`,
      [isDefaultValue]
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

    const dbType = require('../config/database').dbType;
    const trueValue = dbType === 'postgresql' ? true : 1;
    const falseValue = dbType === 'postgresql' ? false : 0;
    
    const isDefaultBool = is_default ? trueValue : falseValue;
    
    // 如果设置为默认规则，先取消其他默认规则
    if (is_default) {
      await db.promise.execute(
        'UPDATE attendance_rules SET is_default = ? WHERE is_default = ?',
        [falseValue, trueValue]
      );
    }

    // 检查是否已存在默认规则
    const [existing] = await db.promise.execute(
      'SELECT * FROM attendance_rules WHERE is_default = ? LIMIT 1',
      [trueValue]
    );
    
    if (existing.length > 0) {
      // 更新现有默认规则
      await db.promise.execute(
        `UPDATE attendance_rules 
         SET rule_name = ?, checkin_time = ?, checkin_late_time = ?, 
             checkout_time = ?, checkout_early_time = ?, is_default = ?
         WHERE id = ?`,
        [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, isDefaultBool, existing[0].id]
      );
    } else {
      // 创建新规则
      // 如果是 PostgreSQL，先确保序列正确
      if (dbType === 'postgresql') {
        try {
          // 修复序列：设置为当前最大 ID + 1
          await db.promise.execute(`
            SELECT setval('attendance_rules_id_seq', COALESCE((SELECT MAX(id) FROM attendance_rules), 0) + 1, false)
          `);
        } catch (seqError) {
          // 序列可能不存在，忽略错误，让数据库自动处理
          console.warn('序列修复警告（可忽略）:', seqError.message);
        }
      }
      
      // 插入新规则
      try {
        await db.promise.execute(
          `INSERT INTO attendance_rules 
           (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, isDefaultBool]
        );
      } catch (insertError) {
        // 如果插入失败（主键冲突），说明序列需要修复
        if (dbType === 'postgresql' && insertError.code === '23505') {
          // 修复序列后重试
          await db.promise.execute(`
            SELECT setval('attendance_rules_id_seq', (SELECT MAX(id) FROM attendance_rules) + 1, false)
          `);
          await db.promise.execute(
            `INSERT INTO attendance_rules 
             (rule_name, checkin_time, checkin_late_time, checkout_time, checkout_early_time, is_default) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, isDefaultBool]
          );
        } else {
          throw insertError;
        }
      }
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

    const dbType = require('../config/database').dbType;
    const trueValue = dbType === 'postgresql' ? true : 1;
    const falseValue = dbType === 'postgresql' ? false : 0;
    const isDefaultBool = is_default ? trueValue : falseValue;
    
    // 如果设置为默认规则，先取消其他默认规则
    if (is_default) {
      await db.promise.execute(
        'UPDATE attendance_rules SET is_default = ? WHERE is_default = ? AND id != ?',
        [falseValue, trueValue, id]
      );
    }

    await db.promise.execute(
      `UPDATE attendance_rules 
       SET rule_name = ?, checkin_time = ?, checkin_late_time = ?, 
           checkout_time = ?, checkout_early_time = ?, is_default = ?
       WHERE id = ?`,
      [rule_name || '默认规则', checkin_time, checkin_late_time, checkout_time, checkout_early_time, isDefaultBool, id]
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
