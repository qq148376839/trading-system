# Git 上传到 GitHub 脚本
# 使用方法: .\git-push-to-github.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Git 上传到 GitHub ===" -ForegroundColor Green

# 切换到项目目录
$projectPath = "D:\Python脚本\trading-system"
Set-Location $projectPath
Write-Host "当前目录: $(Get-Location)" -ForegroundColor Cyan

# 检查是否已初始化 Git
if (-not (Test-Path .git)) {
    Write-Host "`n初始化 Git 仓库..." -ForegroundColor Yellow
    git init
    Write-Host "Git 仓库初始化完成" -ForegroundColor Green
} else {
    Write-Host "`nGit 仓库已存在" -ForegroundColor Green
}

# 检查 Git 用户配置
Write-Host "`n检查 Git 用户配置..." -ForegroundColor Yellow
$userName = git config user.name
$userEmail = git config user.email

if (-not $userName -or -not $userEmail) {
    Write-Host "警告: Git 用户信息未配置" -ForegroundColor Red
    Write-Host "请运行以下命令配置:" -ForegroundColor Yellow
    Write-Host "  git config user.name `"Your Name`"" -ForegroundColor Cyan
    Write-Host "  git config user.email `"your.email@example.com`"" -ForegroundColor Cyan
    exit 1
} else {
    Write-Host "Git 用户: $userName <$userEmail>" -ForegroundColor Green
}

# 检查远程仓库
Write-Host "`n检查远程仓库配置..." -ForegroundColor Yellow
$remoteUrl = git remote get-url origin 2>$null

if ($remoteUrl) {
    Write-Host "远程仓库: $remoteUrl" -ForegroundColor Green
} else {
    Write-Host "未配置远程仓库" -ForegroundColor Yellow
    Write-Host "`n请先创建 GitHub 仓库，然后运行:" -ForegroundColor Yellow
    Write-Host "  git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git" -ForegroundColor Cyan
    Write-Host "或者使用 SSH:" -ForegroundColor Yellow
    Write-Host "  git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git" -ForegroundColor Cyan
    Write-Host "`n然后重新运行此脚本" -ForegroundColor Yellow
    exit 1
}

# 添加所有文件
Write-Host "`n添加所有文件到暂存区..." -ForegroundColor Yellow
git add .
Write-Host "文件已添加到暂存区" -ForegroundColor Green

# 检查是否有更改
$status = git status --short
if (-not $status) {
    Write-Host "`n没有需要提交的更改" -ForegroundColor Yellow
} else {
    Write-Host "`n待提交的更改:" -ForegroundColor Yellow
    git status --short
    
    # 创建提交
    Write-Host "`n创建提交..." -ForegroundColor Yellow
    $commitMessage = "feat: 卖空功能完整实施 - 包含产品分析、代码审查、测试和文档"
    
    # 检查是否有未提交的更改
    $hasChanges = git diff --cached --quiet
    if (-not $hasChanges) {
        git commit -m $commitMessage
        Write-Host "提交创建成功" -ForegroundColor Green
    } else {
        Write-Host "没有需要提交的更改" -ForegroundColor Yellow
    }
}

# 检查当前分支
$currentBranch = git branch --show-current
if (-not $currentBranch) {
    Write-Host "`n创建 main 分支..." -ForegroundColor Yellow
    git branch -M main
    $currentBranch = "main"
}

Write-Host "`n当前分支: $currentBranch" -ForegroundColor Green

# 推送到 GitHub
Write-Host "`n推送到 GitHub..." -ForegroundColor Yellow
try {
    git push -u origin $currentBranch
    Write-Host "`n✅ 代码已成功推送到 GitHub!" -ForegroundColor Green
} catch {
    Write-Host "`n❌ 推送失败: $_" -ForegroundColor Red
    Write-Host "`n请检查:" -ForegroundColor Yellow
    Write-Host "  1. GitHub 仓库是否存在" -ForegroundColor Cyan
    Write-Host "  2. 是否有推送权限" -ForegroundColor Cyan
    Write-Host "  3. 网络连接是否正常" -ForegroundColor Cyan
    exit 1
}

Write-Host "`n=== 完成 ===" -ForegroundColor Green

