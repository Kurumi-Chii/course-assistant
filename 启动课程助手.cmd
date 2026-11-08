@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\@playwright\mcp\cli.js" (
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  echo 首次启动：正在安装所需组件，请保持网络连接。
  call npm.cmd ci --cache "%~dp0npm-cache" --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
node "%~dp0scripts\launch.js"
if errorlevel 1 pause
