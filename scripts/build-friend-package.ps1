param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJsonPath = Join-Path $projectRoot "package.json"
$packageJson = Get-Content -Raw -Encoding UTF8 $packageJsonPath | ConvertFrom-Json
$productName = [string]$packageJson.build.productName
$version = [string]$packageJson.version
$serviceFeatureVersion = 5
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $projectRoot "dist"
}

$resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
if (-not $resolvedOutputRoot.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must be inside the project directory: $resolvedProjectRoot"
}

$packageName = "${productName}_friend_${timestamp}"
$packageDir = Join-Path $resolvedOutputRoot $packageName
$archivePath = "$packageDir.zip"
$workflowsSource = Join-Path $projectRoot "workflows"
$workflowsTarget = Join-Path $packageDir "app-data\workflows"
$builtArtifact = Join-Path $resolvedOutputRoot "${productName}-portable-${version}.exe"
$friendExecutable = Join-Path $packageDir "${productName}.exe"

if (Test-Path -LiteralPath $packageDir) {
  throw "Target directory already exists: $packageDir"
}
if (Test-Path -LiteralPath $archivePath) {
  throw "Target archive already exists: $archivePath"
}
if (-not (Test-Path -LiteralPath $workflowsSource)) {
  throw "Workflow directory was not found: $workflowsSource"
}

$guideSource = Get-ChildItem -LiteralPath $projectRoot -Filter "*.md" |
  Where-Object { $_.Name -ne "README.md" } |
  Select-Object -First 1
if (-not $guideSource) {
  throw "User guide was not found."
}
$startHereSource = Join-Path $projectRoot "packaging\START_HERE.txt"
if (-not (Test-Path -LiteralPath $startHereSource)) {
  throw "START_HERE source was not found: $startHereSource"
}

Push-Location $projectRoot
try {
  Write-Host "[1/5] Running automated tests..."
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) {
    throw "Automated tests failed. Packaging stopped."
  }

  Write-Host "[2/5] Building Windows x64 portable executable..."
  & npx.cmd electron-builder --win portable --x64
  if ($LASTEXITCODE -ne 0) {
    throw "Electron portable build failed."
  }
  if (-not (Test-Path -LiteralPath $builtArtifact)) {
    throw "Build artifact was not found: $builtArtifact"
  }

  Write-Host "[3/5] Assembling clean friend package..."
  New-Item -ItemType Directory -Path $workflowsTarget -Force | Out-Null
  Copy-Item -LiteralPath $builtArtifact -Destination $friendExecutable
  Copy-Item -Path (Join-Path $workflowsSource "*.json") -Destination $workflowsTarget
  Copy-Item -LiteralPath $guideSource.FullName -Destination (Join-Path $packageDir "USER_GUIDE.md")
  Copy-Item -LiteralPath $startHereSource -Destination (Join-Path $packageDir "START_HERE.txt")

  $workflowCount = @(Get-ChildItem -LiteralPath $workflowsTarget -Filter "*.json").Count
  $exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $friendExecutable).Hash
  @"
Product: $productName
App version: $version
Service feature version: $serviceFeatureVersion
Build time: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Bundled workflows: $workflowCount
System: Windows 10/11 x64
Account data included: No
Browser profiles included: No
Run history and cache included: No
Executable SHA256: $exeHash
"@ | Set-Content -LiteralPath (Join-Path $packageDir "VERSION_AND_SHA256.txt") -Encoding UTF8

  Write-Host "[4/5] Compressing friend package..."
  Compress-Archive -LiteralPath $packageDir -DestinationPath $archivePath -CompressionLevel Optimal
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
  "$archiveHash  $([System.IO.Path]::GetFileName($archivePath))" |
Set-Content -LiteralPath "$archivePath.sha256.txt" -Encoding UTF8

  Write-Host "[5/5] Done"
  Write-Host "Directory: $packageDir"
  Write-Host "Archive: $archivePath"
  Write-Host "SHA256: $archiveHash"
} finally {
  Pop-Location
}
