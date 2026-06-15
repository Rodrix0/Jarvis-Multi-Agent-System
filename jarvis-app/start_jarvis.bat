@echo off
echo ==============================================
echo        INICIANDO JARVIS OS (All-in-One)
echo ==============================================

echo [1] Iniciando Motor de Inteligencia Artificial (Python - Uvicorn)...
start "Jarvis Python Engine" cmd /k "cd python_engine && call venv\Scripts\activate.bat && uvicorn main:app --reload --host 0.0.0.0 --port 8000"

echo [2] Iniciando Servidor Node.js y Frontend...
start "Jarvis Node Server" cmd /k "cd backend && npm run dev"

echo.
echo Jarvis ha sido iniciado en dos ventanas nuevas.
echo Puedes minimizar esta ventana principal.
pause
