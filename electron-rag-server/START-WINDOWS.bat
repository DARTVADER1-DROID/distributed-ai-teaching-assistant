@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Electron RAG Server

echo.
echo ============================================
echo          Electron RAG Server
echo ============================================
echo.
echo [INFO] Starting the Windows setup workflow...
echo [INFO] This checks dependencies, downloads missing BGE-M3 files,
echo [INFO] verifies the model, runs the build and tests, then starts the server.
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 goto :missing_powershell

if not exist "%~dp0scripts\setup-and-run-windows.ps1" goto :missing_script

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-and-run-windows.ps1"
if errorlevel 1 goto :setup_failed

echo.
echo [INFO] Setup workflow finished.
goto :finish

:missing_powershell
echo [ERROR] Windows PowerShell was not found.
echo This launcher requires the built-in Windows PowerShell executable.
goto :failed

:missing_script
echo [ERROR] Setup script was not found:
echo "%~dp0scripts\setup-and-run-windows.ps1"
echo Restore the repository files and run this launcher again.
goto :failed

:setup_failed
echo.
echo [ERROR] The setup or server process failed.
echo Review the error messages above, fix the reported issue, and rerun.
goto :failed

:failed
echo.
echo ============================================
echo The launcher stopped because of an error.
echo ============================================

:finish
echo.
pause
endlocal
