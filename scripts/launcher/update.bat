@echo off
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop and try again.
    pause
    exit /b 1
)

set "PROJECT=bidwright-launcher"

echo [*] Pulling latest images...
docker compose -p %PROJECT% pull
if errorlevel 1 (
    echo ERROR: Failed to pull images.
    pause
    exit /b 1
)

echo.
echo [*] Restarting services with the new images...
docker compose -p %PROJECT% up -d
echo.
echo [*] Update complete. Open http://localhost:3000
echo.
pause
