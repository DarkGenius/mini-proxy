# Удобный тестовый скрипт для PowerShell

param(
    [string]$ApiKey = $env:AGENT_ROUTER_TOKEN,
    [string]$Model = $env:OPENAI_MODEL
)

if (-not $ApiKey) {
    $ApiKey = Read-Host "Введите AGENT_ROUTER_TOKEN"
}

if (-not $Model) {
    $Model = "gpt-5"
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Тест прокси-сервера" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "API Key: $($ApiKey.Substring(0, [Math]::Min(20, $ApiKey.Length)))..." -ForegroundColor Gray
Write-Host "Model: $Model" -ForegroundColor Gray
Write-Host ""

$env:AGENT_ROUTER_TOKEN = $ApiKey
$env:OPENAI_MODEL = $Model

# Проверяем наличие Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "✅ Node.js найден - запускаем тест" -ForegroundColor Green
    Write-Host ""
    node test-client.mjs
} else {
    Write-Host "❌ Node.js не найден" -ForegroundColor Red
    Write-Host "Установите Node.js: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

