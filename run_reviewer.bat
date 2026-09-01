@echo off
setlocal
cd /d "%~dp0"
set "PAGE=%CD%\index.html"

where chrome.exe >nul 2>&1
if not errorlevel 1 (
  start "" chrome.exe "%PAGE%"
  exit /b 0
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit /b 0
)

if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit /b 0
)

if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%PAGE%"
  exit /b 0
)

echo Google Chrome could not be found.
echo Please install Chrome or update run_reviewer.bat with its chrome.exe path.
pause
endlocal
