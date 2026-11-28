@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Electron RAG Server

echo.
echo ============================================
echo          Electron RAG Server
echo ============================================
echo.

REM Verify that Node.js and npm are available.
where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_npm

echo [INFO] Node.js:
node --version
echo [INFO] npm:
call npm --version
echo.

REM Use the committed lockfile for reproducible installs.
REM Keep npm output visible and write verbose diagnostics to npm-install.log.
if exist "package-lock.json" goto :install_ci

echo [INFO] No package-lock.json found. Running npm install.
call npm install --loglevel verbose --logfile "%~dp0npm-install.log"
if errorlevel 1 goto :install_failed
goto :verify_install

:install_ci
echo [INFO] package-lock.json found. Running npm ci.
call npm ci --loglevel verbose --logfile "%~dp0npm-install.log"
if errorlevel 1 goto :install_failed

:verify_install
if not exist "node_modules" (
    echo [ERROR] npm completed, but node_modules was not created.
    goto :failed
)

echo.
echo [INFO] Running TypeScript build and complete test suite...
call npm run build
if errorlevel 1 goto :build_failed

echo.
echo [INFO] Build and tests passed. Starting the RAG server...
echo [INFO] Keep this window open while the server is running.
echo [INFO] Swagger UI: http://localhost:3000/docs
echo [INFO] Press Ctrl+C to stop the server.
echo.
call npm start
if errorlevel 1 goto :runtime_failed

echo.
echo [INFO] Server process has stopped.
goto :finish

:missing_node
echo [ERROR] Node.js was not found on PATH.
echo Install a supported Node.js version (22.13.x or 24.0.0+), then reopen this launcher.
goto :failed

:missing_npm
echo [ERROR] npm was not found on PATH.
echo Repair or reinstall Node.js with npm, then reopen this launcher.
goto :failed

:install_failed
echo.
echo [ERROR] Dependency installation failed.
echo Review the output above and the log at:
echo "%~dp0npm-install.log"
goto :failed

:build_failed
echo.
echo [ERROR] Build or test suite failed. The server was not started.
goto :failed

:runtime_failed
echo.
echo [ERROR] The server process exited with an error.
goto :failed

:failed
echo.
echo ============================================
echo The launcher stopped because of an error.
echo Resolve the issue above, then run it again.
echo ============================================

:finish
echo.
pause
endlocal
