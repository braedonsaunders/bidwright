@echo off
:: Double-click this file to build and run everything in Docker.
:: Press Ctrl-C or close the window to stop all containers.

cd /d "%~dp0\..\.."

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

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [*] Created .env from .env.example (edit to add API keys)
    )
)

echo [*] Building all services (first run may take a few minutes)...
echo.
docker compose -f docker-compose.prod.yml build

echo.
echo [*] Starting all services...
echo.
echo     Press Ctrl-C to stop everything.
echo.

docker compose -f docker-compose.prod.yml up

echo.
echo [*] Stopping all Bidwright containers...
docker compose -f docker-compose.prod.yml down >nul 2>&1
echo [*] Stopped.
