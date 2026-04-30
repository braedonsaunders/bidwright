@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ======================================
echo        Bidwright - Starting Up
echo ======================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

set "PROJECT=bidwright-launcher"

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
    )
)

echo [*] Pulling latest images. First run downloads ~5GB and may take a while.
echo.
docker compose -p %PROJECT% pull
if errorlevel 1 (
    echo.
    echo ERROR: Failed to pull images. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo [*] Starting services...
echo.
docker compose -p %PROJECT% up -d
if errorlevel 1 (
    echo.
    echo ERROR: Failed to start services. See output above.
    pause
    exit /b 1
)

echo.
echo [*] Waiting for the web app to come up...
set /a TRIES=0
:wait_loop
set /a TRIES+=1
curl -sf http://localhost:3000 >nul 2>&1
if not errorlevel 1 goto :ready
if !TRIES! geq 120 goto :timeout
timeout /t 2 /nobreak >nul
goto :wait_loop

:timeout
echo.
echo WARNING: The web app did not respond after 4 minutes. It may still be starting.
echo Run "docker compose -p %PROJECT% logs -f web" to watch progress.
goto :end

:ready
echo.
echo ======================================
echo         Bidwright is running
echo.
echo   Web:  http://localhost:3000
echo   API:  http://localhost:3001
echo.
echo   Add your AI provider key in Settings
echo   the first time you log in.
echo ======================================
echo.
start http://localhost:3000

:end
echo.
echo To stop:    double-click stop.bat
echo To update:  double-click update.bat
echo.
pause
