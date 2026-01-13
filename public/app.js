// API 基础URL
const API_BASE = '/api';

// 全局状态
let currentPage = 1;
const pageSize = 20;
let employees = [];
let departments = [];

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
    
    await loadDepartments();
    await loadEmployees();
    await loadRules();
    await loadTodayStats();
    
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
    const targetPage = document.getElementById(`${page}Page`);
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

// 加载部门列表
async function loadDepartments() {
    try {
        const response = await fetch(`${API_BASE}/department`);
        const result = await response.json();
        
        if (result.success) {
            departments = result.data;
            
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
    } catch (error) {
        console.error('加载部门列表失败:', error);
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

// 加载今日统计
async function loadTodayStats() {
    try {
        const response = await fetch(`${API_BASE}/attendance/today-stats`);
        const result = await response.json();
        
        if (result.success) {
            const data = result.data;
            
            // 更新核心数字
            document.getElementById('expectedCount').textContent = `${data.expectedCount || 0} 人`;
            document.getElementById('presentCount').textContent = `${data.presentCount || 0} / ${data.expectedCount || 0} 人`;
            document.getElementById('absentCount').textContent = `${data.absentCount || 0} / ${data.expectedCount || 0} 人`;
            
            // 更新顶部提示
            const alertBar = document.getElementById('homeAlertBar');
            const alertText = document.getElementById('homeAlertText');
            
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
            
            // 更新异常列表
            renderAnomaliesTable(data.anomalies || []);
            
            // 更新操作按钮（显示待审批请假数量）
            const approveBtn = document.getElementById('actionApprove');
            if (approveBtn && data.pendingLeaveCount > 0) {
                approveBtn.textContent = `📝 批准请假（${data.pendingLeaveCount}）`;
            }
        }
    } catch (error) {
        console.error('加载今日统计失败:', error);
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

// 加载统计数据
async function loadStatsData() {
    try {
        const startDate = document.getElementById('statsStartDate')?.value || '';
        const endDate = document.getElementById('statsEndDate')?.value || '';
        const departmentId = document.getElementById('statsDepartmentFilter')?.value || '';
        
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (departmentId) params.append('departmentId', departmentId);
        
        const response = await fetch(`${API_BASE}/attendance/stats?${params}`);
        const result = await response.json();
        
        if (result.success) {
            renderAllCharts(result.data);
        } else {
            showError('加载统计数据失败');
        }
    } catch (error) {
        console.error('加载统计数据失败:', error);
        showError('加载统计数据失败');
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
