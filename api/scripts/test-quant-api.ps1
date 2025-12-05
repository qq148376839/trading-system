# Quantitative Trading API Test Script for Windows PowerShell
# Test all quant trading API endpoints

$ErrorActionPreference = "Continue"

$BASE_URL = if ($env:API_URL) { $env:API_URL } else { "http://localhost:3001" }
$API_PREFIX = "/api/quant"

# Colors
function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "--- $Title ---" -ForegroundColor Yellow
    Write-Host ""
}

# Test API function
function Test-API {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Url,
        [string]$Data = $null
    )
    
    Write-Info "Testing: $Name"
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
        }
        
        if ($Method -eq "GET") {
            $response = Invoke-WebRequest -Uri "$BASE_URL$Url" -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
        }
        elseif ($Method -eq "POST") {
            $response = Invoke-WebRequest -Uri "$BASE_URL$Url" -Method Post -Headers $headers -Body $Data -UseBasicParsing -ErrorAction Stop
        }
        elseif ($Method -eq "DELETE") {
            $response = Invoke-WebRequest -Uri "$BASE_URL$Url" -Method Delete -Headers $headers -UseBasicParsing -ErrorAction Stop
        }
        
        $statusCode = $response.StatusCode
        
        if ($statusCode -ge 200 -and $statusCode -lt 300) {
            Write-Success "$Name - Status: $statusCode"
            try {
                $json = $response.Content | ConvertFrom-Json
                $json | ConvertTo-Json -Depth 10 | Write-Host
            }
            catch {
                Write-Host $response.Content
            }
            return $true
        }
        else {
            Write-Error-Custom "$Name - Status: $statusCode"
            Write-Host $response.Content
            return $false
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode) {
            Write-Error-Custom "$Name - Status: $statusCode"
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host $responseBody
        }
        else {
            Write-Error-Custom "$Name - Error: $($_.Exception.Message)"
        }
        return $false
    }
}

# Main
Write-Host ""
Write-Host "=== Quantitative Trading API Test Tool ===" -ForegroundColor Blue
Write-Host ""
Write-Info "Base URL: $BASE_URL"
Write-Host ""

$passed = 0
$failed = 0

# Capital Management API
Write-Section "Capital Management API"

if (Test-API "GET /capital/allocations" "GET" "$API_PREFIX/capital/allocations") { $passed++ } else { $failed++ }

$allocationData = @{
    name = "TEST_STRATEGY_A"
    parentId = $null
    allocationType = "PERCENTAGE"
    allocationValue = 0.3
} | ConvertTo-Json -Compress

if (Test-API "POST /capital/allocations" "POST" "$API_PREFIX/capital/allocations" $allocationData) { $passed++ } else { $failed++ }
if (Test-API "GET /capital/usage" "GET" "$API_PREFIX/capital/usage") { $passed++ } else { $failed++ }
if (Test-API "POST /capital/sync-balance" "POST" "$API_PREFIX/capital/sync-balance") { $passed++ } else { $failed++ }
if (Test-API "GET /capital/balance-discrepancies" "GET" "$API_PREFIX/capital/balance-discrepancies") { $passed++ } else { $failed++ }

# Stock Selector API
Write-Section "Stock Selector API"

if (Test-API "GET /stock-selector/blacklist" "GET" "$API_PREFIX/stock-selector/blacklist") { $passed++ } else { $failed++ }

$blacklistData = @{
    symbol = "TEST.US"
    reason = "Test blacklist entry"
} | ConvertTo-Json -Compress

if (Test-API "POST /stock-selector/blacklist" "POST" "$API_PREFIX/stock-selector/blacklist" $blacklistData) { $passed++ } else { $failed++ }
if (Test-API "DELETE /stock-selector/blacklist/TEST.US" "DELETE" "$API_PREFIX/stock-selector/blacklist/TEST.US") { $passed++ } else { $failed++ }

# Strategy Management API
Write-Section "Strategy Management API"

if (Test-API "GET /strategies" "GET" "$API_PREFIX/strategies") { $passed++ } else { $failed++ }

$strategyData = @{
    name = "Test Recommendation Strategy"
    type = "RECOMMENDATION_V1"
    symbolPoolConfig = @{
        mode = "STATIC"
        symbols = @("AAPL.US", "MSFT.US")
    }
    config = @{
        atrPeriod = 14
        atrMultiplier = 2.0
        riskRewardRatio = 1.5
    }
} | ConvertTo-Json -Depth 10 -Compress

if (Test-API "POST /strategies" "POST" "$API_PREFIX/strategies" $strategyData) { $passed++ } else { $failed++ }

# Signal Logs API
Write-Section "Signal Logs API"

if (Test-API "GET /signals" "GET" "$API_PREFIX/signals?limit=10") { $passed++ } else { $failed++ }

# Trade Records API
Write-Section "Trade Records API"

if (Test-API "GET /trades" "GET" "$API_PREFIX/trades?limit=10") { $passed++ } else { $failed++ }

# Summary
Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Blue
Write-Host ""
Write-Success "Passed: $passed"
Write-Error-Custom "Failed: $failed"
Write-Info "Total: $($passed + $failed)"
Write-Host ""

if ($failed -eq 0) {
    Write-Host "✓ All tests passed!" -ForegroundColor Green
    Write-Host ""
    exit 0
}
else {
    Write-Host "✗ Some tests failed" -ForegroundColor Red
    Write-Host ""
    exit 1
}


