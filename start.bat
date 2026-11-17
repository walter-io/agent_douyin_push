@echo off
rem 抖音粉丝群消息推送工具 · 启动脚本
cd /d %~dp0
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5220/"
node server.js
