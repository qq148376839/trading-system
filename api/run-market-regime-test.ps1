# 运行市场状态矩阵测试
# 使用方法: .\run-market-regime-test.ps1

Write-Host "运行市场状态矩阵测试..." -ForegroundColor Green

# 切换到API目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# 运行测试
npx jest src/tests/market-regime-matrix.test.ts --verbose

