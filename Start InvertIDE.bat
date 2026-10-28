@echo off
setlocal
cd /d "%~dp0"
title InvertIDE - Groq Cloud

echo.
echo ==========================================
echo    InvertIDE - Groq Cloud Setup
echo ==========================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 22.13 or newer, then run this file again.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
  echo ERROR: InvertIDE requires Node.js 22.13 or newer.
  echo Current version:
  node --version
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
  ) else (
    echo ERROR: .env and .env.example are both missing.
    pause
    exit /b 1
  )
)

findstr /R /C:"^GROQ_API_KEY=$" ".env" >nul
if not errorlevel 1 (
  echo Paste your Groq API key after GROQ_API_KEY= in .env.
  echo Save the file and close Notepad to continue.
  start /wait "" notepad.exe ".env"
)

findstr /R /C:"^GROQ_API_KEY=$" ".env" >nul
if not errorlevel 1 (
  echo.
  echo ERROR: GROQ_API_KEY is still empty in .env.
  echo Paste your Groq API key after GROQ_API_KEY= and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo Installing required packages. This may take a few minutes...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed. Check your internet connection and run this file again.
    pause
    exit /b 1
  )
)

echo Checking the AI provider files...
node --check server\ai\groqProvider.js
if errorlevel 1 (
  echo ERROR: server\ai\groqProvider.js has a syntax error.
  pause
  exit /b 1
)
node --check server\crossExamine.js
if errorlevel 1 (
  echo ERROR: server\crossExamine.js has a syntax error.
  pause
  exit /b 1
)

echo.
echo Starting InvertIDE at http://localhost:3000
echo Keep this window open while you use the app.
echo Press Ctrl+C in this window to stop the server.
echo.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
set ERR=%ERRORLEVEL%
echo.
echo InvertIDE stopped with exit code %ERR%.
pause
exit /b %ERR%
