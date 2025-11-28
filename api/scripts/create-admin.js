/**
 * 创建管理员账户脚本
 * 使用方法: node scripts/create-admin.js [username] [password]
 * 
 * 示例:
 *   node scripts/create-admin.js admin mypassword123
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// 加载.env文件
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createAdmin() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3];

  if (!password) {
    console.error('错误: 请提供密码');
    console.error('使用方法: node scripts/create-admin.js [username] [password]');
    console.error('示例: node scripts/create-admin.js admin mypassword123');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('错误: 密码长度至少6位');
    process.exit(1);
  }

  console.log(`正在创建管理员账户: ${username}...`);

  try {
    // 检查账户是否已存在
    const existing = await pool.query(
      'SELECT id FROM admin_users WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      console.log(`账户 ${username} 已存在，将更新密码...`);
    }

    // 加密密码
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 创建或更新管理员账户
    await pool.query(
      `INSERT INTO admin_users (username, password_hash, is_active) 
       VALUES ($1, $2, true) 
       ON CONFLICT (username) 
       DO UPDATE SET password_hash = $2, is_active = true, last_login_at = NULL`,
      [username, passwordHash]
    );

    console.log(`✅ 管理员账户创建成功！`);
    console.log(`   用户名: ${username}`);
    console.log(`   密码: ${'*'.repeat(password.length)}`);
    console.log(`\n现在可以使用此账户登录配置管理页面。`);
  } catch (error) {
    console.error('❌ 创建失败:', error.message);
    
    if (error.message.includes('relation "admin_users" does not exist')) {
      console.error('\n提示: 请先运行数据库迁移脚本:');
      console.error('   psql -U your_user -d your_database -f api/migrations/003_config_management.sql');
    } else if (error.message.includes('connect')) {
      console.error('\n提示: 无法连接到数据库，请检查:');
      console.error('   1. DATABASE_URL环境变量是否正确设置');
      console.error('   2. 数据库服务是否正在运行');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdmin();

