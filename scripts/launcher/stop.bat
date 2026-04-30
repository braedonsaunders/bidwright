@echo off
cd /d "%~dp0"

set "PROJECT=bidwright-launcher"

echo [*] Stopping Bidwright...
docker compose -p %PROJECT% down
echo.
echo [*] Stopped. Your data is preserved in Docker volumes.
echo.
pause
