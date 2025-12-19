/**
 * 诊断 Task_queues 模块的来源
 * 查询数据库中 Task_queues 模块的实际文件路径
 * 
 * 使用方法：
 * 1. 安装依赖：npm install pg（在 api 目录下）
 * 2. 设置环境变量（可选）
 * 3. 运行脚本：node scripts/diagnose-task-queues-module.js
 * 
 * 或者直接使用 SQL 文件：scripts/diagnose-task-queues-module.sql
 */

let Pool;
try {
  Pool = require('pg').Pool;
} catch (error) {
  console.error('❌ 错误：未找到 pg 模块');
  console.error('');
  console.error('请先安装依赖：');
  console.error('  cd api');
  console.error('  npm install pg');
  console.error('  或');
  console.error('  cd api');
  console.error('  pnpm add pg');
  console.error('');
  console.error('或者直接使用 SQL 文件查询：');
  console.error('  scripts/diagnose-task-queues-module.sql');
  console.error('');
  console.error('也可以使用 API 接口查询（如果已实现）：');
  console.error('  GET /api/logs?module=Task_queues&limit=10');
  process.exit(1);
}

const path = require('path');

// 从环境变量或默认配置读取数据库连接信息
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'trading_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function diagnoseTaskQueues() {
  try {
    console.log('🔍 开始诊断 Task_queues 模块...\n');

    // 1. 查看 Task_queues 模块的文件路径分布
    console.log('1️⃣ 查看 Task_queues 模块的文件路径分布:');
    const filePathResult = await pool.query(`
      SELECT 
        file_path,
        COUNT(*) as log_count,
        MIN(timestamp) as first_log,
        MAX(timestamp) as last_log
      FROM system_logs
      WHERE module = 'Task_queues'
      GROUP BY file_path
      ORDER BY log_count DESC
      LIMIT 20
    `);
    
    if (filePathResult.rows.length === 0) {
      console.log('   ❌ 未找到 Task_queues 模块的日志');
    } else {
      filePathResult.rows.forEach((row, index) => {
        console.log(`   ${index + 1}. ${row.file_path}`);
        console.log(`      日志数量: ${row.log_count}`);
        console.log(`      首次日志: ${row.first_log}`);
        console.log(`      最后日志: ${row.last_log}`);
        console.log('');
      });
    }

    // 2. 查看示例日志
    console.log('2️⃣ 查看 Task_queues 模块的示例日志:');
    const sampleResult = await pool.query(`
      SELECT 
        id,
        timestamp,
        level,
        module,
        message,
        file_path,
        line_no
      FROM system_logs
      WHERE module = 'Task_queues'
      ORDER BY timestamp DESC
      LIMIT 5
    `);
    
    sampleResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. [${row.timestamp}] ${row.level} - ${row.module}`);
      console.log(`      消息: ${row.message.substring(0, 100)}...`);
      console.log(`      文件: ${row.file_path}:${row.line_no}`);
      console.log('');
    });

    // 3. 查看所有使用下划线命名的模块
    console.log('3️⃣ 查看所有使用下划线命名的模块:');
    const underscoreResult = await pool.query(`
      SELECT DISTINCT module
      FROM system_logs
      WHERE module LIKE '%_%'
        AND module NOT LIKE '%.%'
      ORDER BY module
    `);
    
    if (underscoreResult.rows.length === 0) {
      console.log('   ✅ 未发现其他使用下划线命名的模块');
    } else {
      underscoreResult.rows.forEach((row) => {
        console.log(`   - ${row.module}`);
      });
    }
    console.log('');

    // 4. 统计各模块的日志数量
    console.log('4️⃣ 统计各模块的日志数量（Top 20）:');
    const statsResult = await pool.query(`
      SELECT 
        module,
        COUNT(*) as log_count,
        COUNT(DISTINCT DATE(timestamp)) as days_active
      FROM system_logs
      GROUP BY module
      ORDER BY log_count DESC
      LIMIT 20
    `);
    
    statsResult.rows.forEach((row, index) => {
      const marker = row.module === 'Task_queues' ? ' ⚠️' : '';
      console.log(`   ${index + 1}. ${row.module}${marker} - ${row.log_count} 条日志 (${row.days_active} 天)`);
    });

    // 5. 分析文件路径模式
    if (filePathResult.rows.length > 0) {
      console.log('\n5️⃣ 分析文件路径模式:');
      const filePaths = filePathResult.rows.map(row => row.file_path);
      const uniquePaths = [...new Set(filePaths)];
      
      uniquePaths.forEach((filePath, index) => {
        const fileName = path.basename(filePath);
        const dirName = path.dirname(filePath);
        console.log(`   ${index + 1}. 文件名: ${fileName}`);
        console.log(`      目录: ${dirName}`);
        console.log(`      可能的原因:`);
        
        // 分析文件名
        if (fileName.includes('_')) {
          console.log(`        - 文件名包含下划线 "_"，推断模块名称时保留了原格式`);
        }
        if (fileName.includes('task') || fileName.includes('queue')) {
          console.log(`        - 文件名包含 "task" 或 "queue"，可能被推断为 Task_queues`);
        }
        console.log('');
      });
    }

    console.log('\n✅ 诊断完成！');
    console.log('\n💡 建议:');
    console.log('   1. 根据文件路径添加映射规则到 log-module-mapper.ts');
    console.log('   2. 如果文件路径指向 strategy-scheduler.service.ts，应映射到 Strategy.Scheduler');
    console.log('   3. 如果确实是独立模块，可以创建新的映射规则');

  } catch (error) {
    console.error('❌ 诊断失败:', error);
  } finally {
    await pool.end();
  }
}

// 运行诊断
diagnoseTaskQueues();

