Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  NUIST-RUNACCM AutoDataLabeling" -ForegroundColor Cyan
Write-Host "  Intelligent Car Track 3D Auto-Labeling" -ForegroundColor Cyan
Write-Host "  (Modified with assistance from DeepSeek)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$port = 8000

Write-Host "[*] Starting HTTP server on port $port ..." -ForegroundColor Green
Write-Host "[*] Opening browser at http://localhost:$port" -ForegroundColor Green
Write-Host "[*] Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

Start-Process "http://localhost:$port"
python -m http.server $port
