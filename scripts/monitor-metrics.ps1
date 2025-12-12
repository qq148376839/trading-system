# Order Duplicate Prevention Mechanism - Real-time Metrics Monitor
# Usage: .\scripts\monitor-metrics.ps1

param(
    [string]$ApiBase = "http://localhost:3001",
    [int]$IntervalSeconds = 5
)

$endpoint = "$ApiBase/api/order-prevention-metrics"
$previousMetrics = $null

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Order Duplicate Prevention - Metrics Monitor" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "API Base: $ApiBase" -ForegroundColor Yellow
Write-Host "Refresh Interval: $IntervalSeconds seconds" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
Write-Host ""

function Format-Metrics {
    param($metrics)
    
    Write-Host "Position Validation Metrics:" -ForegroundColor Green
    Write-Host "  Total Validations: $($metrics.positionValidationTotal)" -ForegroundColor White
    Write-Host "  Passed: $($metrics.positionValidationPassed)" -ForegroundColor Green
    Write-Host "  Failed: $($metrics.positionValidationFailed)" -ForegroundColor Red
    
    if ($metrics.positionValidationTotal -gt 0) {
        $passRate = [math]::Round(($metrics.positionValidationPassed / $metrics.positionValidationTotal) * 100, 2)
        $failRate = [math]::Round(($metrics.positionValidationFailed / $metrics.positionValidationTotal) * 100, 2)
        Write-Host "  Pass Rate: $passRate%" -ForegroundColor Green
        Write-Host "  Fail Rate: $failRate%" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Order Deduplication Metrics:" -ForegroundColor Green
    Write-Host "  Total Prevented: $($metrics.duplicateOrderPrevented)" -ForegroundColor White
    Write-Host "  Prevented by Cache: $($metrics.duplicateOrderByCache)" -ForegroundColor Yellow
    Write-Host "  Prevented by Pending Check: $($metrics.duplicateOrderByPending)" -ForegroundColor Yellow
    
    Write-Host ""
    Write-Host "Short Position Detection Metrics:" -ForegroundColor Green
    Write-Host "  Detected: $($metrics.shortPositionDetected)" -ForegroundColor White
    Write-Host "  Auto-closed Success: $($metrics.shortPositionClosed)" -ForegroundColor Green
    Write-Host "  Auto-closed Failed: $($metrics.shortPositionCloseFailed)" -ForegroundColor Red
    
    Write-Host ""
    Write-Host "Trade Push Metrics:" -ForegroundColor Green
    Write-Host "  Received: $($metrics.tradePushReceived)" -ForegroundColor White
    Write-Host "  Errors: $($metrics.tradePushError)" -ForegroundColor Red
    
    Write-Host ""
    Write-Host "Order Rejection Metrics:" -ForegroundColor Green
    Write-Host "  Rejected by Position: $($metrics.orderRejectedByPosition)" -ForegroundColor Red
    Write-Host "  Rejected by Duplicate: $($metrics.orderRejectedByDuplicate)" -ForegroundColor Red
}

function Detect-Changes {
    param($current, $previous)
    
    if ($previous -eq $null) {
        return @()
    }
    
    $changes = @()
    
    if ($current.positionValidationTotal -ne $previous.positionValidationTotal) {
        $changes += "Position Validation Total: $($previous.positionValidationTotal) -> $($current.positionValidationTotal)"
    }
    
    if ($current.positionValidationPassed -ne $previous.positionValidationPassed) {
        $changes += "Position Validation Passed: $($previous.positionValidationPassed) -> $($current.positionValidationPassed) [OK]"
    }
    
    if ($current.positionValidationFailed -ne $previous.positionValidationFailed) {
        $changes += "Position Validation Failed: $($previous.positionValidationFailed) -> $($current.positionValidationFailed) [FAIL]"
    }
    
    if ($current.duplicateOrderPrevented -ne $previous.duplicateOrderPrevented) {
        $changes += "Duplicate Order Prevented: $($previous.duplicateOrderPrevented) -> $($current.duplicateOrderPrevented) [LOCK]"
    }
    
    if ($current.shortPositionDetected -ne $previous.shortPositionDetected) {
        $changes += "Short Position Detected: $($previous.shortPositionDetected) -> $($current.shortPositionDetected) [WARN]"
    }
    
    if ($current.shortPositionClosed -ne $previous.shortPositionClosed) {
        $changes += "Short Position Closed: $($previous.shortPositionClosed) -> $($current.shortPositionClosed) [OK]"
    }
    
    if ($current.tradePushReceived -ne $previous.tradePushReceived) {
        $changes += "Trade Push Received: $($previous.tradePushReceived) -> $($current.tradePushReceived) [PUSH]"
    }
    
    return $changes
}

try {
    while ($true) {
        try {
            $response = Invoke-RestMethod -Uri $endpoint -ErrorAction Stop
            $metrics = $response.data.metrics
            
            Clear-Host
            Write-Host "==========================================" -ForegroundColor Cyan
            Write-Host "Order Duplicate Prevention - Metrics Monitor" -ForegroundColor Cyan
            Write-Host "==========================================" -ForegroundColor Cyan
            Write-Host "Update Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow
            Write-Host ""
            
            # Detect changes
            $changes = Detect-Changes -current $metrics -previous $previousMetrics
            if ($changes.Count -gt 0) {
                Write-Host "[CHANGE] Metrics Changed:" -ForegroundColor Magenta
                $changes | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
                Write-Host ""
            }
            
            # Display metrics
            Format-Metrics -metrics $metrics
            
            Write-Host "==========================================" -ForegroundColor Cyan
            Write-Host "Next refresh in $IntervalSeconds seconds (Ctrl+C to stop)" -ForegroundColor Gray
            
            $previousMetrics = $metrics
            Start-Sleep -Seconds $IntervalSeconds
        } catch {
            Write-Host "Error: Failed to fetch metrics - $_" -ForegroundColor Red
            Write-Host "Retrying in 5 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
} catch {
    Write-Host "Monitoring stopped" -ForegroundColor Yellow
}
