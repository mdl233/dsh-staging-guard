@echo off
chcp 65001 >nul
set "STATE=%DSH_STAGING_GUARD_DIR%"
if "%STATE%"=="" set "STATE=%USERPROFILE%\.dsh\staging-guard"
del /Q "%STATE%\disabled" 2>nul
if exist "%STATE%\disabled" (
  echo ERROR: still exists, delete it manually.
) else (
  echo Kill switch OFF. Guard active again.
)
pause
