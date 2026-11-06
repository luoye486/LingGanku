@echo off
chcp 936 >nul
cd /d "%~dp0"
title 灵感盒

rem 依次尝试 Python 启动器 / python / py
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import sys" >nul 2>nul && set "PY=python"
)
if not defined PY (
  py -c "import sys" >nul 2>nul && set "PY=py"
)
if not defined PY (
  echo.
  echo   没有找到可用的 Python 3。
  echo   请到 https://www.python.org/downloads/ 安装，安装时勾选 "Add python.exe to PATH"。
  echo.
  pause
  exit /b 1
)

echo   灵感盒启动中……  关闭这个窗口即停止服务
echo.
%PY% "app\server.py" %*

echo.
echo   服务已停止。
pause
