@echo off
setlocal

set "APP_DIR=%~dp0"
set "PORT=8787"
set "URL=http://localhost:8787/"
set "LOG_DIR=%APP_DIR%logs"
set "OPEN_APP=powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%open-workbench-app.ps1""

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$required=4; $ok=$false; $needsRestart=$false; try { $health=Invoke-RestMethod -Uri 'http://localhost:8787/api/health' -TimeoutSec 2; $ok=[bool]$health.ok; $version=[int]($health.serviceFeatureVersion -as [int]); $needsRestart=(-not [bool]$health.supportsIndependentBrowserProfiles) -or ($version -lt $required) } catch { $ok=$false }; if ($ok -and -not $needsRestart) { exit 0 }; if ($ok -and $needsRestart) { exit 2 }; exit 1"
set "SERVICE_STATE=%ERRORLEVEL%"

if "%SERVICE_STATE%"=="2" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$connections=Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; foreach ($connection in $connections) { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800"
)

if not "%SERVICE_STATE%"=="0" (
  if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
  wscript.exe "%APP_DIR%run-service-hidden.vbs"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(20); $ok=$false; do { Start-Sleep -Milliseconds 500; try { $health=Invoke-RestMethod -Uri 'http://localhost:8787/api/health' -TimeoutSec 2; $ok=[bool]$health.ok } catch { $ok=$false } } until ($ok -or (Get-Date) -gt $deadline); if (-not $ok) { exit 1 }"
  if errorlevel 1 (
    echo Service did not become ready. Check logs\server.err.log.
    pause
    exit /b 1
  )
  %OPEN_APP%
) else (
  %OPEN_APP%
)

exit /b 0
