// API 基础URL
const API_BASE = '/api';

// 全局状态
let currentPage = 1;
const pageSize = 20;
let employees = [];
let departments = [];

// 前端缓存（使用localStorage + 内存缓存）
const frontendCache = {
    memory: new Map(),
    ttl: {
        todayStats: 30 * 1000, // 30秒
        stats: 60 * 1000, // 1分钟
        employees: 5 * 60 * 1000, // 5分钟
        departments: 10 * 60 * 1000, // 10分钟
        rules: 10 * 60 * 1000 // 10分钟
    },
    
    get(key) {
        // 先检查内存缓存
        const memItem = this.memory.get(key);
        if (memItem && Date.now() < memItem.expires) {
            return memItem.data;
        }
        
        // 再检查localStorage
        try {
            const item = localStorage.getItem(`cache_${key}`);
            if (item) {
                const parsed = JSON.parse(item);
                if (Date.now() < parsed.expires) {
                    // 同步到内存缓存
                    this.memory.set(key, parsed);
                    return parsed.data;
                } else {
                    localStorage.removeItem(`cache_${key}`);
                }
            }
        } catch (e) {
            console.warn('读取缓存失败:', e);
        }
        
        return null;
    },
    
    set(key, data, customTTL) {
        const ttl = customTTL || this.ttl[key] || 60 * 1000;
        const item = {
            data,
            expires: Date.now() + ttl
        };
        
        // 保存到内存
        this.memory.set(key, item);
        
        // 保存到localStorage（异步，不阻塞）
        try {
            localStorage.setItem(`cache_${key}`, JSON.stringify(item));
        } catch (e) {
            console.warn('保存缓存失败:', e);
        }
    },
    
    clear(key) {
        this.memory.delete(key);
        try {
            localStorage.removeItem(`cache_${key}`);
        } catch (e) {
            console.warn('清除缓存失败:', e);
        }
    },
    
    clearPrefix(prefix) {
        // 清除内存缓存
        for (const key of this.memory.keys()) {
            if (key.startsWith(prefix)) {
                this.memory.delete(key);
            }
        }
        
        // 清除localStorage缓存
        try {
            const keys = Object.keys(localStorage);
            keys.forEach(k => {
                if (k.startsWith(`cache_${prefix}`)) {
                    localStorage.removeItem(k);
                }
            });
        } catch (e) {
            console.warn('清除缓存失败:', e);
        }
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 先初始化路由系统，确保页面能正确显示
    initRouter();
    
    // 然后初始化其他功能
    init();
});

// 初始化函数
async function init() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // 并行加载所有数据，提升速度
    await Promise.all([
        loadDepartments(),
        loadEmployees(),
        loadRules(),
        loadTodayStats()
    ]);
    
    // 绑定事件
    document.getElementById('searchBtn')?.addEventListener('click', () => {
        currentPage = 1;
        loadRecords();
    });
    document.getElementById('saveRulesBtn')?.addEventListener('click', saveRules);
    
    // 绑定导出按钮
    document.getElementById('exportExcelBtn')?.addEventListener('click', () => {
        exportRecords('excel');
    });
    document.getElementById('exportWordBtn')?.addEventListener('click', () => {
        exportRecords('word');
    });
    
    // 绑定导航菜单
    initNavigation();
    
    // 绑定主页操作按钮
    document.getElementById('actionApprove')?.addEventListener('click', () => {
        switchPage('leave');
    });
    
    document.getElementById('actionExport')?.addEventListener('click', async () => {
        // 导出今日考勤
        const today = new Date().toISOString().slice(0, 10);
        try {
            showInfo('正在导出今日考勤，请稍候...');
            const params = new URLSearchParams({
                startDate: today,
                endDate: today
            });
            
            const response = await fetch(`${API_BASE}/attendance/export/excel?${params}`, {
                method: 'GET'
            });
            
            if (!response.ok) {
                throw new Error('导出失败');
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `今日考勤_${today}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showSuccess('导出成功！');
        } catch (error) {
            console.error('导出失败:', error);
            showError('导出失败，请稍后重试');
        }
    });
    
    document.getElementById('actionMonthly')?.addEventListener('click', () => {
        switchPage('stats');
    });
    
    // 初始化部门管理
    initDepartmentManagement();
    
    // 初始化员工管理
    initEmployeesManagement();
}

// 初始化导航
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            // 使用 hash 路由
            window.location.hash = page;
        });
    });
}

// 初始化路由系统
function initRouter() {
    // 监听 hash 变化
    window.addEventListener('hashchange', handleRoute);
    
    // 初始加载时处理路由（延迟一点确保 DOM 完全加载）
    setTimeout(() => {
        handleRoute();
    }, 0);
}

// 处理路由
function handleRoute() {
    // 获取当前 hash，去掉 # 号
    const hash = window.location.hash.slice(1) || 'home';
    
    // 切换到对应页面
    switchPage(hash);
    
    // 更新导航菜单活动状态
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(nav => {
        const page = nav.getAttribute('data-page');
        if (page === hash) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }
    });
}

// 切换页面
function switchPage(page) {
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    
    // 显示目标页面
    // 处理特殊页面ID（employee-stats -> employeeStatsPage）
    let pageId = `${page}Page`;
    if (page === 'employee-stats') {
        pageId = 'employeeStatsPage';
    } else if (page === 'home') {
        pageId = 'homePage';
    } else if (page === 'records') {
        pageId = 'recordsPage';
    } else if (page === 'leave') {
        pageId = 'leavePage';
    } else if (page === 'departments') {
        pageId = 'departmentsPage';
    } else if (page === 'employees') {
        pageId = 'employeesPage';
    } else if (page === 'stats') {
        pageId = 'statsPage';
    } else if (page === 'worktime') {
        pageId = 'worktimePage';
    } else if (page === 'rules') {
        pageId = 'rulesPage';
    } else if (page === 'import') {
        pageId = 'importPage';
    }
    
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    } else {
        // 如果页面不存在，默认显示主页
        const homePage = document.getElementById('homePage');
        if (homePage) {
            homePage.classList.add('active');
            page = 'home';
        }
    }
    
    // 更新面包屑
    const breadcrumbText = document.getElementById('breadcrumbText');
    const pageNames = {
        'home': '今日情况',
        'records': '考勤记录',
        'rules': '设置',
        'employees': '员工名单',
        'stats': '月度报表',
        'employee-stats': '员工统计',
        'worktime': '工作时长',
        'leave': '请假审批',
        'departments': '部门设置',
        'import': '数据导入'
    };
    breadcrumbText.textContent = pageNames[page] || '主页';
    
    // 根据页面加载数据
    if (page === 'records') {
        currentPage = 1;
        loadRecords();
    } else if (page === 'leave') {
        loadLeaveRequests();
    } else if (page === 'departments') {
        loadDepartmentsPage();
    } else if (page === 'employees') {
        loadEmployeesPage();
    } else if (page === 'stats') {
        loadStatsPage();
    } else if (page === 'employee-stats') {
        loadEmployeeStatsPage();
    } else if (page === 'worktime') {
        loadWorktimePage();
    } else if (page === 'import') {
        loadImportPage();
    }
}

// 员工标签选项
const EMPLOYEE_TAGS = [
    '稳定', '不稳定', '老黄牛', '刺头', '要离职',
    '优秀', '一般', '待改进', '新人', '老员工',
    '积极', '消极', '能力强', '能力弱', '潜力股',
    '问题员工', '核心员工', '普通员工', '重点关注', '待观察'
];

// 加载考勤规则
async function loadRules() {
    try {
        const response = await fetch(`${API_BASE}/rules/default`);
        const result = await response.json();
        
        if (result.success && result.data) {
            const rule = result.data;
            document.getElementById('checkinTime').value = rule.checkin_time.substring(0, 5);
            document.getElementById('checkinLateTime').value = rule.checkin_late_time.substring(0, 5);
            document.getElementById('checkoutTime').value = rule.checkout_time.substring(0, 5);
            document.getElementById('checkoutEarlyTime').value = rule.checkout_early_time.substring(0, 5);
        }
    } catch (error) {
        console.error('加载考勤规则失败:', error);
    }
}

// 保存考勤规则
async function saveRules() {
    const checkinTime = document.getElementById('checkinTime').value;
    const checkinLateTime = document.getElementById('checkinLateTime').value;
    const checkoutTime = document.getElementById('checkoutTime').value;
    const checkoutEarlyTime = document.getElementById('checkoutEarlyTime').value;
    
    if (!checkinTime || !checkinLateTime || !checkoutTime || !checkoutEarlyTime) {
        showRulesResult('请填写完整的考勤规则', 'error');
        return;
    }
    
    const btn = document.getElementById('saveRulesBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    try {
        const response = await fetch(`${API_BASE}/rules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rule_name: '默认规则',
                checkin_time: `${checkinTime}:00`,
                checkin_late_time: `${checkinLateTime}:00`,
                checkout_time: `${checkoutTime}:00`,
                checkout_early_time: `${checkoutEarlyTime}:00`,
                is_default: 1
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showRulesResult('考勤规则保存成功', 'success');
        } else {
            showRulesResult(result.message || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存考勤规则失败:', error);
        showRulesResult('保存失败，请稍后重试', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// 显示规则保存结果
function showRulesResult(message, type) {
    const resultDiv = document.getElementById('rulesResult');
    resultDiv.textContent = message;
    resultDiv.className = `rules-result ${type}`;
    resultDiv.style.display = 'block';
    
    setTimeout(() => {
        resultDiv.style.display = 'none';
    }, 3000);
}

// 打卡
async function punch(type) {
    const employeeSelect = document.getElementById('employeeSelect');
    const employeeId = employeeSelect.value;
    
    if (!employeeId) {
        showPunchResult('请先选择员工', 'error');
        return;
    }
    
    const btn = type === 'checkin' ? document.getElementById('checkinBtn') : document.getElementById('checkoutBtn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>打卡中...</span>';
    
    try {
        const response = await fetch(`${API_BASE}/attendance/punch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                employeeId: parseInt(employeeId),
                type: type
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showPunchResult(result.message, 'success');
            await loadTodayStats();
            await loadRecords();
        } else {
            showPunchResult(result.message, 'error');
        }
    } catch (error) {
        console.error('打卡失败:', error);
        showPunchResult('打卡失败，请稍后重试', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 更新当前时间
function updateCurrentTime() {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    document.getElementById('currentTime').textContent = timeStr;
}

// 加载部门列表（使用缓存）
async function loadDepartments() {
    try {
        // 先检查缓存
        const cached = frontendCache.get('departments');
        if (cached) {
            departments = cached;
            renderDepartments();
            // 后台静默更新
            loadDepartmentsFromAPI().catch(() => {});
            return;
        }
        
        await loadDepartmentsFromAPI();
    } catch (error) {
        console.error('加载部门列表失败:', error);
    }
}

// 从API加载部门列表
async function loadDepartmentsFromAPI() {
    try {
        const response = await fetch(`${API_BASE}/department`);
        const result = await response.json();
        
        if (result.success) {
            departments = result.data;
            frontendCache.set('departments', departments);
            renderDepartments();
        }
    } catch (error) {
        console.error('加载部门列表失败:', error);
    }
}

// 渲染部门列表（提取为独立函数）
function renderDepartments() {
    // 填充部门下拉框
    const departmentFilter = document.getElementById('departmentFilter');
    const leaveDepartmentFilter = document.getElementById('leaveDepartmentFilter');
    
    if (departmentFilter) {
        departmentFilter.innerHTML = '<option value="">全部部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            departmentFilter.appendChild(option);
        });
    }
    
    if (leaveDepartmentFilter) {
        leaveDepartmentFilter.innerHTML = '<option value="">全部部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            leaveDepartmentFilter.appendChild(option);
        });
    }
}

// 加载员工列表
async function loadEmployees(departmentId = null, keyword = '') {
    try {
        const params = new URLSearchParams();
        if (departmentId) params.append('departmentId', departmentId);
        if (keyword) params.append('keyword', keyword);
        
        const response = await fetch(`${API_BASE}/employee?${params}`);
        const result = await response.json();
        
        if (result.success) {
            employees = result.data;
            
            // 填充员工下拉框（用于请假录入）
            const leaveEmployeeSelect = document.getElementById('leaveEmployeeSelect');
            if (leaveEmployeeSelect) {
                leaveEmployeeSelect.innerHTML = '<option value="">请选择员工</option>';
                employees.forEach(emp => {
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.textContent = `${emp.name} (${emp.employee_no})`;
                    leaveEmployeeSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('加载员工列表失败:', error);
    }
}

// 监听部门选择变化，更新员工列表
document.addEventListener('DOMContentLoaded', () => {
    const departmentFilter = document.getElementById('departmentFilter');
    const leaveDepartmentFilter = document.getElementById('leaveDepartmentFilter');
    const employeeSearch = document.getElementById('employeeSearch');
    const leaveEmployeeSearch = document.getElementById('leaveEmployeeSearch');
    const statusFilter = document.getElementById('statusFilter');
    
    if (departmentFilter) {
        departmentFilter.addEventListener('change', () => {
            loadRecords();
        });
    }
    
    if (employeeSearch) {
        employeeSearch.addEventListener('input', debounce(() => {
            loadRecords();
        }, 500));
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            currentPage = 1;
            loadRecords();
        });
    }
    
    if (leaveDepartmentFilter) {
        leaveDepartmentFilter.addEventListener('change', () => {
            const keyword = leaveEmployeeSearch?.value || '';
            loadEmployees(leaveDepartmentFilter.value || null, keyword);
            loadLeaveRequests();
        });
    }
    
    if (leaveEmployeeSearch) {
        leaveEmployeeSearch.addEventListener('input', debounce(() => {
            const departmentId = leaveDepartmentFilter?.value || null;
            loadEmployees(departmentId, leaveEmployeeSearch.value);
            loadLeaveRequests();
        }, 500));
    }
});

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 加载今日统计（带错误处理和重试，使用缓存）
async function loadTodayStats() {
    try {
        // 先检查缓存
        const cacheKey = 'todayStats';
        const cached = frontendCache.get(cacheKey);
        if (cached) {
            renderTodayStats(cached);
            // 后台静默更新（不阻塞UI）
            loadTodayStatsFromAPI(cacheKey).catch(() => {});
            return;
        }
        
        // 缓存未命中，从API加载
        await loadTodayStatsFromAPI(cacheKey);
    } catch (error) {
        console.error('加载今日统计失败:', error);
        showError('加载今日统计失败，请刷新页面重试');
    }
}

// 从API加载今日统计
async function loadTodayStatsFromAPI(cacheKey) {
    // 添加超时控制（5秒，减少等待时间）
    let controller;
    let timeoutId;
    
    if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 5000);
    }
    
    let response;
    let retries = 0;
    const maxRetries = 1; // 减少重试次数
    
    while (retries <= maxRetries) {
        try {
            const fetchOptions = {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache' // 确保获取最新数据
                }
            };
            
            if (controller) {
                fetchOptions.signal = controller.signal;
            }
            
            response = await fetch(`${API_BASE}/attendance/today-stats`, fetchOptions);
            break;
        } catch (fetchError) {
            retries++;
            if (retries > maxRetries) {
                throw fetchError;
            }
            await new Promise(resolve => setTimeout(resolve, 500 * retries)); // 减少重试等待时间
        }
    }
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'error'}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
        const data = result.data;
        
        // 保存到缓存
        frontendCache.set(cacheKey, data);
        
        renderTodayStats(data);
    } else {
        throw new Error(result.message || '加载失败');
    }
}

// 渲染今日统计（提取为独立函数，便于复用）
function renderTodayStats(data) {
    // 更新核心数字
    const expectedEl = document.getElementById('expectedCount');
    const presentEl = document.getElementById('presentCount');
    const absentEl = document.getElementById('absentCount');
    
    if (expectedEl) expectedEl.textContent = `${data.expectedCount || 0} 人`;
    if (presentEl) presentEl.textContent = `${data.presentCount || 0} / ${data.expectedCount || 0} 人`;
    if (absentEl) absentEl.textContent = `${data.absentCount || 0} / ${data.expectedCount || 0} 人`;
    
    // 更新顶部提示
    const alertBar = document.getElementById('homeAlertBar');
    const alertText = document.getElementById('homeAlertText');
    
    if (alertBar && alertText) {
        if (data.anomalies && data.anomalies.length > 0) {
            const lateCount = data.anomalies.filter(a => a.status === '迟到').length;
            const earlyCount = data.anomalies.filter(a => a.status === '早退').length;
            const absentCount = data.anomalies.filter(a => a.status === '未到').length;
            
            let alertMsg = '⚠️ 今日异常：';
            const parts = [];
            if (absentCount > 0) parts.push(`${absentCount} 人未到`);
            if (lateCount > 0) parts.push(`${lateCount} 人迟到`);
            if (earlyCount > 0) parts.push(`${earlyCount} 人早退`);
            
            alertMsg += parts.join('｜');
            alertText.textContent = alertMsg;
            alertBar.className = 'alert-bar alert-warning';
        } else {
            alertText.textContent = '✅ 今日考勤正常';
            alertBar.className = 'alert-bar alert-success';
        }
    }
    
    // 更新异常列表
    renderAnomaliesTable(data.anomalies || []);
    
    // 更新操作按钮（显示待审批请假数量）
    const approveBtn = document.getElementById('actionApprove');
    if (approveBtn && data.pendingLeaveCount > 0) {
        approveBtn.textContent = `📝 批准请假（${data.pendingLeaveCount}）`;
    }
}

// 渲染异常人员表格
function renderAnomaliesTable(anomalies) {
    const tbody = document.getElementById('anomaliesTableBody');
    if (!tbody) return;
    
    if (!anomalies || anomalies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #999;">今日无异常人员</td></tr>';
        return;
    }
    
    tbody.innerHTML = anomalies.map(item => {
        let timeReason = '';
        if (item.status === '迟到' || item.status === '早退') {
            timeReason = item.punch_time ? moment(item.punch_time).format('HH:mm') : (item.reason || '-');
        } else if (item.status === '未到') {
            timeReason = item.reason || '未请假';
        }
        
        return `
            <tr>
                <td>${item.name || '-'}</td>
                <td>${item.department || '未分配'}</td>
                <td><span class="status-badge status-${item.status === '迟到' ? 'late' : item.status === '早退' ? 'early' : 'absent'}">${item.status}</span></td>
                <td>${timeReason}</td>
            </tr>
        `;
    }).join('');
}

// 加载打卡记录
async function loadRecords() {
    const startDate = document.getElementById('startDate')?.value || '';
    const endDate = document.getElementById('endDate')?.value || '';
    const departmentId = document.getElementById('departmentFilter')?.value || '';
    const keyword = document.getElementById('employeeSearch')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    
    const params = new URLSearchParams({
        page: currentPage,
        pageSize: pageSize
    });
    
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (status) params.append('status', status);
    
    // 如果有部门或关键词，先获取员工列表
    if (departmentId || keyword) {
        const empParams = new URLSearchParams();
        if (departmentId) empParams.append('departmentId', departmentId);
        if (keyword) empParams.append('keyword', keyword);
        
        try {
            const empResponse = await fetch(`${API_BASE}/employee?${empParams}`);
            const empResult = await empResponse.json();
            if (empResult.success && empResult.data.length > 0) {
                const employeeIds = empResult.data.map(e => e.id).join(',');
                params.append('employeeId', employeeIds);
            } else {
                // 没有匹配的员工，返回空结果
                document.getElementById('recordsBody').innerHTML = 
                    '<tr><td colspan="7" class="loading">暂无匹配的记录</td></tr>';
                return;
            }
        } catch (error) {
            console.error('获取员工列表失败:', error);
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/attendance/records?${params}`);
        const result = await response.json();
        
        if (result.success) {
            renderRecords(result.data);
            renderPagination(result.pagination);
        } else {
            document.getElementById('recordsBody').innerHTML = 
                '<tr><td colspan="7" class="loading">加载失败</td></tr>';
        }
    } catch (error) {
        console.error('加载打卡记录失败:', error);
        document.getElementById('recordsBody').innerHTML = 
            '<tr><td colspan="7" class="loading">加载失败</td></tr>';
    }
}

// 渲染打卡记录
function renderRecords(records) {
    const tbody = document.getElementById('recordsBody');
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">暂无记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = records.map(record => {
        const punchTime = new Date(record.punch_time).toLocaleString('zh-CN');
        const typeText = record.type === 'checkin' ? '上班打卡' : '下班打卡';
        const typeClass = record.type === 'checkin' ? 'type-checkin' : 'type-checkout';
        
        // 状态显示
        let statusHtml = '<span class="status-badge status-normal">正常</span>';
        let abnormalTime = '-';
        
        if (record.status === 'late') {
            statusHtml = '<span class="status-badge status-late">迟到</span>';
            abnormalTime = `${record.late_minutes || 0} 分钟`;
        } else if (record.status === 'early') {
            statusHtml = '<span class="status-badge status-early">早退</span>';
            abnormalTime = `${record.early_minutes || 0} 分钟`;
        }
        
        return `
            <tr>
                <td>${punchTime}</td>
                <td>${record.employee_name || '-'}</td>
                <td>${record.employee_no || '-'}</td>
                <td>${record.department || '-'}</td>
                <td><span class="type-badge ${typeClass}">${typeText}</span></td>
                <td>${statusHtml}</td>
                <td>${abnormalTime}</td>
            </tr>
        `;
    }).join('');
}

// 渲染分页
function renderPagination(pagination) {
    const paginationDiv = document.getElementById('pagination');
    
    if (pagination.totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    const { page, totalPages, total } = pagination;
    
    let html = `
        <button ${page === 1 ? 'disabled' : ''} onclick="changePage(${page - 1})">上一页</button>
        <span class="page-info">第 ${page} / ${totalPages} 页 (共 ${total} 条)</span>
        <button ${page === totalPages ? 'disabled' : ''} onclick="changePage(${page + 1})">下一页</button>
    `;
    
    paginationDiv.innerHTML = html;
}

// 切换页面
function changePage(page) {
    currentPage = page;
    loadRecords();
}

// 导出考勤记录
async function exportRecords(format) {
    const startDate = document.getElementById('startDate')?.value || '';
    const endDate = document.getElementById('endDate')?.value || '';
    const departmentId = document.getElementById('departmentFilter')?.value || '';
    const keyword = document.getElementById('employeeSearch')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    
    // 构建查询参数
    const params = new URLSearchParams();
    
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (status) params.append('status', status);
    
    // 如果有部门或关键词，先获取员工列表
    if (departmentId || keyword) {
        const empParams = new URLSearchParams();
        if (departmentId) empParams.append('departmentId', departmentId);
        if (keyword) empParams.append('keyword', keyword);
        
        try {
            const empResponse = await fetch(`${API_BASE}/employee?${empParams}`);
            const empResult = await empResponse.json();
            if (empResult.success && empResult.data.length > 0) {
                const employeeIds = empResult.data.map(e => e.id).join(',');
                params.append('employeeId', employeeIds);
            } else {
                showWarning('没有匹配的员工，无法导出');
                return;
            }
        } catch (error) {
            console.error('获取员工列表失败:', error);
            showError('获取员工列表失败');
            return;
        }
    }
    
    try {
        showInfo('正在导出，请稍候...');
        
        const response = await fetch(`${API_BASE}/attendance/export/${format}?${params}`, {
            method: 'GET'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '导出失败');
        }
        
        // 获取文件名
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `考勤记录_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'docx'}`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
            if (filenameMatch) {
                filename = decodeURIComponent(filenameMatch[1]);
            }
        }
        
        // 下载文件
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showSuccess('导出成功！');
    } catch (error) {
        console.error('导出失败:', error);
        showError('导出失败：' + error.message);
    }
}

// Toast 通知组件
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) {
        // 如果容器不存在，创建它
        const newContainer = document.createElement('div');
        newContainer.id = 'toastContainer';
        newContainer.className = 'toast-container';
        document.body.appendChild(newContainer);
        return showToast(message, type, duration);
    }
    
    // 创建 Toast 元素
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // 图标映射
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    // 如果没有指定类型，默认为 info
    if (!['success', 'error', 'warning', 'info'].includes(type)) {
        type = 'info';
    }
    
    // Toast 内容
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-content">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;
    
    // 添加到容器
    container.appendChild(toast);
    
    // 自动移除
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, duration);
    
    return toast;
}

// 显示消息（通用）- 使用 Toast
function showMessage(message, type = 'info') {
    showToast(message, type);
}

// 便捷方法
function showSuccess(message) {
    showToast(message, 'success');
}

function showError(message) {
    showToast(message, 'error');
}

function showWarning(message) {
    showToast(message, 'warning');
}

function showInfo(message) {
    showToast(message, 'info');
}

// ==================== 请假管理功能 ====================

let leaveCurrentPage = 1;
const leavePageSize = 20;

// 初始化请假管理
function initLeaveManagement() {
    // 绑定事件
    document.getElementById('addLeaveBtn')?.addEventListener('click', () => openLeaveModal());
    document.getElementById('leaveSearchBtn')?.addEventListener('click', () => {
        leaveCurrentPage = 1;
        loadLeaveRequests();
    });
    document.getElementById('closeModal')?.addEventListener('click', () => closeLeaveModal());
    document.getElementById('closeApproveModal')?.addEventListener('click', () => closeApproveModal());
    document.getElementById('cancelLeaveBtn')?.addEventListener('click', () => closeLeaveModal());
    document.getElementById('cancelApproveBtn')?.addEventListener('click', () => closeApproveModal());
    document.getElementById('leaveForm')?.addEventListener('submit', handleLeaveSubmit);
    document.getElementById('approveForm')?.addEventListener('submit', handleApproveSubmit);
    
    // 日期变化时自动计算天数
    const startDateInput = document.getElementById('leaveStartDateInput');
    const endDateInput = document.getElementById('leaveEndDateInput');
    const daysInput = document.getElementById('leaveDays');
    
    if (startDateInput && endDateInput && daysInput) {
        function calculateDays() {
            if (startDateInput.value && endDateInput.value) {
                const start = new Date(startDateInput.value);
                const end = new Date(endDateInput.value);
                if (end >= start) {
                    const diffTime = Math.abs(end - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    daysInput.value = diffDays;
                }
            }
        }
        startDateInput.addEventListener('change', calculateDays);
        endDateInput.addEventListener('change', calculateDays);
    }
}

// 加载请假申请列表
async function loadLeaveRequests() {
    const status = document.getElementById('leaveStatusFilter')?.value || '';
    const departmentId = document.getElementById('leaveDepartmentFilter')?.value || '';
    const keyword = document.getElementById('leaveEmployeeSearch')?.value || '';
    const startDate = document.getElementById('leaveStartDate')?.value || '';
    const endDate = document.getElementById('leaveEndDate')?.value || '';
    
    const params = new URLSearchParams({
        page: leaveCurrentPage,
        pageSize: leavePageSize
    });
    
    if (status) params.append('status', status);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    
    // 如果有部门或关键词，先获取员工列表
    if (departmentId || keyword) {
        const empParams = new URLSearchParams();
        if (departmentId) empParams.append('departmentId', departmentId);
        if (keyword) empParams.append('keyword', keyword);
        
        try {
            const empResponse = await fetch(`${API_BASE}/employee?${empParams}`);
            const empResult = await empResponse.json();
            if (empResult.success && empResult.data.length > 0) {
                const employeeIds = empResult.data.map(e => e.id).join(',');
                params.append('employeeId', employeeIds);
            } else {
                // 没有匹配的员工，返回空结果
                document.getElementById('leaveBody').innerHTML = 
                    '<tr><td colspan="11" class="loading">暂无匹配的记录</td></tr>';
                return;
            }
        } catch (error) {
            console.error('获取员工列表失败:', error);
        }
    }
    
    try {
        const response = await fetch(`${API_BASE}/leave?${params}`);
        const result = await response.json();
        
        if (result.success) {
            renderLeaveRequests(result.data);
            renderLeavePagination(result.pagination);
        } else {
            document.getElementById('leaveBody').innerHTML = 
                '<tr><td colspan="11" class="loading">加载失败</td></tr>';
        }
    } catch (error) {
        console.error('加载请假申请失败:', error);
        document.getElementById('leaveBody').innerHTML = 
            '<tr><td colspan="11" class="loading">加载失败</td></tr>';
    }
}

// 渲染请假申请列表
function renderLeaveRequests(requests) {
    const tbody = document.getElementById('leaveBody');
    
    if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="loading">暂无记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = requests.map(request => {
        const createTime = new Date(request.created_at).toLocaleString('zh-CN');
        const startDate = new Date(request.start_date).toLocaleDateString('zh-CN');
        const endDate = new Date(request.end_date).toLocaleDateString('zh-CN');
        
        let statusHtml = '';
        let statusClass = '';
        if (request.status === 'pending') {
            statusHtml = '<span class="leave-status leave-status-pending">待审批</span>';
        } else if (request.status === 'approved') {
            statusHtml = '<span class="leave-status leave-status-approved">已批准</span>';
        } else {
            statusHtml = '<span class="leave-status leave-status-rejected">已拒绝</span>';
        }
        
        let actions = '';
        if (request.status === 'pending') {
            actions = `
                <button class="btn btn-sm btn-approve" onclick="openApproveModal(${request.id})">审批</button>
                <button class="btn btn-sm btn-delete" onclick="deleteLeaveRequest(${request.id})">删除</button>
            `;
        } else {
            actions = `<button class="btn btn-sm btn-delete" onclick="deleteLeaveRequest(${request.id})">删除</button>`;
        }
        
        return `
            <tr>
                <td>${createTime}</td>
                <td>${request.employee_name || '-'}</td>
                <td>${request.employee_no || '-'}</td>
                <td>${request.department || '-'}</td>
                <td>${request.leave_type || '-'}</td>
                <td>${startDate}</td>
                <td>${endDate}</td>
                <td>${request.days || 0} 天</td>
                <td title="${request.reason || ''}">${(request.reason || '').substring(0, 20)}${(request.reason || '').length > 20 ? '...' : ''}</td>
                <td>${statusHtml}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');
}

// 渲染请假分页
function renderLeavePagination(pagination) {
    const paginationDiv = document.getElementById('leavePagination');
    
    if (!pagination || pagination.totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    const { page, totalPages, total } = pagination;
    
    let html = `
        <button ${page === 1 ? 'disabled' : ''} onclick="changeLeavePage(${page - 1})">上一页</button>
        <span class="page-info">第 ${page} / ${totalPages} 页 (共 ${total} 条)</span>
        <button ${page === totalPages ? 'disabled' : ''} onclick="changeLeavePage(${page + 1})">下一页</button>
    `;
    
    paginationDiv.innerHTML = html;
}

// 切换请假页面
function changeLeavePage(page) {
    leaveCurrentPage = page;
    loadLeaveRequests();
}

// 打开请假模态框
function openLeaveModal(id = null) {
    const modal = document.getElementById('leaveModal');
    const form = document.getElementById('leaveForm');
    const title = document.getElementById('modalTitle');
    
    form.reset();
    document.getElementById('leaveId').value = id || '';
    title.textContent = id ? '编辑请假' : '录入请假';
    
    // 加载所有员工到下拉框
    loadEmployees(null, '').then(() => {
        const employeeSelect = document.getElementById('leaveEmployeeSelect');
        if (employeeSelect) {
            employeeSelect.innerHTML = '<option value="">请选择员工</option>';
            employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.name} (${emp.employee_no})`;
                employeeSelect.appendChild(option);
            });
        }
    });
    
    modal.style.display = 'block';
}

// 关闭请假模态框
function closeLeaveModal() {
    document.getElementById('leaveModal').style.display = 'none';
}

// 处理请假提交
async function handleLeaveSubmit(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('leaveEmployeeSelect').value;
    const leaveType = document.getElementById('leaveTypeSelect').value;
    const startDate = document.getElementById('leaveStartDateInput').value;
    const endDate = document.getElementById('leaveEndDateInput').value;
    const days = document.getElementById('leaveDays').value;
    const reason = document.getElementById('leaveReason').value;
    
    try {
        const response = await fetch(`${API_BASE}/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                employeeId: parseInt(employeeId),
                leaveType,
                startDate,
                endDate,
                days: parseFloat(days),
                reason
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('请假申请提交成功');
            closeLeaveModal();
            loadLeaveRequests();
        } else {
            showError(result.message || '提交失败');
        }
    } catch (error) {
        console.error('提交请假申请失败:', error);
        showError('提交失败，请稍后重试');
    }
}

// 打开审批模态框
function openApproveModal(id) {
    document.getElementById('approveLeaveId').value = id;
    document.getElementById('approveModal').style.display = 'block';
}

// 关闭审批模态框
function closeApproveModal() {
    document.getElementById('approveModal').style.display = 'none';
}

// 处理审批提交
async function handleApproveSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('approveLeaveId').value;
    const status = document.getElementById('approveStatus').value;
    const remark = document.getElementById('approveRemark').value;
    
    try {
        const response = await fetch(`${API_BASE}/leave/${id}/approve`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status,
                approverId: 1, // 管理员ID，实际应该从登录信息获取
                remark
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(result.message);
            closeApproveModal();
            loadLeaveRequests();
        } else {
            showError(result.message || '审批失败');
        }
    } catch (error) {
        console.error('审批失败:', error);
        showError('审批失败，请稍后重试');
    }
}

// 删除请假申请
async function deleteLeaveRequest(id) {
    if (!confirm('确定要删除这条请假申请吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/leave/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('删除成功');
            loadLeaveRequests();
        } else {
            showError(result.message || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showError('删除失败，请稍后重试');
    }
}

// 在初始化时绑定请假管理事件
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化请假管理，确保DOM已加载
    setTimeout(() => {
        initLeaveManagement();
    }, 100);
});

// 加载部门管理页面数据
async function loadDepartmentsPage() {
    await loadDepartments();
    await loadEmployees();
    renderDepartments();
    renderUnassignedEmployees();
}

// 初始化部门管理
function initDepartmentManagement() {
    // 绑定新增部门按钮
    const addDepartmentBtn = document.getElementById('addDepartmentBtn');
    if (addDepartmentBtn) {
        addDepartmentBtn.addEventListener('click', () => {
            openDepartmentModal();
        });
    }
    
    // 绑定部门模态框关闭按钮
    const closeDepartmentModalBtn = document.getElementById('closeDepartmentModal');
    if (closeDepartmentModalBtn) {
        closeDepartmentModalBtn.addEventListener('click', closeDepartmentModal);
    }
    
    // 绑定部门模态框取消按钮
    const cancelDepartmentBtn = document.getElementById('cancelDepartmentBtn');
    if (cancelDepartmentBtn) {
        cancelDepartmentBtn.addEventListener('click', closeDepartmentModal);
    }
    
    // 绑定表单提交事件
    const departmentForm = document.getElementById('departmentForm');
    if (departmentForm) {
        departmentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveDepartment(e);
        });
    }
    
    // 点击模态框外部关闭
    const departmentModal = document.getElementById('departmentModal');
    if (departmentModal) {
        departmentModal.addEventListener('click', (e) => {
            if (e.target === departmentModal) {
                closeDepartmentModal();
            }
        });
    }
}

// 渲染部门列表
function renderDepartments() {
    const departmentsList = document.getElementById('departmentsList');
    if (!departmentsList) return;
    
    if (!departments || departments.length === 0) {
        departmentsList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">暂无部门数据</p>';
        return;
    }
    
    departmentsList.innerHTML = departments.map(dept => `
        <div class="department-card" data-department-id="${dept.id}">
            <div class="department-header">
                <div class="department-title-row">
                    <button class="btn-toggle" onclick="toggleDepartment(${dept.id})" title="收起/展开">
                        <span class="toggle-icon" id="toggleIcon${dept.id}">▼</span>
                    </button>
                    <h4>${dept.name}</h4>
                </div>
                <div class="department-actions">
                    <button class="btn btn-sm btn-edit" onclick="openDepartmentModal(${dept.id})">编辑</button>
                    <button class="btn btn-sm btn-delete" onclick="deleteDepartment(${dept.id})">删除</button>
                </div>
            </div>
            <div class="department-content" id="deptContent${dept.id}">
                <div class="department-info">
                    <p><strong>部门代码:</strong> ${dept.code || '无'}</p>
                    <p><strong>员工数量:</strong> ${dept.employee_count || 0}</p>
                    ${dept.description ? `<p><strong>描述:</strong> ${dept.description}</p>` : ''}
                </div>
                <div class="department-employees" id="deptEmployees${dept.id}">
                    <!-- 该部门的员工将在这里显示 -->
                </div>
            </div>
        </div>
    `).join('');
    
    // 为每个部门加载员工
    departments.forEach(dept => {
        loadDepartmentEmployees(dept.id);
    });
    
    // 绑定拖拽事件
    bindDragEvents();
}

// 加载部门员工
async function loadDepartmentEmployees(departmentId) {
    try {
        const response = await fetch(`${API_BASE}/employee?departmentId=${departmentId}`);
        const result = await response.json();
        
        if (result.success) {
            const deptEmployeesDiv = document.getElementById(`deptEmployees${departmentId}`);
            if (deptEmployeesDiv) {
                const employees = result.data;
                if (employees.length === 0) {
                    deptEmployeesDiv.innerHTML = '<p style="color: #999; font-size: 12px;">暂无员工</p>';
                } else {
                    deptEmployeesDiv.innerHTML = employees.map(emp => `
                        <div class="employee-item" draggable="true" data-employee-id="${emp.id}">
                            <span>${emp.name} (${emp.employee_no})</span>
                            <button class="btn-remove" onclick="removeEmployeeFromDepartment(${emp.id}, ${departmentId})" title="移除">×</button>
                        </div>
                    `).join('');
                    
                    // 绑定拖拽事件
                    bindDragEvents();
                }
            }
        }
    } catch (error) {
        console.error('加载部门员工失败:', error);
    }
}

// 渲染未分配部门的员工
function renderUnassignedEmployees() {
    const unassignedDiv = document.getElementById('unassignedEmployees');
    if (!unassignedDiv) return;
    
    const unassigned = employees.filter(emp => !emp.department_id);
    
    if (unassigned.length === 0) {
        unassignedDiv.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">暂无未分配员工</p>';
        return;
    }
    
    unassignedDiv.innerHTML = unassigned.map(emp => `
        <div class="employee-item unassigned-employee" draggable="true" data-employee-id="${emp.id}">
            <span>${emp.name} (${emp.employee_no})</span>
            <div class="employee-actions">
                <button class="btn-assign" onclick="showAssignModal(${emp.id}, '${emp.name}', '${emp.employee_no}')" title="分配到部门">分配</button>
            </div>
        </div>
    `).join('');
    
    // 绑定拖拽事件
    bindDragEvents();
}

// 绑定拖拽事件
function bindDragEvents() {
    // 移除旧的事件监听器，避免重复绑定
    const employeeItems = document.querySelectorAll('.employee-item[draggable="true"]');
    const departmentCards = document.querySelectorAll('.department-card');
    
    employeeItems.forEach(item => {
        // 移除旧的事件监听器
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        newItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('employeeId', newItem.getAttribute('data-employee-id'));
            newItem.style.opacity = '0.5';
        });
        
        newItem.addEventListener('dragend', (e) => {
            newItem.style.opacity = '1';
        });
    });
    
    departmentCards.forEach(card => {
        // 移除旧的事件监听器
        const newCard = card.cloneNode(true);
        card.parentNode.replaceChild(newCard, card);
        
        newCard.addEventListener('dragover', (e) => {
            e.preventDefault();
            newCard.style.backgroundColor = '#f0f8ff';
        });
        
        newCard.addEventListener('dragleave', (e) => {
            newCard.style.backgroundColor = '';
        });
        
        newCard.addEventListener('drop', (e) => {
            e.preventDefault();
            newCard.style.backgroundColor = '';
            const employeeId = e.dataTransfer.getData('employeeId');
            const departmentId = newCard.getAttribute('data-department-id');
            if (employeeId && departmentId) {
                assignEmployeeToDepartment(parseInt(employeeId), parseInt(departmentId));
            }
        });
    });
}

// 切换部门展开/收起
function toggleDepartment(departmentId) {
    const content = document.getElementById(`deptContent${departmentId}`);
    const icon = document.getElementById(`toggleIcon${departmentId}`);
    
    if (content && icon) {
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.textContent = '▼';
        } else {
            content.style.display = 'none';
            icon.textContent = '▶';
        }
    }
}

// 显示分配员工到部门的模态框
function showAssignModal(employeeId, employeeName, employeeNo) {
    // 创建或获取分配模态框
    let modal = document.getElementById('assignEmployeeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'assignEmployeeModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>分配员工到部门</h3>
                    <span class="close" onclick="closeAssignModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <p><strong>员工:</strong> <span id="assignEmployeeName"></span></p>
                    <div class="form-group">
                        <label>选择部门 *</label>
                        <select id="assignDepartmentSelect" required>
                            <option value="">请选择部门</option>
                        </select>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" onclick="closeAssignModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="confirmAssignEmployee()">确定</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // 填充员工信息
    document.getElementById('assignEmployeeName').textContent = `${employeeName} (${employeeNo})`;
    modal.setAttribute('data-employee-id', employeeId);
    
    // 填充部门下拉框
    const select = document.getElementById('assignDepartmentSelect');
    select.innerHTML = '<option value="">请选择部门</option>';
    departments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept.id;
        option.textContent = dept.name;
        select.appendChild(option);
    });
    
    modal.style.display = 'block';
}

// 关闭分配模态框
function closeAssignModal() {
    const modal = document.getElementById('assignEmployeeModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 确认分配员工
async function confirmAssignEmployee() {
    const modal = document.getElementById('assignEmployeeModal');
    const select = document.getElementById('assignDepartmentSelect');
    
    if (!modal || !select) return;
    
    const employeeId = parseInt(modal.getAttribute('data-employee-id'));
    const departmentId = parseInt(select.value);
    
    if (!departmentId) {
        showWarning('请选择部门');
        return;
    }
    
    await assignEmployeeToDepartment(employeeId, departmentId);
    closeAssignModal();
}

// 打开部门模态框
function openDepartmentModal(id = null) {
    const modal = document.getElementById('departmentModal');
    const form = document.getElementById('departmentForm');
    const title = document.getElementById('departmentModalTitle');
    
    if (!modal) {
        console.error('部门模态框不存在');
        return;
    }
    
    if (form) {
        form.reset();
    }
    
    const departmentIdInput = document.getElementById('departmentId');
    if (departmentIdInput) {
        departmentIdInput.value = id || '';
    }
    
    if (title) {
        title.textContent = id ? '编辑部门' : '新增部门';
    }
    
    if (id) {
        const dept = departments.find(d => d.id === id);
        if (dept) {
            const nameInput = document.getElementById('departmentName');
            const codeInput = document.getElementById('departmentCode');
            const descInput = document.getElementById('departmentDesc') || document.getElementById('departmentDescription');
            
            if (nameInput) nameInput.value = dept.name || '';
            if (codeInput) codeInput.value = dept.code || '';
            if (descInput) descInput.value = dept.description || '';
        }
    }
    
    modal.style.display = 'block';
}

// 创建部门模态框
function createDepartmentModal() {
    const modalHTML = `
        <div id="departmentModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="departmentModalTitle">新增部门</h3>
                    <span class="close" onclick="closeDepartmentModal()">&times;</span>
                </div>
                <form id="departmentForm" onsubmit="saveDepartment(event)">
                    <input type="hidden" id="departmentId" value="">
                    <div class="form-group">
                        <label>部门名称 *</label>
                        <input type="text" id="departmentName" required>
                    </div>
                    <div class="form-group">
                        <label>部门代码</label>
                        <input type="text" id="departmentCode">
                    </div>
                    <div class="form-group">
                        <label>部门描述</label>
                        <textarea id="departmentDescription" rows="3"></textarea>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" onclick="closeDepartmentModal()">取消</button>
                        <button type="submit" class="btn btn-primary">保存</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// 关闭部门模态框
function closeDepartmentModal() {
    const modal = document.getElementById('departmentModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 保存部门
async function saveDepartment(e) {
    if (e) e.preventDefault();
    
    const idInput = document.getElementById('departmentId');
    const nameInput = document.getElementById('departmentName');
    const codeInput = document.getElementById('departmentCode');
    // HTML中使用的是departmentDesc，代码中可能用的是departmentDescription
    const descInput = document.getElementById('departmentDesc') || document.getElementById('departmentDescription');
    
    if (!nameInput || !nameInput.value.trim()) {
        showError('请输入部门名称');
        return;
    }
    
    const id = idInput ? idInput.value : '';
    const name = nameInput.value.trim();
    const code = codeInput ? codeInput.value.trim() : '';
    const description = descInput ? descInput.value.trim() : '';
    
    try {
        const url = id ? `${API_BASE}/department/${id}` : `${API_BASE}/department`;
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                code: code || null,
                description: description || null
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess(id ? '部门更新成功' : '部门创建成功');
            closeDepartmentModal();
            await loadDepartments();
            renderDepartments();
        } else {
            showError(result.message || '操作失败');
        }
    } catch (error) {
        console.error('保存部门失败:', error);
        showError('操作失败，请稍后重试');
    }
}

// 删除部门
async function deleteDepartment(id) {
    if (!confirm('确定要删除这个部门吗？该部门的员工将被取消部门分配。')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/department/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('部门删除成功');
            await loadDepartments();
            await loadEmployees();
            renderDepartments();
            renderUnassignedEmployees();
        } else {
            showError(result.message || '删除失败');
        }
    } catch (error) {
        console.error('删除部门失败:', error);
        showError('删除失败，请稍后重试');
    }
}

// 分配员工到部门
async function assignEmployeeToDepartment(employeeId, departmentId) {
    try {
        const response = await fetch(`${API_BASE}/employee/${employeeId}/department`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ departmentId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            await loadEmployees();
            await loadDepartments();
            renderDepartments();
            renderUnassignedEmployees();
        } else {
            showError(result.message || '分配失败');
        }
    } catch (error) {
        console.error('分配员工失败:', error);
        showError('分配失败，请稍后重试');
    }
}

// 从部门移除员工
async function removeEmployeeFromDepartment(employeeId, departmentId) {
    if (!confirm('确定要将该员工从部门中移除吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/employee/${employeeId}/department`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ departmentId: null })
        });
        
        const result = await response.json();
        
        if (result.success) {
            await loadEmployees();
            await loadDepartments();
            renderDepartments();
            renderUnassignedEmployees();
        } else {
            showError(result.message || '移除失败');
        }
    } catch (error) {
        console.error('移除员工失败:', error);
        showError('移除失败，请稍后重试');
    }
}

// 加载员工管理页面
async function loadEmployeesPage() {
    await loadDepartments();
    await loadEmployeesForManagement();
}

// 加载员工列表（用于员工管理页面）
async function loadEmployeesForManagement() {
    try {
        const departmentId = document.getElementById('employeesDepartmentFilter')?.value || '';
        const keyword = document.getElementById('employeesSearch')?.value || '';
        
        const params = new URLSearchParams();
        if (departmentId) params.append('departmentId', departmentId);
        if (keyword) params.append('keyword', keyword);
        
        const response = await fetch(`${API_BASE}/employee?${params}`);
        const result = await response.json();
        
        if (result.success) {
            renderEmployeesTable(result.data);
        }
    } catch (error) {
        console.error('加载员工列表失败:', error);
    }
}

// 渲染员工表格
function renderEmployeesTable(employees) {
    const tbody = document.getElementById('employeesBody');
    if (!tbody) return;
    
    if (!employees || employees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #999;">暂无员工数据</td></tr>';
        return;
    }
    
    tbody.innerHTML = employees.map(emp => {
        const tagStr = (emp.tag || '').replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        const nameStr = emp.name.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        return `
        <tr>
            <td>${emp.employee_no}</td>
            <td>${emp.name}</td>
            <td>${emp.department_name || '未分配'}</td>
            <td>${emp.position || '-'}</td>
            <td>${emp.phone || '-'}</td>
            <td>
                <div class="employee-tags-container" onclick="openEmployeeTagModal(${emp.id}, '${nameStr}', '${emp.employee_no}', '${tagStr}')" style="cursor: pointer;">
                    ${renderEmployeeTags(emp.tag)}
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-edit" onclick="openEmployeeTagModal(${emp.id}, '${nameStr}', '${emp.employee_no}', '${tagStr}')">编辑标签</button>
            </td>
        </tr>
    `;
    }).join('');
    
    // 填充部门下拉框
    const departmentFilter = document.getElementById('employeesDepartmentFilter');
    if (departmentFilter && departments) {
        departmentFilter.innerHTML = '<option value="">全部部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            departmentFilter.appendChild(option);
        });
    }
}

// 渲染员工标签（支持多个）
function renderEmployeeTags(tagsStr) {
    if (!tagsStr || tagsStr.trim() === '') {
        return '<span class="employee-tag tag-none">无标签</span>';
    }
    
    const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
    if (tags.length === 0) {
        return '<span class="employee-tag tag-none">无标签</span>';
    }
    
    return tags.map(tag => `
        <span class="employee-tag tag-${getTagClass(tag)}">${tag}</span>
    `).join('');
}

// 获取标签样式类
function getTagClass(tag) {
    const tagMap = {
        '稳定': 'stable',
        '不稳定': 'unstable',
        '老黄牛': 'hardworking',
        '刺头': 'troublemaker',
        '要离职': 'leaving',
        '优秀': 'excellent',
        '一般': 'normal',
        '待改进': 'improve',
        '新人': 'newbie',
        '老员工': 'veteran',
        '积极': 'positive',
        '消极': 'negative',
        '能力强': 'capable',
        '能力弱': 'weak',
        '潜力股': 'potential',
        '问题员工': 'problem',
        '核心员工': 'core',
        '普通员工': 'regular',
        '重点关注': 'focus',
        '待观察': 'observe'
    };
    return tagMap[tag] || 'default';
}

// 打开员工标签编辑模态框
function openEmployeeTagModal(employeeId, employeeName, employeeNo, currentTags) {
    const modal = document.getElementById('employeeTagModal');
    const nameSpan = document.getElementById('tagEmployeeName');
    const checkboxesContainer = document.getElementById('employeeTagCheckboxes');
    
    if (!modal || !nameSpan || !checkboxesContainer) return;
    
    nameSpan.textContent = `${employeeName} (${employeeNo})`;
    modal.setAttribute('data-employee-id', employeeId);
    
    // 解析当前标签
    const currentTagList = currentTags ? currentTags.split(',').map(t => t.trim()).filter(t => t) : [];
    
    // 填充标签复选框
    checkboxesContainer.innerHTML = EMPLOYEE_TAGS.map(tag => {
        const isChecked = currentTagList.includes(tag);
        return `
            <label class="tag-checkbox-label">
                <input type="checkbox" value="${tag}" ${isChecked ? 'checked' : ''}>
                <span class="employee-tag tag-${getTagClass(tag)}">${tag}</span>
            </label>
        `;
    }).join('');
    
    modal.style.display = 'block';
}

// 关闭员工标签编辑模态框
function closeEmployeeTagModal() {
    const modal = document.getElementById('employeeTagModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 保存员工标签
async function saveEmployeeTag() {
    const modal = document.getElementById('employeeTagModal');
    const checkboxesContainer = document.getElementById('employeeTagCheckboxes');
    
    if (!modal || !checkboxesContainer) return;
    
    const employeeId = parseInt(modal.getAttribute('data-employee-id'));
    
    // 获取所有选中的标签
    const checkboxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]:checked');
    const selectedTags = Array.from(checkboxes).map(cb => cb.value);
    const tag = selectedTags.join(',');
    
    try {
        const response = await fetch(`${API_BASE}/employee/${employeeId}/tag`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tag })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('标签更新成功');
            closeEmployeeTagModal();
            loadEmployeesForManagement();
        } else {
            showError(result.message || '更新失败');
        }
    } catch (error) {
        console.error('保存标签失败:', error);
        showError('保存失败，请稍后重试');
    }
}

// 初始化员工管理页面事件
function initEmployeesManagement() {
    const searchBtn = document.getElementById('employeesSearchBtn');
    const departmentFilter = document.getElementById('employeesDepartmentFilter');
    const searchInput = document.getElementById('employeesSearch');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            loadEmployeesForManagement();
        });
    }
    
    if (departmentFilter) {
        departmentFilter.addEventListener('change', () => {
            loadEmployeesForManagement();
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loadEmployeesForManagement();
            }
        });
    }
}

// 将需要在 HTML 中调用的函数暴露到全局作用域
window.openDepartmentModal = openDepartmentModal;
window.closeDepartmentModal = closeDepartmentModal;
window.saveDepartment = saveDepartment;
window.deleteDepartment = deleteDepartment;
window.removeEmployeeFromDepartment = removeEmployeeFromDepartment;
window.toggleDepartment = toggleDepartment;
window.showAssignModal = showAssignModal;
window.closeAssignModal = closeAssignModal;
window.confirmAssignEmployee = confirmAssignEmployee;
window.openEmployeeTagModal = openEmployeeTagModal;
window.closeEmployeeTagModal = closeEmployeeTagModal;
window.saveEmployeeTag = saveEmployeeTag;

// ==================== 工作时长统计功能 ====================

// 加载工作时长统计页面
async function loadWorktimePage() {
    await loadEmployees();
    await loadDepartments();
    
    // 填充员工下拉框
    const employeeSelect = document.getElementById('worktimeEmployeeSelect');
    if (employeeSelect && employees) {
        employeeSelect.innerHTML = '<option value="">请选择员工</option>';
        employees.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp.id;
            option.textContent = `${emp.name} (${emp.employee_no})`;
            employeeSelect.appendChild(option);
        });
    }
    
    // 填充部门下拉框
    const departmentSelect = document.getElementById('worktimeDepartmentSelect');
    if (departmentSelect && departments) {
        departmentSelect.innerHTML = '<option value="">请选择部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            departmentSelect.appendChild(option);
        });
    }
    
    // 设置默认日期范围（最近30天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    const startDateInput = document.getElementById('worktimeStartDate');
    const endDateInput = document.getElementById('worktimeEndDate');
    if (startDateInput) startDateInput.value = startDate.toISOString().slice(0, 10);
    if (endDateInput) endDateInput.value = endDate.toISOString().slice(0, 10);
    
    // 绑定查询方式切换
    const queryTypeSelect = document.getElementById('worktimeQueryType');
    if (queryTypeSelect && !queryTypeSelect.hasAttribute('data-bound')) {
        queryTypeSelect.setAttribute('data-bound', 'true');
        queryTypeSelect.addEventListener('change', function() {
            const type = this.value;
            document.getElementById('worktimeEmployeeSelectWrapper').style.display = type === 'employee' ? 'inline-block' : 'none';
            document.getElementById('worktimeEmployeeNameWrapper').style.display = type === 'name' ? 'inline-block' : 'none';
            document.getElementById('worktimeDepartmentWrapper').style.display = type === 'department' ? 'inline-block' : 'none';
        });
    }
    
    // 绑定查询按钮
    const searchBtn = document.getElementById('worktimeSearchBtn');
    if (searchBtn && !searchBtn.hasAttribute('data-bound')) {
        searchBtn.setAttribute('data-bound', 'true');
        searchBtn.addEventListener('click', loadWorktimeData);
    }
}

// 工作时长详情数据缓存
let worktimeDetailsCache = {};

// 加载工作时长数据
async function loadWorktimeData() {
    const queryType = document.getElementById('worktimeQueryType')?.value || 'employee';
    const employeeId = document.getElementById('worktimeEmployeeSelect')?.value;
    const employeeName = document.getElementById('worktimeEmployeeName')?.value;
    const departmentId = document.getElementById('worktimeDepartmentSelect')?.value;
    const startDate = document.getElementById('worktimeStartDate')?.value;
    const endDate = document.getElementById('worktimeEndDate')?.value;
    const groupBy = document.getElementById('worktimeGroupBy')?.value || 'day';
    
    // 验证查询条件
    if (queryType === 'employee' && !employeeId) {
        showError('请选择员工');
        return;
    }
    if (queryType === 'name' && !employeeName) {
        showError('请输入员工姓名或工号');
        return;
    }
    if (queryType === 'department' && !departmentId) {
        showError('请选择部门');
        return;
    }
    
    try {
        const params = new URLSearchParams();
        if (employeeId) params.append('employeeId', employeeId);
        if (employeeName) params.append('employeeName', employeeName);
        if (departmentId) params.append('departmentId', departmentId);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        params.append('groupBy', groupBy);
        
        const response = await fetch(`${API_BASE}/attendance/worktime?${params}`);
        const result = await response.json();
        
        if (result.success) {
            worktimeDetailsCache = {};
            if (result.data.periodStats) {
                result.data.periodStats.forEach(period => {
                    // 使用periodKey（原始值）或period（格式化后的值）作为缓存键
                    const cacheKey = period.periodKey || period.period;
                    worktimeDetailsCache[cacheKey] = period.details;
                });
            }
            renderWorktimeData(result.data);
        } else {
            showError(result.message || '加载数据失败');
        }
    } catch (error) {
        console.error('加载工作时长数据失败:', error);
        showError('加载数据失败，请稍后重试');
    }
}

// 渲染工作时长数据
function renderWorktimeData(data) {
    // 显示员工信息（支持多员工）
    const employeeCard = document.getElementById('worktimeEmployeeCard');
    const employeeNameEl = document.getElementById('worktimeEmployeeName');
    const employeeInfoEl = document.getElementById('worktimeEmployeeInfo');
    
    if (employeeCard && employeeNameEl && employeeInfoEl) {
        if (data.employees && data.employees.length > 0) {
            if (data.employees.length === 1) {
                // 单个员工
                employeeNameEl.textContent = data.employees[0].name;
                employeeInfoEl.textContent = `${data.employees[0].employee_no} | ${data.employees[0].department} | ${data.employees[0].position || '无'}`;
            } else {
                // 多个员工（部门查询）
                employeeNameEl.textContent = `共 ${data.employees.length} 名员工`;
                employeeInfoEl.textContent = data.employees.map(emp => `${emp.name}(${emp.employee_no})`).join('、');
            }
            employeeCard.style.display = 'block';
        } else {
            employeeCard.style.display = 'none';
        }
    }
    
    // 显示汇总统计
    const summary = document.getElementById('worktimeSummary');
    if (summary) {
        document.getElementById('summaryTotalDays').textContent = data.summary.totalDays;
        document.getElementById('summaryWorkDays').textContent = data.summary.workDays;
        document.getElementById('summaryLeaveDays').textContent = data.summary.leaveDays;
        document.getElementById('summaryAbsentDays').textContent = data.summary.absentDays;
        document.getElementById('summaryTotalTime').textContent = data.summary.formattedTime;
        document.getElementById('summaryAvgTime').textContent = `${data.summary.avgWorkHours}小时`;
        summary.style.display = 'block';
    }
    
    // 渲染时间段统计
    renderPeriodStats(data.periodStats);
    
    // 显示详细记录（默认显示第一个时间段）
    if (data.periodStats && data.periodStats.length > 0) {
        renderWorktimeDetails(data.periodStats[0].details);
    }
}

// 渲染时间段统计
function renderPeriodStats(periodStats) {
    const tbody = document.getElementById('worktimePeriodTableBody');
    const container = document.getElementById('worktimePeriodStats');
    
    if (!tbody || !container) return;
    
    tbody.innerHTML = '';
    
    periodStats.forEach(period => {
        const hours = Math.floor(period.totalSeconds / 3600);
        const minutes = Math.floor((period.totalSeconds % 3600) / 60);
        const seconds = period.totalSeconds % 60;
        const formattedTime = `${hours}小时${minutes}分钟${seconds}秒`;
        
        // 格式化period显示（处理ISO日期字符串）
        let periodDisplay = period.period;
        if (typeof period.period === 'string' && period.period.includes('T')) {
            // 如果是ISO日期字符串，转换为日期格式
            const date = moment(period.period);
            if (date.isValid()) {
                periodDisplay = date.format('YYYY-MM-DD');
            }
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${periodDisplay}</td>
            <td>${period.days}</td>
            <td>${period.workDays}</td>
            <td>${period.leaveDays}</td>
            <td>${period.absentDays}</td>
            <td>${formattedTime}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="showWorktimeDetails('${period.period}')">
                    查看详情
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    container.style.display = 'block';
}

// 显示详细记录
function showWorktimeDetails(period) {
    const details = worktimeDetailsCache[period];
    if (details) {
        renderWorktimeDetails(details);
    }
}

// 渲染详细记录
function renderWorktimeDetails(details) {
    const tbody = document.getElementById('worktimeDetailsTableBody');
    const container = document.getElementById('worktimeDetails');
    
    if (!tbody || !container) return;
    
    tbody.innerHTML = '';
    
    details.forEach(detail => {
        const tr = document.createElement('tr');
        const workTime = detail.work_seconds > 0 
            ? `${detail.work_hours}小时${detail.work_minutes}分钟${detail.work_seconds_remain}秒`
            : '-';
        
        tr.innerHTML = `
            <td>${detail.date}</td>
            <td>${detail.checkin_time || '-'}</td>
            <td>${detail.checkout_time || '-'}</td>
            <td>${workTime}</td>
            <td>${detail.status}</td>
            <td>${detail.leave_type || (detail.status === '未到' ? '未打卡' : '-')}</td>
        `;
        tbody.appendChild(tr);
    });
    
    container.style.display = 'block';
}

// 暴露到全局
window.showWorktimeDetails = showWorktimeDetails;

// ==================== 统计报表功能 ====================

let chartInstances = {};

// 加载统计报表页面
async function loadStatsPage() {
    await loadDepartments();
    
    // 填充部门下拉框
    const departmentFilter = document.getElementById('statsDepartmentFilter');
    if (departmentFilter && departments) {
        departmentFilter.innerHTML = '<option value="">全部部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            departmentFilter.appendChild(option);
        });
    }
    
    // 设置默认日期范围（最近30天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('statsStartDate').value = startDate.toISOString().slice(0, 10);
    document.getElementById('statsEndDate').value = endDate.toISOString().slice(0, 10);
    
    // 绑定查询按钮（避免重复绑定）
    const searchBtn = document.getElementById('statsSearchBtn');
    if (searchBtn && !searchBtn.hasAttribute('data-bound')) {
        searchBtn.setAttribute('data-bound', 'true');
        searchBtn.addEventListener('click', loadStatsData);
    }
    
    // 加载统计数据
    await loadStatsData();
}

// 加载统计数据（带重试和错误处理，使用缓存）
async function loadStatsData() {
    const loadingEl = document.getElementById('statsLoading');
    if (loadingEl) loadingEl.style.display = 'block';
    
    try {
        const startDate = document.getElementById('statsStartDate')?.value || '';
        const endDate = document.getElementById('statsEndDate')?.value || '';
        const departmentId = document.getElementById('statsDepartmentFilter')?.value || '';
        
        // 生成缓存键
        const cacheKey = `stats_${startDate}_${endDate}_${departmentId}`;
        
        // 先检查缓存
        const cached = frontendCache.get(cacheKey);
        if (cached) {
            renderAllCharts(cached);
            if (loadingEl) loadingEl.style.display = 'none';
            // 后台静默更新
            loadStatsDataFromAPI(cacheKey, startDate, endDate, departmentId).catch(() => {});
            return;
        }
        
        await loadStatsDataFromAPI(cacheKey, startDate, endDate, departmentId);
    } catch (error) {
        console.error('加载统计数据失败:', error);
        if (error.name === 'AbortError') {
            showError('请求超时，请稍后重试');
        } else if (error.message && error.message.includes('Failed to fetch')) {
            showError('网络连接失败，请检查网络后重试');
        } else {
            showError('加载统计数据失败，请刷新页面重试');
        }
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// 从API加载统计数据
async function loadStatsDataFromAPI(cacheKey, startDate, endDate, departmentId) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (departmentId) params.append('departmentId', departmentId);
    
    // 添加超时控制（15秒，减少等待时间）
    let controller;
    let timeoutId;
    
    if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 15000);
    }
    
    let response;
    let retries = 0;
    const maxRetries = 1; // 减少重试次数
    
    while (retries <= maxRetries) {
        try {
            const fetchOptions = {
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (controller) {
                fetchOptions.signal = controller.signal;
            }
            
            response = await fetch(`${API_BASE}/attendance/stats?${params}`, fetchOptions);
            break;
        } catch (fetchError) {
            retries++;
            if (retries > maxRetries) {
                throw fetchError;
            }
            await new Promise(resolve => setTimeout(resolve, 500 * retries));
        }
    }
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'error'}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
        const data = result.data;
        // 保存到缓存
        frontendCache.set(cacheKey, data);
        renderAllCharts(data);
    } else {
        throw new Error(result.message || '加载统计数据失败');
    }
}

// 渲染所有图表
function renderAllCharts(data) {
    renderDailyTrendChart(data.dailyTrend || []);
    renderDepartmentChart(data.departmentStats || []);
    renderStatusChart(data.statusStats || []);
    renderAbnormalChart(data.abnormalStats || []);
    renderEmployeeRankChart(data.abnormalStats || []);
    renderMonthlyChart(data.monthlyStats || []);
}

// 渲染每日考勤趋势图（折线图）
function renderDailyTrendChart(data) {
    const ctx = document.getElementById('dailyTrendChart');
    if (!ctx) return;
    
    // 销毁旧图表
    if (chartInstances.dailyTrend) {
        chartInstances.dailyTrend.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.dailyTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    label: '暂无数据',
                    data: [0],
                    borderColor: '#ccc'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    const labels = data.map(item => moment(item.date).format('MM-DD'));
    const checkinData = data.map(item => item.checkin_count || 0);
    const checkoutData = data.map(item => item.checkout_count || 0);
    const lateData = data.map(item => item.late_count || 0);
    const earlyData = data.map(item => item.early_count || 0);
    
    chartInstances.dailyTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '上班打卡',
                    data: checkinData,
                    borderColor: '#2196f3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    tension: 0.4
                },
                {
                    label: '下班打卡',
                    data: checkoutData,
                    borderColor: '#4caf50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.4
                },
                {
                    label: '迟到',
                    data: lateData,
                    borderColor: '#ff9800',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                    tension: 0.4
                },
                {
                    label: '早退',
                    data: earlyData,
                    borderColor: '#f44336',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染部门考勤统计图（柱状图）
function renderDepartmentChart(data) {
    const ctx = document.getElementById('departmentChart');
    if (!ctx) return;
    
    if (chartInstances.department) {
        chartInstances.department.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.department = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    label: '暂无数据',
                    data: [0],
                    backgroundColor: '#ccc'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    const labels = data.map(item => item.department_name || '未分配');
    const checkinData = data.map(item => item.checkin_count || 0);
    const checkoutData = data.map(item => item.checkout_count || 0);
    
    chartInstances.department = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '上班打卡',
                    data: checkinData,
                    backgroundColor: '#2196f3'
                },
                {
                    label: '下班打卡',
                    data: checkoutData,
                    backgroundColor: '#4caf50'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染考勤状态分布图（饼图）
function renderStatusChart(data) {
    const ctx = document.getElementById('statusChart');
    if (!ctx) return;
    
    if (chartInstances.status) {
        chartInstances.status.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.status = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#ccc']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    const statusMap = {
        'normal': '正常',
        'late': '迟到',
        'early': '早退'
    };
    
    const labels = data.map(item => statusMap[item.status] || item.status);
    const counts = data.map(item => item.count || 0);
    const colors = ['#4caf50', '#ff9800', '#f44336'];
    
    chartInstances.status = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

// 渲染迟到早退统计图（柱状图）
function renderAbnormalChart(data) {
    const ctx = document.getElementById('abnormalChart');
    if (!ctx) return;
    
    if (chartInstances.abnormal) {
        chartInstances.abnormal.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.abnormal = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    label: '暂无数据',
                    data: [0],
                    backgroundColor: '#ccc'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    const labels = data.map(item => item.employee_name || item.employee_no);
    const lateData = data.map(item => item.late_count || 0);
    const earlyData = data.map(item => item.early_count || 0);
    
    chartInstances.abnormal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '迟到次数',
                    data: lateData,
                    backgroundColor: '#ff9800'
                },
                {
                    label: '早退次数',
                    data: earlyData,
                    backgroundColor: '#f44336'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染员工考勤排行图（横向柱状图）
function renderEmployeeRankChart(data) {
    const ctx = document.getElementById('employeeRankChart');
    if (!ctx) return;
    
    if (chartInstances.employeeRank) {
        chartInstances.employeeRank.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.employeeRank = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    label: '暂无数据',
                    data: [0],
                    backgroundColor: '#ccc'
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    // 按异常总数排序
    const sortedData = [...data].sort((a, b) => {
        const totalA = (a.late_count || 0) + (a.early_count || 0);
        const totalB = (b.late_count || 0) + (b.early_count || 0);
        return totalB - totalA;
    }).slice(0, 10);
    
    const labels = sortedData.map(item => `${item.employee_name || item.employee_no}`);
    const totalData = sortedData.map(item => (item.late_count || 0) + (item.early_count || 0));
    
    chartInstances.employeeRank = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '异常次数',
                data: totalData,
                backgroundColor: '#f44336'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染月度考勤汇总图（柱状图）
function renderMonthlyChart(data) {
    const ctx = document.getElementById('monthlyChart');
    if (!ctx) return;
    
    if (chartInstances.monthly) {
        chartInstances.monthly.destroy();
    }
    
    // 处理空数据
    if (!data || data.length === 0) {
        chartInstances.monthly = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['暂无数据'],
                datasets: [{
                    label: '暂无数据',
                    data: [0],
                    backgroundColor: '#ccc'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }
    
    const labels = data.map(item => item.month);
    const checkinData = data.map(item => item.checkin_count || 0);
    const checkoutData = data.map(item => item.checkout_count || 0);
    const lateData = data.map(item => item.late_count || 0);
    const earlyData = data.map(item => item.early_count || 0);
    
    chartInstances.monthly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '上班打卡',
                    data: checkinData,
                    backgroundColor: '#2196f3'
                },
                {
                    label: '下班打卡',
                    data: checkoutData,
                    backgroundColor: '#4caf50'
                },
                {
                    label: '迟到',
                    data: lateData,
                    backgroundColor: '#ff9800'
                },
                {
                    label: '早退',
                    data: earlyData,
                    backgroundColor: '#f44336'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// ==================== 数据导入功能 ====================

let deviceConnected = false;

// 加载数据导入页面
function loadImportPage() {
    // 设置默认日期范围（最近7天）
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    document.getElementById('importStartDate').value = startDate.toISOString().slice(0, 10);
    document.getElementById('importEndDate').value = endDate.toISOString().slice(0, 10);
    
    // 绑定事件（避免重复绑定）
    const connectBtn = document.getElementById('connectDeviceBtn');
    const importBtn = document.getElementById('importDeviceBtn');
    const excelBtn = document.getElementById('excelImportBtn');
    
    if (connectBtn && !connectBtn.hasAttribute('data-bound')) {
        connectBtn.setAttribute('data-bound', 'true');
        connectBtn.addEventListener('click', connectDevice);
    }
    
    if (importBtn && !importBtn.hasAttribute('data-bound')) {
        importBtn.setAttribute('data-bound', 'true');
        importBtn.addEventListener('click', importDeviceData);
    }
    
    if (excelBtn && !excelBtn.hasAttribute('data-bound')) {
        excelBtn.setAttribute('data-bound', 'true');
        excelBtn.addEventListener('click', showExcelImportModal);
    }
    
    // 绑定Excel模态框关闭事件
    const closeModal = document.getElementById('closeExcelImportModal');
    const closeModalBtn = document.getElementById('closeExcelImportModalBtn');
    
    if (closeModal && !closeModal.hasAttribute('data-bound')) {
        closeModal.setAttribute('data-bound', 'true');
        closeModal.addEventListener('click', closeExcelImportModal);
    }
    
    if (closeModalBtn && !closeModalBtn.hasAttribute('data-bound')) {
        closeModalBtn.setAttribute('data-bound', 'true');
        closeModalBtn.addEventListener('click', closeExcelImportModal);
    }
}

// 连接考勤机
async function connectDevice() {
    const ip = document.getElementById('deviceIp').value;
    const port = document.getElementById('devicePort').value;
    const user = document.getElementById('deviceUser').value;
    const password = document.getElementById('devicePassword').value;
    const statusDiv = document.getElementById('deviceStatus');
    
    if (!ip || !port) {
        showError('请填写考勤机IP地址和端口');
        return;
    }
    
    try {
        statusDiv.innerHTML = '<div class="status-loading">正在连接考勤机...</div>';
        
        const response = await fetch(`${API_BASE}/attendance/connect-device`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ip,
                port: parseInt(port),
                user,
                password
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            deviceConnected = true;
            document.getElementById('importDeviceBtn').disabled = false;
            statusDiv.innerHTML = `<div class="status-success">✓ 连接成功！设备信息：${result.data.deviceInfo || '中控考勤机'}</div>`;
            showSuccess('考勤机连接成功');
        } else {
            deviceConnected = false;
            document.getElementById('importDeviceBtn').disabled = true;
            statusDiv.innerHTML = `<div class="status-error">✗ 连接失败：${result.message || '未知错误'}</div>`;
            showError(result.message || '连接失败');
        }
    } catch (error) {
        console.error('连接考勤机失败:', error);
        deviceConnected = false;
        document.getElementById('importDeviceBtn').disabled = true;
        statusDiv.innerHTML = `<div class="status-error">✗ 连接失败：${error.message}</div>`;
        showError('连接失败：' + error.message);
    }
}

// 导入考勤机数据
async function importDeviceData() {
    if (!deviceConnected) {
        showError('请先连接考勤机');
        return;
    }
    
    const startDate = document.getElementById('importStartDate').value;
    const endDate = document.getElementById('importEndDate').value;
    const statusDiv = document.getElementById('deviceStatus');
    
    if (!startDate || !endDate) {
        showError('请选择导入日期范围');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        showError('开始日期不能大于结束日期');
        return;
    }
    
    try {
        statusDiv.innerHTML = '<div class="status-loading">正在导入数据，请稍候...</div>';
        showInfo('正在导入考勤数据，请稍候...');
        
        const response = await fetch(`${API_BASE}/attendance/import-device`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                startDate,
                endDate
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            statusDiv.innerHTML = `<div class="status-success">✓ 导入成功！共导入 ${result.data.count || 0} 条记录</div>`;
            showSuccess(`导入成功！共导入 ${result.data.count || 0} 条考勤记录`);
        } else {
            statusDiv.innerHTML = `<div class="status-error">✗ 导入失败：${result.message || '未知错误'}</div>`;
            showError(result.message || '导入失败');
        }
    } catch (error) {
        console.error('导入数据失败:', error);
        statusDiv.innerHTML = `<div class="status-error">✗ 导入失败：${error.message}</div>`;
        showError('导入失败：' + error.message);
    }
}

// 显示Excel导入模态框
function showExcelImportModal() {
    const modal = document.getElementById('excelImportModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// 关闭Excel导入模态框
function closeExcelImportModal() {
    const modal = document.getElementById('excelImportModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 点击模态框外部关闭
window.addEventListener('click', (e) => {
    const excelModal = document.getElementById('excelImportModal');
    if (e.target === excelModal) {
        closeExcelImportModal();
    }
});

// 暴露函数供HTML调用
window.showExcelImportModal = showExcelImportModal;
window.closeExcelImportModal = closeExcelImportModal;

// ==================== 员工月度统计功能 ====================

// 加载员工月度统计页面
async function loadEmployeeStatsPage() {
    // 设置默认月份为当前月份
    const monthInput = document.getElementById('employeeStatsMonth');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    // 加载部门和员工下拉框
    await loadDepartmentsForEmployeeStats();
    await loadEmployeesForEmployeeStats();
    
    // 绑定查询按钮
    const searchBtn = document.getElementById('employeeStatsSearchBtn');
    if (searchBtn && !searchBtn.hasAttribute('data-bound')) {
        searchBtn.setAttribute('data-bound', 'true');
        searchBtn.addEventListener('click', fetchEmployeeStats);
    }
    
    // 绑定导出按钮
    const exportBtn = document.getElementById('employeeStatsExportBtn');
    if (exportBtn && !exportBtn.hasAttribute('data-bound')) {
        exportBtn.setAttribute('data-bound', 'true');
        exportBtn.addEventListener('click', exportEmployeeStats);
    }
    
    // 绑定部门变化事件（更新员工列表）
    const departmentSelect = document.getElementById('employeeStatsDepartment');
    if (departmentSelect && !departmentSelect.hasAttribute('data-bound')) {
        departmentSelect.setAttribute('data-bound', 'true');
        departmentSelect.addEventListener('change', async () => {
            await loadEmployeesForEmployeeStats();
        });
    }
    
    // 自动加载数据
    await fetchEmployeeStats();
}

// 加载部门下拉框（员工统计页面）
async function loadDepartmentsForEmployeeStats() {
    const select = document.getElementById('employeeStatsDepartment');
    if (!select) return;
    
    // 从缓存获取部门
    const cached = frontendCache.get('departments');
    if (cached && departments.length > 0) {
        select.innerHTML = '<option value="">全部部门</option>';
        departments.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.id;
            option.textContent = dept.name;
            select.appendChild(option);
        });
        return;
    }
    
    // 如果缓存没有，从API加载
    try {
        const response = await fetch(`${API_BASE}/department`);
        const result = await response.json();
        if (result.success) {
            departments = result.data;
            frontendCache.set('departments', departments);
            select.innerHTML = '<option value="">全部部门</option>';
            departments.forEach(dept => {
                const option = document.createElement('option');
                option.value = dept.id;
                option.textContent = dept.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('加载部门失败:', error);
    }
}

// 加载员工下拉框（员工统计页面）
async function loadEmployeesForEmployeeStats() {
    const select = document.getElementById('employeeStatsEmployee');
    if (!select) return;
    
    const departmentId = document.getElementById('employeeStatsDepartment')?.value || '';
    
    // 从缓存获取员工（如果cacheStore可用）
    let empList = [];
    try {
        if (typeof cacheStore !== 'undefined' && cacheStore.getAllEmployees) {
            if (departmentId) {
                empList = cacheStore.getEmployeesByCondition({ departmentId: parseInt(departmentId) });
            } else {
                empList = cacheStore.getAllEmployees();
            }
        }
    } catch (e) {
        // cacheStore可能未定义，使用API
    }
    
    // 如果缓存没有，从API加载
    if (empList.length === 0) {
        try {
            const params = new URLSearchParams();
            if (departmentId) params.append('departmentId', departmentId);
            const response = await fetch(`${API_BASE}/employee?${params}`);
            const result = await response.json();
            if (result.success) {
                empList = result.data;
            }
        } catch (error) {
            console.error('加载员工失败:', error);
        }
    }
    
    select.innerHTML = '<option value="">全部员工</option>';
    empList.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name} (${emp.employee_no})`;
        select.appendChild(option);
    });
}

// 获取员工月度统计
async function fetchEmployeeStats() {
    const month = document.getElementById('employeeStatsMonth')?.value || '';
    const departmentId = document.getElementById('employeeStatsDepartment')?.value || '';
    const employeeId = document.getElementById('employeeStatsEmployee')?.value || '';
    
    if (!month) {
        showError('请选择月份');
        return;
    }
    
    const tbody = document.getElementById('employeeStatsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px;">加载中...</td></tr>';
    }
    
    try {
        const params = new URLSearchParams();
        params.append('month', month);
        if (departmentId) params.append('departmentId', departmentId);
        if (employeeId) params.append('employeeId', employeeId);
        
        // 先检查缓存
        const cacheKey = `employee-monthly-stats_${month}_${departmentId}_${employeeId}`;
        const cached = frontendCache.get(cacheKey);
        if (cached) {
            renderEmployeeStats(cached);
            // 后台静默更新
            fetchEmployeeStatsFromAPI(cacheKey, params).catch(() => {});
            return;
        }
        
        await fetchEmployeeStatsFromAPI(cacheKey, params);
    } catch (error) {
        console.error('获取员工月度统计失败:', error);
        showError('加载数据失败，请稍后重试');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #f00;">加载失败</td></tr>';
        }
    }
}

// 从API获取员工月度统计
async function fetchEmployeeStatsFromAPI(cacheKey, params) {
    const response = await fetch(`${API_BASE}/attendance/employee-monthly-stats?${params}`);
    const result = await response.json();
    
    if (result.success) {
        const data = result.data;
        // 保存到缓存
        frontendCache.set(cacheKey, data);
        renderEmployeeStats(data);
    } else {
        throw new Error(result.message || '加载失败');
    }
}

// 渲染员工月度统计
function renderEmployeeStats(data) {
    const tbody = document.getElementById('employeeStatsTableBody');
    const summaryDiv = document.getElementById('employeeStatsSummary');
    
    if (!tbody) return;
    
    if (!data.stats || data.stats.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px; color: #999;">暂无数据</td></tr>';
        if (summaryDiv) summaryDiv.style.display = 'none';
        return;
    }
    
    // 显示汇总统计
    if (summaryDiv && data.summary) {
        document.getElementById('totalEmployeesCount').textContent = data.summary.total_employees;
        document.getElementById('totalLateCount').textContent = data.summary.total_late;
        document.getElementById('totalEarlyCount').textContent = data.summary.total_early;
        document.getElementById('totalAbsentCount').textContent = data.summary.total_absent;
        document.getElementById('totalLeaveCount').textContent = data.summary.total_leave;
        summaryDiv.style.display = 'flex';
    }
    
    // 渲染表格
    tbody.innerHTML = '';
    data.stats.forEach((stat, index) => {
        const tr = document.createElement('tr');
        tr.className = 'employee-stats-row';
        tr.innerHTML = `
            <td>
                <a href="javascript:void(0)" class="link-detail" onclick="showEmployeeDetail(${index})">查看详情</a>
            </td>
            <td><strong>${stat.employee_no}</strong></td>
            <td>${stat.employee_name}</td>
            <td>${stat.department}</td>
            <td>${stat.position || '-'}</td>
            <td><span class="stat-badge stat-normal">${stat.normal_count}</span></td>
            <td>
                ${stat.late_count > 0 ? `<span class="stat-badge stat-late" title="${stat.late_count}次迟到">${stat.late_count}</span>` : '<span class="stat-badge">0</span>'}
            </td>
            <td>
                ${stat.early_count > 0 ? `<span class="stat-badge stat-early" title="${stat.early_count}次早退">${stat.early_count}</span>` : '<span class="stat-badge">0</span>'}
            </td>
            <td>
                ${stat.absent_count > 0 ? `<span class="stat-badge stat-absent" title="${stat.absent_count}天未到">${stat.absent_count}</span>` : '<span class="stat-badge">0</span>'}
            </td>
            <td><span class="stat-badge stat-leave">${stat.leave_count}</span></td>
            <td><strong>${stat.work_days}</strong></td>
            <td>${stat.total_days}</td>
        `;
        tr.setAttribute('data-stat-index', index);
        tbody.appendChild(tr);
    });
    
    // 保存数据到全局变量，供详情查看使用
    window.employeeStatsData = data;
}

// 显示员工详情
function showEmployeeDetail(index) {
    const data = window.employeeStatsData;
    if (!data || !data.stats || !data.stats[index]) return;
    
    const stat = data.stats[index];
    const modal = document.getElementById('employeeDetailModal');
    const title = document.getElementById('employeeDetailTitle');
    const content = document.getElementById('employeeDetailContent');
    
    title.textContent = `${stat.employee_name} (${stat.employee_no}) - ${stat.month} 考勤详情`;
    
    let html = `
        <div class="employee-detail-header">
            <div class="detail-info-item">
                <span class="label">部门：</span>
                <span class="value">${stat.department}</span>
            </div>
            <div class="detail-info-item">
                <span class="label">职位：</span>
                <span class="value">${stat.position || '-'}</span>
            </div>
        </div>
    `;
    
    // 迟到详情
    if (stat.late_details && stat.late_details.length > 0) {
        html += `
            <div class="detail-section">
                <h4 class="detail-section-title">📅 迟到记录 (${stat.late_count}次)</h4>
                <div class="detail-list">
        `;
        stat.late_details.forEach(item => {
            const date = moment(item.date).format('MM月DD日');
            const time = moment(item.punch_time).format('HH:mm');
            html += `
                <div class="detail-item detail-late">
                    <span class="detail-date">${date}</span>
                    <span class="detail-time">${time}</span>
                    <span class="detail-minutes">迟到 ${item.minutes} 分钟</span>
                </div>
            `;
        });
        html += `</div></div>`;
    }
    
    // 早退详情
    if (stat.early_details && stat.early_details.length > 0) {
        html += `
            <div class="detail-section">
                <h4 class="detail-section-title">📅 早退记录 (${stat.early_count}次)</h4>
                <div class="detail-list">
        `;
        stat.early_details.forEach(item => {
            const date = moment(item.date).format('MM月DD日');
            const time = moment(item.punch_time).format('HH:mm');
            html += `
                <div class="detail-item detail-early">
                    <span class="detail-date">${date}</span>
                    <span class="detail-time">${time}</span>
                    <span class="detail-minutes">早退 ${item.minutes} 分钟</span>
                </div>
            `;
        });
        html += `</div></div>`;
    }
    
    // 未到详情
    if (stat.absent_details && stat.absent_details.length > 0) {
        html += `
            <div class="detail-section">
                <h4 class="detail-section-title">📅 未到记录 (${stat.absent_count}天)</h4>
                <div class="detail-list">
        `;
        stat.absent_details.forEach(item => {
            const date = moment(item.date).format('MM月DD日');
            html += `
                <div class="detail-item detail-absent">
                    <span class="detail-date">${date}</span>
                    <span class="detail-status">未到</span>
                </div>
            `;
        });
        html += `</div></div>`;
    }
    
    // 请假详情
    if (stat.leave_details && stat.leave_details.length > 0) {
        html += `
            <div class="detail-section">
                <h4 class="detail-section-title">📅 请假记录 (${stat.leave_count}天)</h4>
                <div class="detail-list">
        `;
        stat.leave_details.forEach(item => {
            const date = moment(item.date).format('MM月DD日');
            html += `
                <div class="detail-item detail-leave">
                    <span class="detail-date">${date}</span>
                    <span class="detail-type">${item.type || '请假'}</span>
                </div>
            `;
        });
        html += `</div></div>`;
    }
    
    // 如果没有异常记录
    if (!stat.late_details?.length && !stat.early_details?.length && !stat.absent_details?.length && !stat.leave_details?.length) {
        html += `<div class="detail-section"><p style="text-align: center; color: #999; padding: 20px;">本月无异常记录</p></div>`;
    }
    
    content.innerHTML = html;
    modal.style.display = 'block';
    
    // 绑定关闭事件
    const closeBtn = document.getElementById('closeEmployeeDetail');
    if (closeBtn && !closeBtn.hasAttribute('data-bound')) {
        closeBtn.setAttribute('data-bound', 'true');
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// 暴露函数供HTML调用
window.showEmployeeDetail = showEmployeeDetail;

// 导出员工月度统计
async function exportEmployeeStats() {
    const month = document.getElementById('employeeStatsMonth')?.value || '';
    const departmentId = document.getElementById('employeeStatsDepartment')?.value || '';
    const employeeId = document.getElementById('employeeStatsEmployee')?.value || '';
    
    if (!month) {
        showError('请先选择月份并查询数据');
        return;
    }
    
    try {
        showInfo('正在导出，请稍候...');
        
        const params = new URLSearchParams();
        params.append('month', month);
        if (departmentId) params.append('departmentId', departmentId);
        if (employeeId) params.append('employeeId', employeeId);
        
        const response = await fetch(`${API_BASE}/attendance/export/employee-monthly-stats?${params}`);
        
        if (!response.ok) {
            throw new Error('导出失败');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `员工月度统计_${month}_${moment().format('YYYYMMDD_HHmmss')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showSuccess('导出成功！');
    } catch (error) {
        console.error('导出失败:', error);
        showError('导出失败，请稍后重试');
    }
}
