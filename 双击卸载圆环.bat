@echo off
setlocal
chcp 65001 >nul
title Antigravity Context 圆环 - 卸载
cd /d "%~dp0"

set "NODE_BIN="
where node >nul 2>nul && set "NODE_BIN=node"
if not defined NODE_BIN if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN (
  echo.
  echo [X] 未找到 Node.js。请安装 LTS: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo [1/2] 正在移除 Context 圆环...
echo      会关闭 Antigravity 以解锁 app.asar。汉化包不会被清掉。
echo.
"%NODE_BIN%" "%~dp0injector\install.js" --uninstall %*
if errorlevel 1 (
  echo.
  echo [X] 卸载失败，请查看上方错误。
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] 已移除圆环。重新打开 Antigravity 即可。
echo.
echo 窗口将在 5 秒后关闭...
timeout /t 5
