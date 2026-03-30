@echo off
:: Offlyn Apply - Windows All-in-One Installer
:: Installs everything Offlyn needs to run AI features locally:
::   - Offlyn Helper (lets the extension talk to your computer)
::   - Ollama (runs AI models privately on your device, ~1.6 GB download)
::   - llama3.2:1b AI chat model (~637 MB)
::   - nomic-embed-text embedding model (~274 MB)
:: No administrator rights required. Your data never leaves your computer.

setlocal EnableDelayedExpansion

set HOST_NAME=ai.offlyn.helper
set OFFLYN_DIR=%USERPROFILE%\.offlyn
set HOST_PS1=%OFFLYN_DIR%\helper.ps1
set HOST_EXE=%OFFLYN_DIR%\helper.exe
set RAW_BASE=https://raw.githubusercontent.com/rahulraonatarajan/offlyn-apply/Windows-ollama-setup/scripts/native-host
set SETUP_BASE=https://raw.githubusercontent.com/rahulraonatarajan/offlyn-apply/Windows-ollama-setup/scripts/setup-ollama
set CHROME_EXT_ID=bjllpojjllhfghiemokcoknfmhpmfbph
set CHROME_DEV_EXT_ID=nfflflctcndcpdmoclbcasiblbgjng
set FIREFOX_EXT_ID={e0857c2d-15a6-4d0c-935e-57761715dc3d}
set CHAT_MODEL=llama3.2:1b
set EMBED_MODEL=nomic-embed-text
set ORIGINS=chrome-extension://*,moz-extension://*
set MANIFEST_FILE=%OFFLYN_DIR%\%HOST_NAME%.json

echo.
echo  ============================================================
echo   Offlyn Apply - Windows Setup
echo  ============================================================
echo.
echo   This window will stay open while everything downloads
echo   and installs automatically. No clicks needed from you.
echo.
echo   Total download size: roughly 2.5 GB
echo     - Ollama AI runtime .......... ~1.6 GB  (one-time)
echo     - llama3.2:1b AI model ....... ~637 MB  (one-time)
echo     - nomic-embed-text model ..... ~274 MB  (one-time)
echo.
echo   Estimated time: 10-40 minutes depending on your internet.
echo   Feel free to use your computer while this runs.
echo  ============================================================
echo.

:: ---- Step 1: Create .offlyn directory ----------------------------------------
if not exist "%OFFLYN_DIR%" mkdir "%OFFLYN_DIR%"

:: ---- Step 2: Download helper.ps1 ---------------------------------------------
echo [1/5] Setting up Offlyn Helper (small download, takes ~10 seconds)...
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%RAW_BASE%/host.ps1' -OutFile '%HOST_PS1%' -UseBasicParsing"
if %errorlevel% neq 0 goto :download_error

:: ---- Step 3: Compile helper.exe ----------------------------------------------
:: Chrome uses CreateProcess and cannot launch .bat/.ps1 directly.
:: This small C# relay bridges Chrome stdin/stdout to helper.ps1.
echo [2/5] Building browser bridge (takes ~30 seconds)...
powershell -ExecutionPolicy Bypass -NoProfile -Command "$s='using System;using System.Diagnostics;using System.IO;using System.Reflection;using System.Threading.Tasks;class P{static int Main(){var d=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);var p1=Path.Combine(d,\"helper.ps1\");var i=new ProcessStartInfo{FileName=\"powershell.exe\",Arguments=\"-NoLogo -NoProfile -ExecutionPolicy Bypass -File \\\"\"+p1+\"\\\"\",UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true};using(var p=Process.Start(i)){var si=Console.OpenStandardInput();var so=Console.OpenStandardOutput();var t1=Task.Run(()=>{try{si.CopyTo(p.StandardInput.BaseStream);}catch{}try{p.StandardInput.Close();}catch{}});var t2=Task.Run(()=>{try{p.StandardOutput.BaseStream.CopyTo(so);so.Flush();}catch{}});Task.WaitAny(t1,t2);p.WaitForExit();return p.ExitCode;}}}'; Add-Type -TypeDefinition $s -OutputAssembly '%HOST_EXE%' -OutputType ConsoleApplication 2>&1"
if not exist "%HOST_EXE%" goto :compile_error
echo    helper.exe OK

:: ---- Step 4: Write manifest and register native messaging host ---------------
echo [3/5] Registering Offlyn with Chrome and Firefox...
powershell -ExecutionPolicy Bypass -Command "$m=[ordered]@{name='%HOST_NAME%';description='Offlyn AI Setup Helper';path='%HOST_EXE%';type='stdio';allowed_origins=@('chrome-extension://%CHROME_EXT_ID%/','chrome-extension://%CHROME_DEV_EXT_ID%/');allowed_extensions=@('%FIREFOX_EXT_ID%')}; $m | ConvertTo-Json | Set-Content '%MANIFEST_FILE%' -Encoding UTF8"
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>&1
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%"       /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>&1
echo    Registered OK

:: ---- Step 5: Install Ollama if needed ----------------------------------------
echo [4/5] Checking Ollama (the local AI engine)...
where ollama >nul 2>&1
if %errorlevel% equ 0 goto :ollama_already_installed

echo    Ollama not found.
echo.
echo    Downloading Ollama installer (~1.6 GB).
echo    This is the largest step -- please be patient.
echo    The progress bar above will show download speed.
echo    Do NOT close this window.
echo.
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest 'https://ollama.com/download/OllamaSetup.exe' -OutFile '%TEMP%\OllamaSetup.exe' -UseBasicParsing"
echo.
echo    Download complete! Installing now (takes about 1 minute)...
"%TEMP%\OllamaSetup.exe" /S
del "%TEMP%\OllamaSetup.exe" >nul 2>&1
:: Refresh PATH so ollama command is available in this session
powershell -ExecutionPolicy Bypass -Command "$p=[System.Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[System.Environment]::GetEnvironmentVariable('PATH','User'); [System.Environment]::SetEnvironmentVariable('PATH',$p,'Process')"
for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('PATH','Machine')+';'+[System.Environment]::GetEnvironmentVariable('PATH','User')"`) do set PATH=%%P
echo    Ollama installed successfully!
goto :configure_cors

:ollama_already_installed
echo    Ollama is already installed -- skipping download.

:: ---- Step 6: Configure CORS --------------------------------------------------
:configure_cors
powershell -ExecutionPolicy Bypass -Command "[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS','%ORIGINS%','User')"
set OLLAMA_ORIGINS=%ORIGINS%
echo    Extension access configured OK

:: ---- Step 7: Start Ollama and wait -------------------------------------------
echo [5/5] Starting Ollama and downloading AI models...
echo    (This step downloads ~911 MB total. Progress shown below.)
echo.
taskkill /IM ollama.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
start /B ollama serve

echo    Starting Ollama engine, please wait...
powershell -ExecutionPolicy Bypass -Command "for($i=0;$i-lt 30;$i++){try{$null=Invoke-WebRequest 'http://localhost:11434/api/version' -UseBasicParsing -TimeoutSec 2;exit 0}catch{Start-Sleep 1}};exit 1"
if %errorlevel% neq 0 goto :ollama_start_error
echo    Ollama engine is running!
echo.
echo    Downloading AI chat model: %CHAT_MODEL% (~637 MB)...
echo    (This is the model that fills out your job applications)
ollama pull %CHAT_MODEL%
echo.
echo    Downloading AI search model: %EMBED_MODEL% (~274 MB)...
echo    (This helps Offlyn understand your resume)
ollama pull %EMBED_MODEL%

:: ---- Done --------------------------------------------------------------------
echo.
echo  ============================================================
echo   All done! Offlyn AI is ready on your computer.
echo  ============================================================
echo.
echo   NEXT STEPS (takes 30 seconds):
echo.
echo   1. Fully close Chrome (File - Exit, or right-click the
echo      Chrome icon in your taskbar and choose "Exit").
echo.
echo   2. Reopen Chrome.
echo.
echo   3. Click the Offlyn extension icon and then
echo      click "Test Connection" -- it should say Connected!
echo.
echo   Your data stays 100%% on your computer. Nothing is uploaded.
echo  ============================================================
echo.
pause
exit /b 0

:download_error
echo.
echo  ============================================================
echo   ERROR: Could not download a required file.
echo.
echo   Please check your internet connection and try again.
echo   If the problem persists, visit: https://github.com/rahulraonatarajan/offlyn-apply
echo  ============================================================
pause & exit /b 1

:compile_error
echo.
echo  ============================================================
echo   ERROR: Could not build the browser bridge (helper.exe).
echo.
echo   Make sure you are running Windows 10 or later and try again.
echo  ============================================================
pause & exit /b 1

:ollama_start_error
echo.
echo  ============================================================
echo   ERROR: Ollama installed but did not start in time.
echo.
echo   Try restarting your computer and running this installer again.
echo   Or open a new Command Prompt window and type: ollama serve
echo  ============================================================
pause & exit /b 1
