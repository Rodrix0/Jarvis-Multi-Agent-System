@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_jarvis.ps1"
if errorlevel 1 (
    echo.
    echo No se pudo apagar Jarvis por completo. Revisa el error mostrado arriba.
    pause
)
endlocal
