# Simulate exactly what the Chrome extension background worker sends
$origin = "chrome-extension://hfflflctcndcpdmoclbcasiblbgjng"

# Test 1: CORS preflight (OPTIONS)
Write-Host "=== CORS Preflight OPTIONS ==="
try {
    $preflight = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/generate" -Method OPTIONS -Headers @{
        "Origin" = $origin
        "Access-Control-Request-Method" = "POST"
        "Access-Control-Request-Headers" = "content-type"
    } -UseBasicParsing
    Write-Host "Status: $($preflight.StatusCode)"
    Write-Host "ACAO: $($preflight.Headers['Access-Control-Allow-Origin'])"
    Write-Host "ACAM: $($preflight.Headers['Access-Control-Allow-Methods'])"
} catch {
    Write-Host "Preflight FAILED: $($_.Exception.Message)"
}

# Test 2: Actual POST (as extension would send)
Write-Host ""
Write-Host "=== POST /api/generate ==="
$body = '{"model":"llama3.2:1b","system":"You are helpful.","prompt":"Say: WORKS","stream":false,"options":{"temperature":0.1,"num_predict":20}}'
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/generate" -Method POST -ContentType "application/json" -Headers @{"Origin"=$origin} -Body $body -UseBasicParsing
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "ACAO: $($r.Headers['Access-Control-Allow-Origin'])"
    $content = $r.Content | ConvertFrom-Json
    Write-Host "Response: $($content.response)"
} catch {
    Write-Host "POST FAILED: $($_.Exception.Message)"
}
