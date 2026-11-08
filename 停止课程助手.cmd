@echo off
chcp 65001 >nul
node "%~dp0scripts\stop.js"
if errorlevel 1 pause
