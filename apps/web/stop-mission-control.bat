@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Ligma - Stop Script (Windows)
:: ============================================================

:: Change to the app directory
cd /d "%~dp0"

echo.
echo [Ligma] Stopping server on port 3000...

:: --- Find and kill all processes on port 3000 with tree-kill ---
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    set "FOUND=1"
    echo   Killing process tree for PID %%a...
    taskkill /f /pid %%a /t >nul 2>&1
)

:: --- Also kill any stray node processes running next dev ---
for /f "tokens=2 delims==" %%a in ('wmic process where "CommandLine like '%%next%%dev%%' and Name='node.exe'" get ProcessId /format:list 2^>nul ^| findstr "="') do (
    echo   Killing orphaned next-dev node process PID %%a...
    taskkill /f /pid %%a /t >nul 2>&1
    set "FOUND=1"
)

:: --- Clean up PID sentinel file ---
if exist .mc.pid del .mc.pid

if "!FOUND!"=="0" (
    echo   No process found on port 3000.
    echo.
    echo [Ligma] Nothing to stop.
    echo.
    exit /b 0
)

:: --- Verify port is free (wait up to 3 seconds) ---
set "RETRIES=0"
:check_port
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    if !RETRIES! lss 3 (
        set /a RETRIES+=1
        timeout /t 1 /nobreak >nul
        goto check_port
    ) else (
        echo.
        echo   WARNING: Port 3000 is still in use after 3 seconds.
        echo   You may need to kill processes manually via Task Manager.
        echo.
        exit /b 1
    )
)

echo.
echo [Ligma] Server stopped. Port 3000 is free.
echo.
