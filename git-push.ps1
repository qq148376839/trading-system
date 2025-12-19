# Git 提交和推送脚本
# 用于将所有更新提交到 GitHub

Write-Host "=== Git 提交和推送脚本 ===" -ForegroundColor Green

# 切换到项目目录
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectPath

Write-Host "当前目录: $projectPath" -ForegroundColor Yellow

# 检查是否是 git 仓库
if (-not (Test-Path .git)) {
    Write-Host "错误: 当前目录不是 git 仓库！" -ForegroundColor Red
    Write-Host "请先初始化 git 仓库: git init" -ForegroundColor Yellow
    exit 1
}

# 检查 git 状态
Write-Host "`n检查 git 状态..." -ForegroundColor Cyan
git status

# 添加所有更改的文件
Write-Host "`n添加所有更改的文件..." -ForegroundColor Cyan
git add .

# 显示将要提交的文件
Write-Host "`n将要提交的文件:" -ForegroundColor Cyan
git status --short

# 提交更改
$commitMessage = "docs: 更新文档 - LongPort SDK升级到3.0.18、市场状态矩阵测试完成

- 升级LongPort SDK从1.1.7到3.0.18
- 成功实现市场温度功能（获取值：70.0）
- 修复所有candlesticks方法调用，添加TradeSessions参数
- 创建市场状态矩阵测试文件（21个测试用例，100%通过）
- 更新所有相关文档（CHANGELOG、README、CODE_MAP）"

Write-Host "`n提交更改..." -ForegroundColor Cyan
git commit -m $commitMessage

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n提交成功！" -ForegroundColor Green
    
    # 检查远程仓库
    Write-Host "`n检查远程仓库..." -ForegroundColor Cyan
    $remoteUrl = git remote get-url origin 2>$null
    
    if ($remoteUrl) {
        Write-Host "远程仓库: $remoteUrl" -ForegroundColor Yellow
        
        # 推送到 GitHub
        Write-Host "`n推送到 GitHub..." -ForegroundColor Cyan
        git push origin main
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n推送成功！" -ForegroundColor Green
        } else {
            Write-Host "`n推送失败，请检查网络连接和权限" -ForegroundColor Red
            Write-Host "如果使用其他分支，请使用: git push origin <branch-name>" -ForegroundColor Yellow
        }
    } else {
        Write-Host "`n未找到远程仓库，请先添加远程仓库:" -ForegroundColor Yellow
        Write-Host "git remote add origin <your-github-repo-url>" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n提交失败，可能没有更改需要提交" -ForegroundColor Yellow
}

Write-Host "`n=== 完成 ===" -ForegroundColor Green

