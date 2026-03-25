# ── Bidwright Dev Mode (Windows) ───────────────────────────────────
# Starts infrastructure (Postgres, Redis, Ollama) in Docker,
# then runs the apps natively with hot-reload — same as pnpm dev on Mac.
# Usage: .\dev.ps1
# Press Ctrl-C to stop.

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "    Bidwright - Dev Mode (Windows)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker is running
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check pnpm is available
pnpm --version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pnpm is not installed. Install it with: npm install -g pnpm" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install poppler-utils (pdftoppm) for PDF thumbnails if missing
where.exe pdftoppm 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host '(*) Installing poppler-utils for PDF thumbnails...' -ForegroundColor Yellow
    winget install --id oschwartz10612.Poppler --accept-source-agreements --accept-package-agreements 2>$null
    # Refresh PATH so pdftoppm is available in this session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# Create .env with dev defaults if it doesn't exist
if (!(Test-Path .env)) {
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host '(*) Created .env from .env.example (edit to add API keys)'
    } else {
        @"
DATABASE_URL=postgresql://bidwright:bidwright@localhost:5432/bidwright
REDIS_URL=redis://localhost:6379
DATA_DIR=./data/bidwright-api
DEFAULT_ORG_ID=org-bidwright-seed
API_PORT=4001
NEXT_PUBLIC_API_BASE_URL=http://localhost:4001
EMBEDDING_PROVIDER=local
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=snowflake-arctic-embed
EMBEDDING_DIMENSIONS=1024
"@ | Set-Content .env -Encoding UTF8
        Write-Host '(*) Created .env with dev defaults'
    }
}

# Install dependencies if needed
if (!(Test-Path "node_modules")) {
    Write-Host '(*) Installing dependencies...' -ForegroundColor Yellow
    pnpm install
}

# Set environment variables
$env:DATABASE_URL = "postgresql://bidwright:bidwright@localhost:5432/bidwright"
$env:REDIS_URL = "redis://localhost:6379"
$env:DATA_DIR = Join-Path $PSScriptRoot "data\bidwright-api"
$env:DEFAULT_ORG_ID = "org-bidwright-seed"
$env:API_PORT = "4001"
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:4001"
$env:EMBEDDING_PROVIDER = "local"
$env:EMBEDDING_BASE_URL = "http://localhost:11434/v1"
$env:EMBEDDING_MODEL = "snowflake-arctic-embed"
$env:EMBEDDING_DIMENSIONS = "1024"

# 1. Start infrastructure containers
Write-Host '(*) Starting Postgres + Redis + Ollama...' -ForegroundColor Yellow
docker compose up -d postgres redis ollama 2>$null

# 2. Wait for Postgres
Write-Host -NoNewline '(*) Waiting for Postgres'
do {
    Start-Sleep -Seconds 1
    Write-Host -NoNewline "."
    docker compose exec -T postgres pg_isready -U bidwright -d bidwright 2>$null | Out-Null
} while ($LASTEXITCODE -ne 0)
Write-Host " ready!" -ForegroundColor Green

# 3. Wait for Redis
Write-Host -NoNewline '(*) Waiting for Redis'
do {
    Start-Sleep -Seconds 1
    Write-Host -NoNewline "."
    docker compose exec -T redis redis-cli ping 2>$null | Out-Null
} while ($LASTEXITCODE -ne 0)
Write-Host " ready!" -ForegroundColor Green

# 4. Generate Prisma client + push schema
Write-Host '(*) Generating Prisma client...' -ForegroundColor Yellow
pnpm db:generate 2>$null | Out-Null

Write-Host '(*) Pushing schema to database...' -ForegroundColor Yellow
pnpm db:push -- --accept-data-loss --skip-generate 2>$null | Out-Null

# 5. Setup pgvector
Write-Host '(*) Setting up pgvector...' -ForegroundColor Yellow
docker compose exec -T postgres psql -U bidwright -d bidwright -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>$null | Out-Null

$vectorSql = @"
CREATE TABLE IF NOT EXISTS vector_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  embedding vector(1024) NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vector_records_hnsw ON vector_records USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_vector_records_org ON vector_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_project ON vector_records (project_id);
"@
docker compose exec -T postgres psql -U bidwright -d bidwright -c $vectorSql 2>$null | Out-Null

# 6. Pull embedding model if needed
Write-Host '(*) Checking embedding model...' -ForegroundColor Yellow
$models = docker compose exec -T ollama ollama list 2>$null
if ($models -notmatch "snowflake-arctic-embed") {
    Write-Host '(*) Pulling embedding model: snowflake-arctic-embed (first run only)...' -ForegroundColor Yellow
    docker compose exec -T ollama ollama pull snowflake-arctic-embed
}

Write-Host ""
Write-Host "(+) Bidwright Dev Mode:" -ForegroundColor Green
Write-Host "    API:    http://localhost:4001" -ForegroundColor White
Write-Host "    Web:    http://localhost:3000" -ForegroundColor White
Write-Host "    Worker: background" -ForegroundColor White
Write-Host ""
Write-Host "    Press Ctrl-C to stop." -ForegroundColor Gray
Write-Host ""

function Stop-DevProcesses {
    Write-Host ""
    Write-Host '(*) Stopping dev processes...' -ForegroundColor Yellow

    # Kill any node/tsx/next processes on our dev ports
    foreach ($port in @(3000, 4001)) {
        $connections = netstat -ano 2>$null | Select-String ":$port\s.*LISTENING"
        foreach ($conn in $connections) {
            $pid = ($conn -split '\s+')[-1]
            if ($pid -and $pid -ne "0") {
                Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # Also kill any lingering tsx/next-server processes from this project
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine -match "bidwright" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host '(*) Stopping infrastructure containers...' -ForegroundColor Yellow
    docker compose stop postgres redis ollama 2>$null | Out-Null
    Write-Host '(*) Stopped.' -ForegroundColor Green
}

# 7. Launch all services with hot-reload
try {
    pnpm dev:apps
} finally {
    Stop-DevProcesses
}
