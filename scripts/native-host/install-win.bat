@echo off
:: Offlyn Helper Installer — Windows
:: Registers the native messaging host so the Offlyn extension can run Ollama
:: setup with a single button click (no terminal needed afterwards).
:: No administrator rights required.

setlocal EnableDelayedExpansion

set HOST_NAME=ai.offlyn.helper
set OFFLYN_DIR=%USERPROFILE%\.offlyn
set HOST_PS1=%OFFLYN_DIR%\helper.ps1
set HOST_BAT=%OFFLYN_DIR%\helper.bat
set RAW_BASE=https://raw.githubusercontent.com/rahulraonatarajan/offlyn-apply/Windows-ollama-setup/scripts/native-host
set SETUP_BASE=https://raw.githubusercontent.com/rahulraonatarajan/offlyn-apply/Windows-ollama-setup/scripts/setup-ollama
set CHROME_EXT_ID=bjllpojjllhfghiemokcoknfmhpmfbph
set FIREFOX_EXT_ID={e0857c2d-15a6-4d0c-935e-57761715dc3d}

echo.
echo   Installing Offlyn Helper...
echo.

:: Create directory
if not exist "%OFFLYN_DIR%" mkdir "%OFFLYN_DIR%"

:: Download the PowerShell host script
powershell -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri '%RAW_BASE%/host.ps1' -OutFile '%HOST_PS1%' -UseBasicParsing"
if %errorlevel% neq 0 (
  echo ERROR: Failed to download helper script.
  echo Please check your internet connection and try again.
  pause
  exit /b 1
)

:: Download setup-win.ps1 locally so host.ps1 can run it without re-downloading
powershell -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri '%SETUP_BASE%/setup-win.ps1' -OutFile '%OFFLYN_DIR%\setup-win.ps1' -UseBasicParsing"

:: Create the .bat wrapper — Chrome/Firefox cannot launch .ps1 directly
(
  echo @echo off
  echo powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%%~dp0helper.ps1" %%*
) > "%HOST_BAT%"

:: Build a JSON-safe path (forward slashes avoid invalid JSON escape sequences)
set MANIFEST_PATH=%HOST_BAT:\=/%

:: Write the manifest JSON
set MANIFEST_FILE=%OFFLYN_DIR%\%HOST_NAME%.json
(
  echo {
  echo   "name": "%HOST_NAME%",
  echo   "description": "Offlyn AI Setup Helper",
  echo   "path": "%MANIFEST_PATH%",
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
