@echo off
chcp 65001 >nul
set "STATE=%DSH_STAGING_GUARD_DIR%"
if "%STATE%"=="" set "STATE=%USERPROFILE%\.dsh\staging-guard"
if not exist "%STATE%" mkdir "%STATE%"
> "%STATE%\disabled" echo disabled
if exist "%STATE%\disabled" (
  echo Kill switch ON. All writes are allowed now. No restart needed.
) else (
  echo ERROR: could not create the kill switch file.
)
pause
