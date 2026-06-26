param()
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== ESG Demo Launcher ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Start backend ──────────────────────────────────────
Write-Host "[1/5] Starting backend (uvicorn port 8000)..." -ForegroundColor Cyan
$backendCmd = "cd '$ROOT'; uvicorn api.main:app --port 8000"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmd) -WindowStyle Normal
Start-Sleep -Seconds 4

# ── Step 2: Backend Cloudflare Tunnel ────────────────────────
Write-Host "[2/5] Creating backend Cloudflare Tunnel..." -ForegroundColor Cyan
$logBackend = "$env:TEMP\esg_backend.log"
if (Test-Path $logBackend) { Remove-Item $logBackend -ErrorAction SilentlyContinue }
Start-Process cloudflared -ArgumentList @("tunnel", "--url", "http://localhost:8000") -RedirectStandardError $logBackend -WindowStyle Hidden

Write-Host "  Waiting for backend URL" -NoNewline
$backendUrl = ""
$count = 0
while ($count -lt 45) {
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    $count++
    if (Test-Path $logBackend) {
        $txt = Get-Content $logBackend -Raw -ErrorAction SilentlyContinue
        if ($txt -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $backendUrl = $Matches[0]
            $count = 999
        }
    }
}
Write-Host ""

if ($backendUrl -eq "") {
    Write-Host "ERROR: Could not get backend URL." -ForegroundColor Red
    exit 1
}
Write-Host "  Backend URL: $backendUrl" -ForegroundColor Green

# ── Step 3: Write .env.local ──────────────────────────────────
Write-Host "[3/5] Writing frontend config..." -ForegroundColor Cyan
$envContent = "NEXT_PUBLIC_API_URL=$backendUrl"
Set-Content -Path "$ROOT\frontend-next\.env.local" -Value $envContent -Encoding UTF8
Write-Host "  NEXT_PUBLIC_API_URL=$backendUrl"

# ── Step 4: Build and start frontend ─────────────────────────
Write-Host "[4/5] Building frontend (takes ~1-2 min)..." -ForegroundColor Cyan
Push-Location "$ROOT\frontend-next"
npm run build
$buildResult = $LASTEXITCODE
Pop-Location
if ($buildResult -ne 0) {
    Write-Host "ERROR: Frontend build failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Build done. Starting frontend..." -ForegroundColor Gray
$frontendCmd = "cd '$ROOT\frontend-next'; npm run start"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCmd) -WindowStyle Normal
Start-Sleep -Seconds 6

# ── Step 5: Frontend Cloudflare Tunnel ───────────────────────
Write-Host "[5/5] Creating frontend Cloudflare Tunnel..." -ForegroundColor Cyan
$logFrontend = "$env:TEMP\esg_frontend.log"
if (Test-Path $logFrontend) { Remove-Item $logFrontend -ErrorAction SilentlyContinue }
Start-Process cloudflared -ArgumentList @("tunnel", "--url", "http://localhost:3000") -RedirectStandardError $logFrontend -WindowStyle Hidden

Write-Host "  Waiting for frontend URL" -NoNewline
$frontendUrl = ""
$count = 0
while ($count -lt 45) {
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    $count++
    if (Test-Path $logFrontend) {
        $txt = Get-Content $logFrontend -Raw -ErrorAction SilentlyContinue
        if ($txt -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $frontendUrl = $Matches[0]
            $count = 999
        }
    }
}
Write-Host ""

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($frontendUrl -ne "") {
    Write-Host "  Share this link with your teammate:" -ForegroundColor Green
    Write-Host ""
    Write-Host "  $frontendUrl" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "  Could not auto-detect frontend URL." -ForegroundColor Yellow
    Write-Host "  Run manually: cloudflared tunnel --url http://localhost:3000" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Green
