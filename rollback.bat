@echo off
chcp 65001 >nul
set "PROFILE=%DSH_PROFILE_DIR%"
if "%PROFILE%"=="" set "PROFILE=%USERPROFILE%\.dsh\profiles\desktop"
set "STATE=%DSH_STAGING_GUARD_DIR%"
if "%STATE%"=="" set "STATE=%USERPROFILE%\.dsh\staging-guard"
set "BACKUP=%STATE%\rollback"
if not exist "%BACKUP%\package.json.baseline" goto nobase
copy /Y "%BACKUP%\package.json.baseline" "%PROFILE%\package.json" >nul
if errorlevel 1 goto copyfail
echo OK: restored %PROFILE%\package.json
echo Now close and reopen DeepSeek Harness.
pause
exit /b 0
:nobase
echo ERROR: baseline not found: %BACKUP%\package.json.baseline
echo Nothing was changed.
pause
exit /b 1
:copyfail
echo ERROR: copy failed. File may be locked. Close DeepSeek Harness and retry.
pause
exit /b 1
