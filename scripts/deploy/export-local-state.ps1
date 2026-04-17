param(
    [string]$OutputRoot = "backups"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputDir = Join-Path $repoRoot $OutputRoot
$exportDir = Join-Path $outputDir $timestamp
$dbDumpPath = Join-Path $exportDir "bidwright-db.dump"
$dataArchivePath = Join-Path $exportDir "bidwright-data.tgz"
$manifestPath = Join-Path $exportDir "manifest.json"

New-Item -ItemType Directory -Force -Path $exportDir | Out-Null

Write-Host "==> Checking local Postgres container"
docker compose -f (Join-Path $repoRoot "docker-compose.yml") exec -T postgres pg_isready -U bidwright -d bidwright | Out-Null

Write-Host "==> Exporting database to $dbDumpPath"
$dumpCommand = "docker compose -f `"$repoRoot\docker-compose.yml`" exec -T postgres pg_dump -U bidwright -d bidwright --format=custom --no-owner --no-privileges > `"$dbDumpPath`""
powershell -NoProfile -Command $dumpCommand

Write-Host "==> Archiving app files to $dataArchivePath"
$dataSource = Join-Path $repoRoot "data\bidwright-api"
if (-not (Test-Path $dataSource)) {
    throw "Data directory not found: $dataSource"
}
tar.exe -czf $dataArchivePath -C $dataSource .

$dbDumpSize = (Get-Item $dbDumpPath).Length
$dataArchiveSize = (Get-Item $dataArchivePath).Length
$manifest = [pscustomobject]@{
    createdAt = (Get-Date).ToString("o")
    repoRoot = $repoRoot.Path
    dbDump = @{
        path = $dbDumpPath
        bytes = $dbDumpSize
    }
    dataArchive = @{
        path = $dataArchivePath
        bytes = $dataArchiveSize
    }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "Export complete:"
Write-Host "  DB dump:      $dbDumpPath"
Write-Host "  Data archive: $dataArchivePath"
Write-Host "  Manifest:     $manifestPath"
