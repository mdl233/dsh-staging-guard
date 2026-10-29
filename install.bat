@echo off
chcp 65001 >nul
node "%~dp0install.mjs"
if errorlevel 1 goto fail
echo.
echo Installed. If the host did not hot-reload, restart DeepSeek Harness.
pause
exit /b 0
:fail
echo.
echo Install did not finish cleanly. Run rollback.bat to restore.
pause
exit /b 1
