// 缓存存储模块 - 将所有数据库数据缓存到内存
const db = require('../config/database');
const moment = require('moment');

class CacheStore {
  constructor() {
    this.employees = new Map(); // 员工数据缓存
    this.departments = new Map(); // 部门数据缓存
    this.attendance = new Map(); // 考勤记录缓存 key: employeeId_date, value: {checkin, checkout}
    this.leaves = new Map(); // 请假记录缓存 key: employeeId_date, value: leaveInfo
    this.rules = new Map(); // 考勤规则缓存
    this.lastSyncTime = null;
    this.syncing = false;
  }

  // 同步所有数据到缓存
  async syncAll() {
    if (this.syncing) {
      console.log('⏳ 数据同步正在进行中，跳过本次同步');
      return;
    }

    this.syncing = true;
    console.log('🔄 开始同步数据到缓存...');
    const startTime = Date.now();

    try {
      // 1. 同步部门数据
      const [departments] = await db.promise.execute('SELECT * FROM departments');
      this.departments.clear();
      departments.forEach(dept => {
        this.departments.set(dept.id, dept);
      });
      console.log(`✓ 已同步 ${departments.length} 个部门`);

      // 2. 同步员工数据
      const [employees] = await db.promise.execute(`
        SELECT e.*, d.name as department_name 
        FROM employees e 
        LEFT JOIN departments d ON e.department_id = d.id
      `);
      this.employees.clear();
      employees.forEach(emp => {
        this.employees.set(emp.id, emp);
      });
      console.log(`✓ 已同步 ${employees.length} 名员工`);

      // 3. 同步考勤规则
      const dbType = require('../config/database').dbType;
      const isDefaultValue = dbType === 'postgresql' ? true : 1;
      const [rules] = await db.promise.execute(
        'SELECT * FROM attendance_rules ORDER BY is_default DESC, id ASC'
      );
      this.rules.clear();
      rules.forEach(rule => {
        this.rules.set(rule.id, rule);
      });
      console.log(`✓ 已同步 ${rules.length} 条考勤规则`);

      // 4. 同步考勤记录（最近90天）
      const dateExpr = dbType === 'postgresql' 
        ? 'punch_time::date'
        : 'DATE(punch_time)';
      const startDate = moment().subtract(90, 'days').format('YYYY-MM-DD');
      const [attendanceRecords] = await db.promise.execute(`
        SELECT * FROM attendance 
        WHERE ${dateExpr} >= ?
        ORDER BY employee_id, punch_time ASC
      `, [startDate]);

      this.attendance.clear();
      attendanceRecords.forEach(record => {
        const dateKey = moment(record.punch_time).format('YYYY-MM-DD');
        const cacheKey = `${record.employee_id}_${dateKey}`;
        
        if (!this.attendance.has(cacheKey)) {
          this.attendance.set(cacheKey, {
            employee_id: record.employee_id,
            date: dateKey,
            checkins: [],
            checkouts: []
          });
        }
        
        const dayData = this.attendance.get(cacheKey);
        if (record.type === 'checkin') {
          dayData.checkins.push({
            punch_time: record.punch_time,
            status: record.status,
            late_minutes: record.late_minutes
          });
        } else if (record.type === 'checkout') {
          dayData.checkouts.push({
            punch_time: record.punch_time,
            status: record.status,
            early_minutes: record.early_minutes
          });
        }
      });
      console.log(`✓ 已同步 ${attendanceRecords.length} 条考勤记录（${this.attendance.size} 天）`);

      // 5. 同步请假记录（最近90天）
      const [leaveRecords] = await db.promise.execute(`
        SELECT * FROM leave_requests 
        WHERE end_date >= ?
        ORDER BY employee_id, start_date ASC
      `, [startDate]);

      this.leaves.clear();
      leaveRecords.forEach(leave => {
        const start = moment(leave.start_date);
        const end = moment(leave.end_date);
        for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
          const dateKey = d.format('YYYY-MM-DD');
          const cacheKey = `${leave.employee_id}_${dateKey}`;
          this.leaves.set(cacheKey, {
            employee_id: leave.employee_id,
            date: dateKey,
            leave_type: leave.leave_type,
            status: leave.status,
            days: leave.days
          });
        }
      });
      console.log(`✓ 已同步 ${leaveRecords.length} 条请假记录（${this.leaves.size} 天）`);

      this.lastSyncTime = new Date();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ 数据同步完成！耗时 ${duration} 秒`);
    } catch (error) {
      console.error('❌ 数据同步失败:', error);
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  // 获取员工
  getEmployee(id) {
    return this.employees.get(parseInt(id)) || null;
  }

  // 获取所有员工
  getAllEmployees() {
    return Array.from(this.employees.values());
  }

  // 根据条件查询员工
  getEmployeesByCondition(condition) {
    const employees = this.getAllEmployees();
    if (!condition) return employees;
    
    return employees.filter(emp => {
      if (condition.departmentId && emp.department_id !== parseInt(condition.departmentId)) {
        return false;
      }
      if (condition.name && !emp.name.includes(condition.name) && !emp.employee_no.includes(condition.name)) {
        return false;
      }
      return true;
    });
  }

  // 获取部门
  getDepartment(id) {
    return this.departments.get(parseInt(id)) || null;
  }

  // 获取所有部门
  getAllDepartments() {
    return Array.from(this.departments.values());
  }

  // 获取考勤规则
  getRule(id) {
    return this.rules.get(parseInt(id)) || null;
  }

  // 获取默认考勤规则
  getDefaultRule() {
    const dbType = require('../config/database').dbType;
    const isDefaultValue = dbType === 'postgresql' ? true : 1;
    
    for (const rule of this.rules.values()) {
      if (rule.is_default === isDefaultValue) {
        return rule;
      }
    }
    
    // 如果没有默认规则，返回第一个或默认值
    const firstRule = Array.from(this.rules.values())[0];
    return firstRule || {
      checkin_time: '09:00:00',
      checkin_late_time: '09:15:00',
      checkout_time: '18:00:00',
      checkout_early_time: '17:45:00'
    };
  }

  // 获取某天的考勤记录
  getAttendance(employeeId, date) {
    const dateKey = moment(date).format('YYYY-MM-DD');
    const cacheKey = `${employeeId}_${dateKey}`;
    return this.attendance.get(cacheKey) || null;
  }

  // 获取日期范围内的考勤记录
  getAttendanceRange(employeeIds, startDate, endDate) {
    const results = [];
    const start = moment(startDate);
    const end = moment(endDate);
    
    for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
      const dateKey = d.format('YYYY-MM-DD');
      employeeIds.forEach(empId => {
        const cacheKey = `${empId}_${dateKey}`;
        const dayData = this.attendance.get(cacheKey);
        if (dayData) {
          results.push(dayData);
        }
      });
    }
    
    return results;
  }

  // 获取某天的请假记录
  getLeave(employeeId, date) {
    const dateKey = moment(date).format('YYYY-MM-DD');
    const cacheKey = `${employeeId}_${dateKey}`;
    return this.leaves.get(cacheKey) || null;
  }

  // 获取日期范围内的请假记录
  getLeavesRange(employeeIds, startDate, endDate) {
    const results = [];
    const start = moment(startDate);
    const end = moment(endDate);
    
    for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
      const dateKey = d.format('YYYY-MM-DD');
      employeeIds.forEach(empId => {
        const cacheKey = `${empId}_${dateKey}`;
        const leave = this.leaves.get(cacheKey);
        if (leave) {
          results.push(leave);
        }
      });
    }
    
    return results;
  }

  // 添加考勤记录到缓存
  addAttendance(record) {
    const dateKey = moment(record.punch_time).format('YYYY-MM-DD');
    const cacheKey = `${record.employee_id}_${dateKey}`;
    
    if (!this.attendance.has(cacheKey)) {
      this.attendance.set(cacheKey, {
        employee_id: record.employee_id,
        date: dateKey,
        checkins: [],
        checkouts: []
      });
    }
    
    const dayData = this.attendance.get(cacheKey);
    if (record.type === 'checkin') {
      dayData.checkins.push({
        punch_time: record.punch_time,
        status: record.status,
        late_minutes: record.late_minutes
      });
      // 按时间排序
      dayData.checkins.sort((a, b) => moment(a.punch_time).diff(moment(b.punch_time)));
    } else if (record.type === 'checkout') {
      dayData.checkouts.push({
        punch_time: record.punch_time,
        status: record.status,
        early_minutes: record.early_minutes
      });
      // 按时间排序
      dayData.checkouts.sort((a, b) => moment(a.punch_time).diff(moment(b.punch_time)));
    }
  }

  // 更新员工缓存
  updateEmployee(employee) {
    this.employees.set(employee.id, employee);
  }

  // 删除员工缓存
  deleteEmployee(employeeId) {
    this.employees.delete(parseInt(employeeId));
    // 同时删除该员工的考勤和请假缓存
    const keysToDelete = [];
    for (const key of this.attendance.keys()) {
      if (key.startsWith(`${employeeId}_`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.attendance.delete(key));
    
    for (const key of this.leaves.keys()) {
      if (key.startsWith(`${employeeId}_`)) {
        this.leaves.delete(key);
      }
    }
  }

  // 更新部门缓存
  updateDepartment(department) {
    this.departments.set(department.id, department);
  }

  // 更新考勤规则缓存
  updateRule(rule) {
    this.rules.set(rule.id, rule);
  }

  // 添加请假记录到缓存
  addLeave(leave) {
    const start = moment(leave.start_date);
    const end = moment(leave.end_date);
    for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
      const dateKey = d.format('YYYY-MM-DD');
      const cacheKey = `${leave.employee_id}_${dateKey}`;
      this.leaves.set(cacheKey, {
        employee_id: leave.employee_id,
        date: dateKey,
        leave_type: leave.leave_type,
        status: leave.status,
        days: leave.days
      });
    }
  }

  // 删除请假记录缓存
  deleteLeave(leaveId, employeeId, startDate, endDate) {
    const start = moment(startDate);
    const end = moment(endDate);
    for (let d = moment(start); d.isSameOrBefore(end); d.add(1, 'day')) {
      const dateKey = d.format('YYYY-MM-DD');
      const cacheKey = `${employeeId}_${dateKey}`;
      this.leaves.delete(cacheKey);
    }
  }

  // 获取缓存统计信息
  getStats() {
    return {
      employees: this.employees.size,
      departments: this.departments.size,
      attendance: this.attendance.size,
      leaves: this.leaves.size,
      rules: this.rules.size,
      lastSyncTime: this.lastSyncTime
    };
  }
}

// 创建全局缓存存储实例
const cacheStore = new CacheStore();

// 启动时自动同步数据
cacheStore.syncAll().catch(err => {
  console.error('❌ 初始数据同步失败:', err);
});

// 每5分钟自动同步一次
setInterval(() => {
  cacheStore.syncAll().catch(err => {
    console.error('❌ 定时数据同步失败:', err);
  });
}, 5 * 60 * 1000);

module.exports = cacheStore;
