@echo off
setlocal
chcp 65001 >nul
title Antigravity Context 圆环 - 注入
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
echo [1/2] 正在注入 Context 圆环...
echo      会关闭 Antigravity 以解锁 app.asar。
echo.
"%NODE_BIN%" "%~dp0injector\install.js" %*
if errorlevel 1 (
  echo.
  echo [X] 注入失败，请查看上方错误。
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] 注入完成。重新打开 Antigravity 后，输入框麦克风左侧应出现细圆环。
echo.
echo 窗口将在 5 秒后关闭...
timeout /t 5
