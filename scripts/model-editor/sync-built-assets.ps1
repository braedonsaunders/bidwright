$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$source = Join-Path $repoRoot "apps\model-editor\dist"
$target = Join-Path $repoRoot "apps\web\public\model-editor"

if (-not (Test-Path $source)) {
  throw "BidWright model editor dist folder not found. Run npm --prefix apps/model-editor run build first."
}

New-Item -ItemType Directory -Force $target | Out-Null
robocopy $source $target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

if ($LASTEXITCODE -gt 7) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host "Synced BidWright model editor assets to apps\web\public\model-editor"
