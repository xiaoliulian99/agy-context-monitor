@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "LOG=%~dp0inject.log"

set "NODE_BIN="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_BIN=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_BIN (
  for /f "delims=" %%I in ('where node 2^>nul') do (
    set "NODE_BIN=%%I"
    goto :have_node
  )
)
:have_node

if not defined NODE_BIN (
  echo [X] Node.js not found. Install LTS: https://nodejs.org/
  echo [%DATE% %TIME%] Node.js not found>>"%LOG%"
  pause
  exit /b 1
)

echo.
echo Removing context ring. Antigravity will be closed.
echo Log: "%LOG%"
echo.
echo ==== %DATE% %TIME% uninstall ====>>"%LOG%"
"%NODE_BIN%" "%~dp0injector\install.js" --uninstall %* >>"%LOG%" 2>&1
set "ERR=%ERRORLEVEL%"
type "%LOG%"
if not "%ERR%"=="0" (
  echo.
  echo [X] Uninstall failed. See inject.log
  pause
  exit /b 1
)

echo.
echo [OK] Ring removed. Localization was left intact.
echo.
pause
