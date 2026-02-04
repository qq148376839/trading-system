@echo off
REM ========================================
REM 快速分析最新日志文件
REM 自动找到最新的 logs-*.json 文件并分析
REM ========================================

echo.
echo ========================================
echo 快速日志分析工具
echo ========================================
echo.

REM 查找最新的日志文件
for /f "delims=" %%i in ('dir /b /o-d logs-*.json 2^>nul ^| findstr /r "logs-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].json" ^| findstr /n "^" ^| findstr "^1:"') do (
    set "LATEST_LOG=%%i"
)

REM 移除行号前缀
set "LATEST_LOG=%LATEST_LOG:*:=%"

if "%LATEST_LOG%"=="" (
    echo [错误] 未找到任何日志文件 (logs-*.json)
    echo.
    echo 请确保:
    echo   1. 从系统前端导出日志文件
    echo   2. 文件名格式为: logs-YYYY-MM-DD.json
    echo   3. 文件位于当前目录: %~dp0
    echo.
    pause
    exit /b 1
)

echo [检测到最新日志] %LATEST_LOG%
echo.

REM 调用主分析脚本
call analyze-today.bat "%LATEST_LOG%"
