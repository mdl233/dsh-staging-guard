@echo off
chcp 65001 >nul
set "STATE=%DSH_STAGING_GUARD_DIR%"
if "%STATE%"=="" set "STATE=%USERPROFILE%\.dsh\staging-guard"
del /Q "%STATE%\throw-now" 2>nul
echo Cleared the throw flag (if it existed).
echo Start DeepSeek Harness normally.
pause
