@echo off
setlocal enabledelayedexpansion
title Ligma

:: ============================================================
:: Ligma - Start Script (Windows)
:: ============================================================

:: Set PATH for Node.js and pnpm
set "PATH=C:\Program Files\nodejs;C:\Users\justs\AppData\Roaming\npm;%PATH%"

:: Change to the app directory
cd /d "%~dp0"

:: --- Pre-flight check: Is port 3000 already in use? ---
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo.
    echo [Ligma] Port 3000 is already in use ^(PID %%a^).
    echo   To stop it:  stop-mission-control.bat
    echo   To use it:   http://localhost:3000
    echo.
    exit /b 1
)

:: --- Open browser once server is ready (polls port 3000, up to 60s) ---
start "" /b powershell -WindowStyle Hidden -Command ^
  "$timeout = 60; $elapsed = 0; while ($elapsed -lt $timeout) { Start-Sleep -Seconds 2; $elapsed += 2; try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 3000); $tcp.Close(); Start-Process 'http://localhost:3000'; break } catch {} }"

:: --- Mark as running ---
echo running > .mc.pid

:: --- Start dev server (blocks here until Ctrl+C) ---
echo.
echo [Ligma] Starting dev server...
echo   URL:  http://localhost:3000
echo   Stop: Press Ctrl+C in this window, or run stop-mission-control.bat
echo.

node node_modules\next\dist\bin\next dev

:: --- Cleanup after server exits ---
if exist .mc.pid del .mc.pid
echo.
echo [Ligma] Server stopped.
