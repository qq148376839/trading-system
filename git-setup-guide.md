# Git 上传到 GitHub 指南

## 步骤 1: 初始化 Git 仓库

如果项目还没有初始化 Git，请运行：

```bash
cd "D:\Python脚本\trading-system"
git init
```

## 步骤 2: 配置 Git 用户信息（如果还没有配置）

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

## 步骤 3: 添加所有文件到暂存区

```bash
git add .
```

## 步骤 4: 创建初始提交

```bash
git commit -m "Initial commit: 量化交易系统 - 包含卖空功能完整实现"
```

## 步骤 5: 在 GitHub 上创建新仓库

1. 访问 https://github.com/new
2. 创建新仓库（例如：`trading-system`）
3. **不要**初始化 README、.gitignore 或 license（因为我们已经有了）

## 步骤 6: 添加远程仓库并推送

```bash
# 添加远程仓库（替换 YOUR_USERNAME 和 YOUR_REPO_NAME）
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

## 或者使用 SSH（推荐）

```bash
# 添加 SSH 远程仓库
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

## 注意事项

1. **敏感信息**：确保 `.env` 文件已在 `.gitignore` 中（已确认）
2. **大文件**：如果项目很大，可能需要使用 Git LFS
3. **分支保护**：建议在 GitHub 上设置分支保护规则

## 后续更新

以后更新代码时：

```bash
git add .
git commit -m "描述你的更改"
git push
```


