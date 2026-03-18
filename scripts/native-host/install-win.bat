@echo off
:: Offlyn Helper Installer — Windows
:: Registers the native messaging host so the Offlyn extension can run Ollama
:: setup with a single button click (no terminal needed afterwards).
:: No administrator rights required.

setlocal EnableDelayedExpansion

set HOST_NAME=ai.offlyn.helper
set OFFLYN_DIR=%USERPROFILE%\.offlyn
set HOST_SCRIPT=%OFFLYN_DIR%\helper.ps1
set RAW_BASE=https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main/scripts/native-host
set CHROME_EXT_ID=bjllpojjllhfghiemokcoknfmhpmfbph
set FIREFOX_EXT_ID={e0857c2d-15a6-4d0c-935e-57761715dc3d}

echo.
echo   Installing Offlyn Helper...
echo.

:: Create directory
if not exist "%OFFLYN_DIR%" mkdir "%OFFLYN_DIR%"

:: Download the PowerShell host script
powershell -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri '%RAW_BASE%/host.ps1' -OutFile '%HOST_SCRIPT%' -UseBasicParsing"
if %errorlevel% neq 0 (
  echo ERROR: Failed to download helper script.
  echo Please check your internet connection and try again.
  pause
  exit /b 1
)

:: Write the manifest JSON
set MANIFEST_FILE=%OFFLYN_DIR%\%HOST_NAME%.json
(
  echo {
  echo   "name": "%HOST_NAME%",
  echo   "description": "Offlyn AI Setup Helper",
  echo   "path": "%HOST_SCRIPT%",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%CHROME_EXT_ID%/"],
  echo   "allowed_extensions": ["%FIREFOX_EXT_ID%"]
  echo }
) > "%MANIFEST_FILE%"

:: Register for Chrome (user-level, no admin required)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" ^
  /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>&1

:: Register for Firefox (user-level, no admin required)
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%" ^
  /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>&1

echo   Offlyn Helper installed!
echo.
echo   Return to the Offlyn extension and click
echo   the 'Set Up AI' button -- it will handle
echo   everything from here.
echo.
pause
