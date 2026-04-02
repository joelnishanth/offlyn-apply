# Create a Windows installer executable that embeds the .bat script
# This allows users to download and run a single .exe instead of seeing raw script content

$batContent = Get-Content "scripts/native-host/install-win.bat" -Raw
$exeTemplate = @"
@echo off
:: Offlyn Windows Installer - Auto-extracted
:: This file contains the installation script and runs it automatically

:: Create temp file with the installation script
set TEMP_BAT=%TEMP%\offlyn-install-%RANDOM%.bat

:: Write the installation script to temp file
(
echo @echo off
$($batContent -replace '^', 'echo ')
) > "%TEMP_BAT%"

:: Run the installation script
call "%TEMP_BAT%"

:: Clean up
del "%TEMP_BAT%" 2>nul

exit /b %ERRORLEVEL%
"@

# Save as .bat file that can be converted to .exe
$exeTemplate | Out-File -FilePath "offlyn-windows-installer.bat" -Encoding ASCII

Write-Host "Windows installer created: offlyn-windows-installer.bat"
Write-Host "Users can download and run this file directly."