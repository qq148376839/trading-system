# 测试交易推送修复脚本 (PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "交易推送修复测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否在正确的目录
if (-not (Test-Path "package.json")) {
    Write-Host "错误: 请在 api 目录下运行此脚本" -ForegroundColor Red
    exit 1
}

# 检查 ts-node 是否安装
$tsNodeInstalled = Get-Command ts-node -ErrorAction SilentlyContinue
if (-not $tsNodeInstalled) {
    Write-Host "安装 ts-node..." -ForegroundColor Yellow
    npm install -g ts-node typescript
}

# 运行测试
Write-Host "运行测试脚本..." -ForegroundColor Green
Write-Host ""

npx ts-node scripts/test-trade-push-fix.ts

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "✅ 所有测试通过！" -ForegroundColor Green
} else {
    Write-Host "❌ 测试失败，退出码: $exitCode" -ForegroundColor Red
}

exit $exitCode




