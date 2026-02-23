# Git 上传到 GitHub 完整指南

## 📋 前置条件

1. **安装 Git**
   - 下载：https://git-scm.com/download/win
   - 验证安装：`git --version`

2. **GitHub 账户**
   - 注册：https://github.com/signup
   - 配置 SSH 密钥（推荐）或使用 HTTPS

## 🚀 快速开始

### 方法 1: 使用 PowerShell 脚本（推荐）

```powershell
# 在项目根目录运行
.\git-push-to-github.ps1
```

脚本会自动：
- ✅ 检查 Git 仓库是否已初始化
- ✅ 检查 Git 用户配置
- ✅ 检查远程仓库配置
- ✅ 添加所有文件
- ✅ 创建提交
- ✅ 推送到 GitHub

### 方法 2: 手动执行

#### 步骤 1: 初始化 Git 仓库（如果还没有）

```bash
cd "D:\Python脚本\trading-system"
git init
```

#### 步骤 2: 配置 Git 用户信息（如果还没有）

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

#### 步骤 3: 在 GitHub 上创建新仓库

1. 访问 https://github.com/new
2. 仓库名称：`trading-system`（或你喜欢的名称）
3. 描述：`量化交易系统 - 支持卖空功能`
4. **不要**勾选 "Initialize this repository with a README"（因为我们已经有了）
5. 点击 "Create repository"

#### 步骤 4: 添加远程仓库

**使用 HTTPS（简单）：**
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

**使用 SSH（推荐，更安全）：**
```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
```

#### 步骤 5: 添加文件并提交

```bash
# 添加所有文件
git add .

# 创建提交
git commit -m "feat: 卖空功能完整实施 - 2025-12-25

✨ 新功能
- 完整的卖空功能实现（订单提交、持仓管理、平仓）
- 保证金计算和验证服务
- 权限检查和状态管理（SHORTING/SHORT/COVERING）
- 完善的错误处理机制

🧪 测试
- 单元测试：49个用例（全部通过）
- 集成测试：12个用例（全部通过）
- 总测试通过率：100%（201/201）
- 测试覆盖率：> 85%

📝 文档
- 产品分析报告（1349行）
- 代码审查报告（438行）
- 测试用例文档（61个用例）
- 完整实施总结

🔧 代码质量
- 类型安全（移除所有any类型）
- 性能优化（静态导入）
- 统一错误处理
- 完善的代码组织"
```

#### 步骤 6: 推送到 GitHub

```bash
# 设置主分支为 main
git branch -M main

# 推送到 GitHub
git push -u origin main
```

## 🔐 配置 SSH 密钥（推荐）

### 1. 生成 SSH 密钥

```bash
ssh-keygen -t ed25519 -C "your.email@example.com"
```

按 Enter 使用默认路径，设置密码（可选）

### 2. 添加 SSH 密钥到 ssh-agent

```bash
# 启动 ssh-agent
eval "$(ssh-agent -s)"

# 添加密钥
ssh-add ~/.ssh/id_ed25519
```

### 3. 复制公钥

```bash
# Windows PowerShell
cat ~/.ssh/id_ed25519.pub | clip

# 或手动复制文件内容
notepad ~/.ssh/id_ed25519.pub
```

### 4. 添加到 GitHub

1. 访问 https://github.com/settings/keys
2. 点击 "New SSH key"
3. Title: `My Computer`
4. Key: 粘贴复制的公钥
5. 点击 "Add SSH key"

### 5. 测试连接

```bash
ssh -T git@github.com
```

应该看到：`Hi YOUR_USERNAME! You've successfully authenticated...`

## 📝 后续更新

以后更新代码时，使用脚本：

```powershell
.\git-push.ps1
```

或手动执行：

```bash
git add .
git commit -m "描述你的更改"
git push
```

## ⚠️ 注意事项

1. **敏感信息**
   - ✅ `.env` 文件已在 `.gitignore` 中
   - ✅ `node_modules` 已忽略
   - ✅ 日志文件已忽略

2. **大文件**
   - 如果项目很大，可能需要使用 Git LFS
   - 参考：https://git-lfs.github.com/

3. **分支保护**
   - 建议在 GitHub 上设置分支保护规则
   - Settings → Branches → Add rule

4. **提交信息规范**
   - `feat:` 新功能
   - `fix:` 修复
   - `docs:` 文档
   - `test:` 测试
   - `refactor:` 重构
   - `chore:` 构建/工具

## 🆘 常见问题

### Q: 推送时提示 "Permission denied"
A: 检查 SSH 密钥配置或使用 HTTPS + Personal Access Token

### Q: 推送时提示 "remote: Repository not found"
A: 检查仓库名称和用户名是否正确

### Q: 如何更新远程仓库 URL？
```bash
git remote set-url origin NEW_URL
```

### Q: 如何查看当前远程仓库？
```bash
git remote -v
```

## 📚 参考资源

- [Git 官方文档](https://git-scm.com/doc)
- [GitHub 文档](https://docs.github.com/)
- [Git 提交信息规范](https://www.conventionalcommits.org/)



