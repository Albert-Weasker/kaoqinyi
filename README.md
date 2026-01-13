# 考勤易系统

一个基于 Node.js 和 MySQL 的考勤管理系统，专为电缆厂设计。

## 功能特性

- ✅ 员工上班打卡
- ✅ 员工下班打卡
- ✅ 打卡记录查询
- ✅ 今日打卡统计
- ✅ 员工管理
- ✅ 电缆厂风格界面
- ✅ 打卡位置记录（地址、经纬度）
- ✅ Docker 数据库支持

## 技术栈

- **后端**: Node.js + Express
- **数据库**: MySQL
- **前端**: HTML + CSS + JavaScript

## 安装步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 使用 Docker 启动数据库（推荐）

使用 Docker Compose 快速启动 MySQL 数据库：

```bash
# 启动数据库（端口 3333）
npm run docker:up

# 查看数据库日志
npm run docker:logs

# 停止数据库
npm run docker:down
```

数据库配置信息：
- 端口: 3333
- 用户名: root
- 密码: root123456
- 数据库名: kaoqinyi

### 3. 配置数据库连接

编辑 `.env` 文件，设置数据库连接信息（如果使用 Docker，已自动配置）：

```
DB_HOST=localhost
DB_PORT=3333
DB_USER=root
DB_PASSWORD=root123456
DB_NAME=kaoqinyi
PORT=3000
```

### 4. 初始化数据库

如果使用 Docker，数据库会自动初始化。如果使用本地 MySQL，运行：

```bash
npm run init-db
```

这将自动创建数据库和表结构，并插入一些示例数据。

**注意**: 如果数据库表已存在但缺少位置字段，运行迁移脚本：

```bash
npm run migrate-location
```

### 5. 启动服务器

```bash
npm start
```

或者使用开发模式（自动重启）：

```bash
npm run dev
```

### 6. 访问系统

打开浏览器访问：http://localhost:3000

## 数据库结构

### employees 表（员工表）
- id: 主键
- name: 姓名
- employee_no: 工号（唯一）
- department: 部门
- position: 职位
- phone: 电话
- created_at: 创建时间
- updated_at: 更新时间

### attendance 表（打卡记录表）
- id: 主键
- employee_id: 员工ID（外键）
- type: 打卡类型（checkin/checkout）
- punch_time: 打卡时间
- address: 打卡地址
- longitude: 经度
- latitude: 纬度
- created_at: 创建时间

## API 接口

### 打卡接口
- `POST /api/attendance/punch` - 打卡（上班/下班）
  - 参数: `{ employeeId, type: 'checkin' | 'checkout', address?, longitude?, latitude? }`
  - 位置信息为可选，系统会自动获取用户地理位置

### 打卡记录接口
- `GET /api/attendance/records` - 获取打卡记录
  - 查询参数: `employeeId`, `startDate`, `endDate`, `page`, `pageSize`

### 今日统计接口
- `GET /api/attendance/today-stats` - 获取今日打卡统计

### 员工接口
- `GET /api/employee` - 获取所有员工
- `GET /api/employee/:id` - 获取单个员工
- `POST /api/employee` - 创建员工
- `PUT /api/employee/:id` - 更新员工
- `DELETE /api/employee/:id` - 删除员工

## 使用说明

1. **打卡**: 
   - 选择员工后，系统会自动获取当前位置信息
   - 点击"上班打卡"或"下班打卡"按钮完成打卡
   - 打卡时会自动记录地址和经纬度坐标
2. **查看记录**: 在打卡记录区域可以按日期和员工筛选查看历史记录
3. **统计**: 页面顶部显示今日打卡统计信息
4. **位置信息**: 打卡记录中显示打卡地址和坐标，点击坐标可在地图上查看

## 注意事项

- 每个员工每天只能打一次上班卡和一次下班卡
- 下班打卡前必须先打上班卡
- 系统会自动记录打卡时间和位置信息
- 首次使用需要浏览器授权位置权限
- 如果无法获取位置，系统会提示是否继续打卡

## 开发

项目使用 nodemon 进行开发，修改代码后会自动重启服务器。

## 构建和部署

### 本地构建

```bash
pnpm build
```

构建脚本会检查所有必要文件是否存在，并验证项目配置。

### 部署到 Vercel

1. 安装 Vercel CLI: `npm i -g vercel`
2. 在项目根目录运行: `vercel`
3. 在 Vercel 控制台设置环境变量：
   - `DB_HOST`
   - `DB_PORT`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `PORT` (可选)

项目已包含 `vercel.json` 配置文件，会自动处理路由。

### 部署到其他平台

项目包含 `netlify.toml` 配置文件，也可以部署到 Netlify 或其他支持 Node.js 的平台。

**重要提示**：
- 部署前确保设置了正确的数据库连接环境变量
- 确保数据库可以从部署平台访问（可能需要配置防火墙）
- 静态文件在 `public/` 目录，后端 API 在 `/api/*` 路由

## 许可证

ISC
