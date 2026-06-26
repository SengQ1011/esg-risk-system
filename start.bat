@echo off
echo ============================================
echo  ESG Risk System - Start
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:3000
echo ============================================
echo.

start "ESG Backend" cmd /k "call venv\Scripts\activate.bat && uvicorn api.main:app --port 8000"
timeout /t 2 /nobreak > nul
start "ESG Frontend" cmd /k "cd frontend-next && npm run dev"

echo Both windows launched.
echo Open http://localhost:3000 in your browser.
pause
