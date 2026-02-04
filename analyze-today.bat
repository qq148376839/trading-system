@echo off
REM ========================================
REM 快捷日志分析脚本
REM 使用方法：
REM   1. 从系统前端导出今日日志到当前目录
REM   2. 双击此脚本运行分析
REM ========================================

echo.
echo ========================================
echo 日志分析工具
echo ========================================
echo.

REM 检查是否提供了日志文件参数
if "%1"=="" (
    REM 没有参数，自动查找今日日志文件
    for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
    set "LOG_FILE=logs-%mydate%.json"

    echo [自动检测] 查找日志文件: %LOG_FILE%

    if not exist "%LOG_FILE%" (
        echo.
        echo [错误] 未找到今日日志文件: %LOG_FILE%
        echo.
        echo 请执行以下步骤:
        echo   1. 在系统前端导出今日日志
        echo   2. 确保文件名为: %LOG_FILE%
        echo   3. 将文件放在此目录: %~dp0
        echo.
        echo 或者手动指定日志文件:
        echo   analyze-today.bat logs-2026-02-04.json
        echo.
        pause
        exit /b 1
    )
) else (
    REM 使用提供的日志文件参数
    set "LOG_FILE=%1"

    if not exist "%LOG_FILE%" (
        echo.
        echo [错误] 找不到日志文件: %LOG_FILE%
        echo.
        pause
        exit /b 1
    )
)

echo [1/3] 正在分析日志文件: %LOG_FILE%
echo.
python scripts\analyze-logs.py "%LOG_FILE%"

if errorlevel 1 (
    echo.
    echo [错误] 日志分析失败，请检查:
    echo   1. Python 是否已安装
    echo   2. scripts\analyze-logs.py 文件是否存在
    echo   3. 日志文件格式是否正确
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] 正在生成 HTML 看板...
echo.
python scripts\generate-html-dashboard.py

if errorlevel 1 (
    echo.
    echo [错误] HTML 生成失败
    echo.
    pause
    exit /b 1
)

echo.
echo [3/3] 正在打开分析结果...
echo.

REM 打开 HTML 看板
if exist "logs-analysis-dashboard.html" (
    echo 正在打开 HTML 看板: logs-analysis-dashboard.html
    start "" "logs-analysis-dashboard.html"
) else (
    echo [警告] HTML 看板文件未生成
)

REM 显示文本版报告路径
if exist "logs-analysis-dashboard.txt" (
    echo.
    echo ========================================
    echo 分析完成！
    echo ========================================
    echo.
    echo 生成的文件:
    echo   - HTML 看板: logs-analysis-dashboard.html
    echo   - 文本报告: logs-analysis-dashboard.txt
    echo   - 详细数据: logs-analysis-detailed.json
    echo.
) else (
    echo [警告] 文本报告文件未生成
)

echo 按任意键退出...
pause >nul
