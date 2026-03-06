@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0microsip-event.ps1" end %*
endlocal
