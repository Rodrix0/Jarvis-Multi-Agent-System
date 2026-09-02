@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_jarvis.ps1" %*
if errorlevel 1 (
    echo.
    echo Jarvis no pudo iniciar. Revisa el error mostrado arriba.
    pause
)
endlocal
