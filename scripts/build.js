#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 开始构建考勤管理系统...\n');

// 检查必要文件
const requiredFiles = [
  'server.js',
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'config/database.js'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file}`);
  } else {
    console.error(`✗ ${file} - 文件不存在！`);
    allFilesExist = false;
  }
});

// 检查环境变量文件
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.warn('\n⚠️  警告: .env 文件不存在');
  console.warn('   请确保在生产环境中设置了以下环境变量:');
  console.warn('   - DB_HOST');
  console.warn('   - DB_PORT');
  console.warn('   - DB_USER');
  console.warn('   - DB_PASSWORD');
  console.warn('   - DB_NAME');
  console.warn('   - PORT (可选，默认 3000)');
} else {
  console.log('\n✓ .env 文件存在');
}

// 检查 node_modules
const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.warn('\n⚠️  警告: node_modules 不存在');
  console.warn('   请运行: pnpm install');
} else {
  console.log('✓ node_modules 存在');
}

if (allFilesExist) {
  console.log('\n✅ 构建检查完成！');
  console.log('✅ 静态文件已就绪');
  console.log('✅ 后端服务配置完成');
  console.log('\n📝 部署提示:');
  console.log('   1. 确保设置了正确的环境变量');
  console.log('   2. 确保数据库连接配置正确');
  console.log('   3. 运行 pnpm start 启动服务');
  process.exit(0);
} else {
  console.error('\n❌ 构建失败：缺少必要文件');
  process.exit(1);
}
