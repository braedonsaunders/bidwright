# Bidwright launcher installer — Windows.
#
# Downloads the launcher files (compose.yml + start/stop/update scripts)
# into a folder, then starts the stack. Re-run any time to refresh the
# launcher files (image updates use update.bat instead).
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher/install.ps1 | iex
#
# Override the install dir:
#   $env:BIDWRIGHT_DIR = 'C:\path\you\want'; iwr ... | iex

$ErrorActionPreference = 'Stop'

$installDir = if ($env:BIDWRIGHT_DIR) { $env:BIDWRIGHT_DIR } else { Join-Path $HOME 'bidwright' }
$base = 'https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher'
$files = @(
  'docker-compose.yml',
  '.env.example',
  'start.bat',
  'stop.bat',
  'update.bat',
  'README.md'
)

Write-Host ''
Write-Host '======================================'
Write-Host '   Bidwright launcher installer'
Write-Host '======================================'
Write-Host ''
Write-Host "Install location: $installDir"
Write-Host ''

# Verify Docker Desktop is installed (engine doesn't have to be running yet)
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
  Write-Host 'ERROR: Docker is not installed.' -ForegroundColor Red
  Write-Host 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/'
  Write-Host 'then re-run this installer.'
  exit 1
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null

foreach ($f in $files) {
  Write-Host "  downloading $f"
  Invoke-WebRequest -Uri "$base/$f" -OutFile (Join-Path $installDir $f) -UseBasicParsing
}

Write-Host ''
Write-Host "Launcher files installed to: $installDir" -ForegroundColor Green
Write-Host ''
Write-Host 'Starting Bidwright (first run downloads ~5 GB of images)...'
Write-Host ''

Start-Process -FilePath (Join-Path $installDir 'start.bat') -WorkingDirectory $installDir
