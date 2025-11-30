@echo off
REM Quantitative Trading API Test Script for Windows
REM Test all quant trading API endpoints

setlocal enabledelayedexpansion

set BASE_URL=%API_URL%
if "%BASE_URL%"=="" set BASE_URL=http://localhost:3001
set API_PREFIX=/api/quant

echo.
echo === Quantitative Trading API Test Tool ===
echo.
echo Base URL: %BASE_URL%
echo.

REM Test function
:test_api
set name=%~1
set method=%~2
set url=%~3
set data=%~4

echo [INFO] Testing: %name%

REM Create temp file for response
set TEMP_FILE=%TEMP%\api_test_%RANDOM%.txt

if "%method%"=="GET" (
    curl -s -w "\nHTTP_CODE:%{http_code}" "%BASE_URL%%url%" > "%TEMP_FILE%" 2>nul
) else if "%method%"=="POST" (
    curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "%BASE_URL%%url%" -H "Content-Type: application/json" -d "%data%" > "%TEMP_FILE%" 2>nul
) else if "%method%"=="DELETE" (
    curl -s -w "\nHTTP_CODE:%{http_code}" -X DELETE "%BASE_URL%%url%" > "%TEMP_FILE%" 2>nul
)

REM Extract HTTP code
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" "%TEMP_FILE%"') do set http_code=%%a

REM Extract body (remove HTTP_CODE line)
findstr /v "HTTP_CODE" "%TEMP_FILE%" > "%TEMP_FILE%.body" 2>nul

if %http_code% geq 200 if %http_code% lss 300 (
    echo [OK] %name% - Status: %http_code%
    type "%TEMP_FILE%.body" 2>nul
    del "%TEMP_FILE%" "%TEMP_FILE%.body" 2>nul
    exit /b 0
) else (
    echo [ERROR] %name% - Status: %http_code%
    type "%TEMP_FILE%.body" 2>nul
    del "%TEMP_FILE%" "%TEMP_FILE%.body" 2>nul
    exit /b 1
)

REM Capital Management API
echo.
echo --- Capital Management API ---
echo.

call :test_api "GET /capital/allocations" "GET" "%API_PREFIX%/capital/allocations" ""
call :test_api "GET /capital/usage" "GET" "%API_PREFIX%/capital/usage" ""
call :test_api "POST /capital/sync-balance" "POST" "%API_PREFIX%/capital/sync-balance" ""
call :test_api "GET /capital/balance-discrepancies" "GET" "%API_PREFIX%/capital/balance-discrepancies" ""

REM Create allocation (escape quotes for JSON)
set ALLOCATION_DATA={"name":"TEST_STRATEGY_A","parentId":null,"allocationType":"PERCENTAGE","allocationValue":0.3}
call :test_api "POST /capital/allocations" "POST" "%API_PREFIX%/capital/allocations" "%ALLOCATION_DATA%"

REM Stock Selector API
echo.
echo --- Stock Selector API ---
echo.

call :test_api "GET /stock-selector/blacklist" "GET" "%API_PREFIX%/stock-selector/blacklist" ""

set BLACKLIST_DATA={"symbol":"TEST.US","reason":"Test blacklist entry"}
call :test_api "POST /stock-selector/blacklist" "POST" "%API_PREFIX%/stock-selector/blacklist" "%BLACKLIST_DATA%"
call :test_api "DELETE /stock-selector/blacklist/TEST.US" "DELETE" "%API_PREFIX%/stock-selector/blacklist/TEST.US" ""

REM Strategy Management API
echo.
echo --- Strategy Management API ---
echo.

call :test_api "GET /strategies" "GET" "%API_PREFIX%/strategies" ""

REM Create strategy (use file for complex JSON)
echo {"name":"Test Recommendation Strategy","type":"RECOMMENDATION_V1","symbolPoolConfig":{"mode":"STATIC","symbols":["AAPL.US","MSFT.US"]},"config":{"atrPeriod":14,"atrMultiplier":2.0,"riskRewardRatio":1.5}} > "%TEMP%\strategy_data.json"
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "%BASE_URL%%API_PREFIX%/strategies" -H "Content-Type: application/json" -d "@%TEMP%\strategy_data.json" > "%TEMP%\strategy_response.txt" 2>nul
for /f "tokens=2 delims=:" %%a in ('findstr "HTTP_CODE" "%TEMP%\strategy_response.txt"') do set http_code=%%a
if %http_code% geq 200 if %http_code% lss 300 (
    echo [OK] POST /strategies - Status: %http_code%
) else (
    echo [ERROR] POST /strategies - Status: %http_code%
)
findstr /v "HTTP_CODE" "%TEMP%\strategy_response.txt" 2>nul
del "%TEMP%\strategy_data.json" "%TEMP%\strategy_response.txt" 2>nul

REM Signal Logs API
echo.
echo --- Signal Logs API ---
echo.

call :test_api "GET /signals" "GET" "%API_PREFIX%/signals?limit=10" ""

REM Trade Records API
echo.
echo --- Trade Records API ---
echo.

call :test_api "GET /trades" "GET" "%API_PREFIX%/trades?limit=10" ""

echo.
echo === Test Complete ===
echo.

endlocal
