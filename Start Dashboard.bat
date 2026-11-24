@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Follow the first-time setup in README.md to create the virtual environment.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" server.py %*
if errorlevel 1 pause
