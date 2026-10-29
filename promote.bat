@echo off
chcp 65001 >nul
set "WS=%~1"
if "%WS%"=="" (
  echo Usage: promote.bat ^<workspace-root^>
  echo   workspace-root = directory containing the draft and result folders
  pause >nul
  exit /b 1
)
node "%~dp0promote.mjs" "%WS%"
echo.
echo Done. Press any key to close.
pause >nul
