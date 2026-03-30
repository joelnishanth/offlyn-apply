# Offlyn AI Setup — Windows
# Installs Ollama, pulls required models, configures CORS permanently.
# Runs without user interaction after launch.
$ErrorActionPreference = "Stop"
$ORIGINS = "chrome-extension://*,moz-extension://*"

Write-Host ""
Write-Host "  Offlyn AI Setup — Windows"
Write-Host "  -----------------------------------------"
Write-Host ""

# ── Step 1: Install Ollama if needed ──────────────────────────────────────
if (-not (Get-Command "ollama" -ErrorAction SilentlyContinue)) {
    Write-Host "-> Downloading Ollama installer..."
    $installer = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest "https://ollama.com/download/OllamaSetup.exe" -OutFile $installer -UseBasicParsing

    Write-Host "-> Installing Ollama (silent)..."
    Start-Process -FilePath $installer -ArgumentList "/S" -Wait -NoNewWindow
    Remove-Item $installer -Force -ErrorAction SilentlyContinue

    # Refresh PATH so ollama is available in this session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")

    Write-Host "OK Ollama installed"
} else {
    Write-Host "OK Ollama already installed"
}

# ── Step 2: Configure CORS permanently (user-level, no admin) ─────────────
Write-Host "-> Configuring browser extension access (CORS)..."

[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", $ORIGINS, "User")
$env:OLLAMA_ORIGINS = $ORIGINS
Write-Host "OK CORS configured (persists across reboots)"

# ── Step 3: Start / restart Ollama ────────────────────────────────────────
Write-Host "-> Starting Ollama..."
Stop-Process -Name "ollama" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden

Write-Host "-> Waiting for Ollama to be ready (up to 30s)..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $null = Invoke-WebRequest "http://localhost:11434/api/version" -UseBasicParsing -TimeoutSec 2
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}

if (-not $ready) {
    Write-Host "ERROR: Ollama did not start in time. Please start it manually and re-run this script."
    exit 1
}
Write-Host "OK Ollama is running"

# ── Step 4: Pull models ────────────────────────────────────────────────────
$modelList = & ollama list 2>&1

if ($modelList -notmatch "llama3\.2:1b") {
    Write-Host "-> Downloading llama3.2:1b (~637 MB)..."
    & ollama pull llama3.2:1b
} else {
    Write-Host "OK llama3.2:1b already downloaded"
}

if ($modelList -notmatch "nomic-embed-text") {
    Write-Host "-> Downloading nomic-embed-text (~274 MB)..."
    & ollama pull nomic-embed-text
} else {
    Write-Host "OK nomic-embed-text already downloaded"
}

# ── Done ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  OK Setup complete!"
Write-Host "  -----------------------------------------"
Write-Host "  Return to the Offlyn extension and click"
Write-Host "  'Test Connection' to verify."
Write-Host "  -----------------------------------------"
Write-Host ""
