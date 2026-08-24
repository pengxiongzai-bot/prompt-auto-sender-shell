@echo off
setlocal

set "APP_DIR=%~dp0"
set "LOG_DIR=%APP_DIR%logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%APP_DIR%"
npm start 1> "%LOG_DIR%\server.out.log" 2> "%LOG_DIR%\server.err.log"
