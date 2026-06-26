@echo off
echo ============================================
echo  ESG Risk System - Setup
echo ============================================
echo.

python --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ first.
    pause
    exit /b 1
)

node --version > nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install Node.js 18+ first.
    pause
    exit /b 1
)

echo [1/6] Creating Python virtual environment...
if not exist venv (
    python -m venv venv
) else (
    echo       venv already exists, skipping.
)

call venv\Scripts\activate.bat

echo [2/6] Installing Python packages...
pip install -r requirements.txt -q
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo [3/6] Setting up .env...
if not exist .env (
    if exist .env.example (
        copy .env.example .env > nul
        echo       .env created from .env.example
    )
) else (
    echo       .env already exists, skipping.
)

echo [4/6] Downloading PDF reports (~50MB, may take a few minutes)...
python -X utf8 scripts/download_reports.py
if errorlevel 1 (
    echo WARNING: PDF download failed. PDF preview will not work.
)

echo [5/6] Building SQLite database from cache...
python -X utf8 scripts/preprocess_cache.py
if errorlevel 1 (
    echo ERROR: preprocess_cache.py failed.
    pause
    exit /b 1
)

echo [6/6] Installing frontend packages...
cd frontend-next
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    cd ..
    pause
    exit /b 1
)

echo       Copying PDF CMap fonts...
if exist node_modules\pdfjs-dist\cmaps (
    if not exist public\cmaps mkdir public\cmaps
    xcopy /E /I /Y node_modules\pdfjs-dist\cmaps public\cmaps > nul
    echo       CMap copy done.
) else (
    echo WARNING: pdfjs-dist/cmaps not found, Chinese PDF fonts may not render.
)

cd ..

echo.
echo ============================================
echo  Setup complete! Run start.bat to launch.
echo ============================================
pause
