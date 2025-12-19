# 文档整理清理脚本
# 执行时间: 2025-12-16

Write-Host "开始文档整理..." -ForegroundColor Green

# 创建归档目录
$archiveDir = "docs\archive\2025-12-16-analysis"
if (-not (Test-Path $archiveDir)) {
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    Write-Host "创建归档目录: $archiveDir" -ForegroundColor Yellow
}

# 移动分析报告到归档目录
$analysisReports = @(
    "ANALYSIS_SUMMARY_UPDATE.md",
    "BACKFILL_ANALYSIS.md",
    "BACKFILL_MATCHING_ANALYSIS.md",
    "CHECK_ORDERS_DATA.md",
    "CLEANUP_EXECUTION_RESULT.md",
    "CLEANUP_SUCCESS_SUMMARY.md",
    "DATA_CLEANUP_PLAN.md",
    "HISTORICAL_ORDERS_SIGNAL_CREATION.md",
    "OPTIMIZATION_IMPLEMENTATION.md",
    "SIGNAL_CREATION_SUCCESS.md",
    "TRADING_STRATEGY_ANALYSIS_REPORT.md",
    "WARNING_LOGS_ANALYSIS_REPORT.md"
)

foreach ($file in $analysisReports) {
    if (Test-Path $file) {
        Move-Item $file $archiveDir -Force
        Write-Host "已移动: $file -> $archiveDir" -ForegroundColor Cyan
    }
}

# 移动指南文档
if (Test-Path "ENV_SETUP_GUIDE.md") {
    Move-Item "ENV_SETUP_GUIDE.md" "docs\guides\" -Force
    Write-Host "已移动: ENV_SETUP_GUIDE.md -> docs\guides\" -ForegroundColor Cyan
}

if (Test-Path "FRONTEND_API_URL_SETUP.md") {
    Move-Item "FRONTEND_API_URL_SETUP.md" "docs\guides\" -Force
    Write-Host "已移动: FRONTEND_API_URL_SETUP.md -> docs\guides\" -ForegroundColor Cyan
}

# 移动技术文档
if (Test-Path "history-candlestick.md") {
    Move-Item "history-candlestick.md" "docs\technical\" -Force
    Write-Host "已移动: history-candlestick.md -> docs\technical\" -ForegroundColor Cyan
}

if (Test-Path "historycandlesticksbyoffset.md") {
    Move-Item "historycandlesticksbyoffset.md" "docs\technical\" -Force
    Write-Host "已移动: historycandlesticksbyoffset.md -> docs\technical\" -ForegroundColor Cyan
}

# 归档历史文档
if (Test-Path "DOCUMENTATION_CLEANUP_SUMMARY.md") {
    Move-Item "DOCUMENTATION_CLEANUP_SUMMARY.md" "docs\archive\" -Force
    Write-Host "已移动: DOCUMENTATION_CLEANUP_SUMMARY.md -> docs\archive\" -ForegroundColor Cyan
}

# 删除docs目录重复文档
$duplicateFiles = @(
    "docs\DOCUMENTATION_STRUCTURE.md",
    "docs\REVISION_SUMMARY_20251208.md",
    "docs\OPTION_CHART_API_ANALYSIS.md"
)

foreach ($file in $duplicateFiles) {
    if (Test-Path $file) {
        Remove-Item $file -Force
        Write-Host "已删除重复文档: $file" -ForegroundColor Yellow
    }
}

# 归档已完成工作文档
$completedWorkFiles = Get-ChildItem -Path "docs" -Filter "251208-*.md" -ErrorAction SilentlyContinue
foreach ($file in $completedWorkFiles) {
    Move-Item $file.FullName "docs\archive\" -Force
    Write-Host "已归档: $($file.Name) -> docs\archive\" -ForegroundColor Cyan
}

$completedWorkFiles = Get-ChildItem -Path "docs" -Filter "251203-*.md" -ErrorAction SilentlyContinue
foreach ($file in $completedWorkFiles) {
    Move-Item $file.FullName "docs\archive\" -Force
    Write-Host "已归档: $($file.Name) -> docs\archive\" -ForegroundColor Cyan
}

$completedWorkFiles = Get-ChildItem -Path "docs" -Filter "251209-*.md" -ErrorAction SilentlyContinue
foreach ($file in $completedWorkFiles) {
    Move-Item $file.FullName "docs\archive\" -Force
    Write-Host "已归档: $($file.Name) -> docs\archive\" -ForegroundColor Cyan
}

# 删除fixes目录重复文档
$fixesFiles = Get-ChildItem -Path "docs\fixes" -Filter "251208-*.md" -ErrorAction SilentlyContinue
foreach ($file in $fixesFiles) {
    Remove-Item $file.FullName -Force
    Write-Host "已删除: $($file.Name)" -ForegroundColor Yellow
}

Write-Host "`n文档整理完成！" -ForegroundColor Green

