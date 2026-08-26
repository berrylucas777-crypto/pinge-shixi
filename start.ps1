$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
  python -m venv .venv
}

& .\.venv\Scripts\python -m pip install -r requirements.txt
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

Write-Host "拼个实习已启动：http://127.0.0.1:8000"
& .\.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
