# 回测历史数据优化功能测试运行脚本 (PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "回测历史数据优化功能测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否安装了依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠️  未找到node_modules，正在安装依赖..." -ForegroundColor Yellow
    npm install
}

Write-Host "📋 运行单元测试..." -ForegroundColor Green
npm test -- backtest-optimization.test.ts

Write-Host ""
Write-Host "📋 运行集成测试..." -ForegroundColor Green
npm test -- integration-backtest.test.ts

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试完成！" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

