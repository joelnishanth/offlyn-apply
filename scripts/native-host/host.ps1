# Offlyn Native Messaging Host — Windows
# Communicates with the Offlyn browser extension via stdin/stdout using the
# 4-byte length-prefixed JSON protocol required by Chrome and Firefox.
#
# Commands:
#   { "cmd": "ping" }       -> { "ok": true, "version": "1.0.0" }
#   { "cmd": "run_setup" }  -> { "type": "done", "ok": true/false, "output": "..." }

$VERSION = "1.0.0"
$SCRIPT_BASE = "https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main/scripts/setup-ollama"

function Read-NativeMessage {
    $stdin = [Console]::OpenStandardInput()
    $lenBytes = New-Object byte[] 4
    $bytesRead = $stdin.Read($lenBytes, 0, 4)
    if ($bytesRead -lt 4) { return $null }

    $length = [BitConverter]::ToInt32($lenBytes, 0)
    $msgBytes = New-Object byte[] $length
    $null = $stdin.Read($msgBytes, 0, $length)
    return [System.Text.Encoding]::UTF8.GetString($msgBytes) | ConvertFrom-Json
}

function Send-NativeMessage($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $lenBytes = [BitConverter]::GetBytes([int]$bytes.Length)
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($lenBytes, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Invoke-Setup {
    $url = "$SCRIPT_BASE/setup-win.ps1"
    $logFile = "$env:TEMP\offlyn-setup-$(Get-Date -Format 'yyyyMMddHHmmss').log"

    try {
        $process = Start-Process powershell.exe `
            -ArgumentList "-ExecutionPolicy", "Bypass", "-Command", "irm '$url' | iex" `
            -Wait -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

        $output = if (Test-Path $logFile) { Get-Content $logFile -Raw } else { "" }
        Remove-Item $logFile -Force -ErrorAction SilentlyContinue

        Send-NativeMessage @{ type = "done"; ok = ($process.ExitCode -eq 0); output = $output }
    } catch {
        Send-NativeMessage @{ type = "done"; ok = $false; error = $_.Exception.Message }
    }
}

# Main loop
while ($true) {
    $msg = Read-NativeMessage
    if ($null -eq $msg) { break }

    switch ($msg.cmd) {
        "ping" {
            Send-NativeMessage @{ ok = $true; version = $VERSION }
        }
        "run_setup" {
            Invoke-Setup
        }
        default {
            Send-NativeMessage @{ ok = $false; error = "Unknown command: $($msg.cmd)" }
        }
    }
}
