@echo off
setlocal

set "APP_DIR=%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

cd /d "%APP_DIR%"
npm run desktop

exit /b %errorlevel%
