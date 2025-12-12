# Fix Next.js Build Cache Issues
# This script clears Next.js build cache to fix module resolution errors

Write-Host "Clearing Next.js build cache..." -ForegroundColor Yellow

# Remove .next directory
if (Test-Path ".next") {
    Remove-Item -Recurse -Force ".next"
    Write-Host "✓ Removed .next directory" -ForegroundColor Green
} else {
    Write-Host "✓ .next directory does not exist" -ForegroundColor Gray
}

# Remove node_modules/.cache
if (Test-Path "node_modules\.cache") {
    Remove-Item -Recurse -Force "node_modules\.cache"
    Write-Host "✓ Removed node_modules\.cache directory" -ForegroundColor Green
} else {
    Write-Host "✓ node_modules\.cache directory does not exist" -ForegroundColor Gray
}

# Remove .turbo if exists (for Turborepo)
if (Test-Path ".turbo") {
    Remove-Item -Recurse -Force ".turbo"
    Write-Host "✓ Removed .turbo directory" -ForegroundColor Green
}

Write-Host "`nBuild cache cleared successfully!" -ForegroundColor Green
Write-Host "Please restart the development server with: npm run dev" -ForegroundColor Cyan

