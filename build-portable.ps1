param(
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '交付'),
  [string]$PackageName = "星幕工坊可移植开发项目-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
if ([string]::IsNullOrWhiteSpace($PackageName) -or $PackageName -match '[\\/:*?"<>|]') {
  throw 'PackageName must be a single valid directory name.'
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $OutputDirectory).Path).TrimEnd('\', '/')
if ($output.Equals($source, [System.StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($source + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be outside the source project.'
}

$folder = Join-Path $output $PackageName
$zip = Join-Path $output "$PackageName.zip"
if ((Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $zip)) {
  throw "Output already exists: $folder or $zip"
}

$files = @(
  '.gitignore', 'LICENSE', 'README.md', 'START_HERE.md', 'THIRD_PARTY.md',
  'package.json', 'index.html', 'server.mjs', 'local-api.mjs',
  'public-gateway.mjs', 'local-data.example.json', 'offline-assets-manifest.json',
  'logo.png', 'titleIcon.svg', 'Sparkles.svg', 'score.svg', 'canvas-bg.webp',
  'start-local.cmd', 'build-portable.ps1'
)
$directories = @('branding', 'ai_comic', 'resourceBucket', 'plaza-assets')
foreach ($name in $files + $directories) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $name))) {
    throw "Required package input is missing: $name"
  }
}

New-Item -ItemType Directory -Path $folder | Out-Null
foreach ($name in $files) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $folder $name)
}
foreach ($name in $directories) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $folder $name) -Recurse
}

$manifest = foreach ($file in (Get-ChildItem -LiteralPath $folder -Recurse -File | Sort-Object FullName)) {
  $relative = $file.FullName.Substring($folder.Length + 1).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
[System.IO.File]::WriteAllLines((Join-Path $folder 'SHA256SUMS.txt'), [string[]]$manifest,
  [System.Text.UTF8Encoding]::new($false))
Compress-Archive -LiteralPath $folder -DestinationPath $zip -CompressionLevel Optimal

$bytes = (Get-Item -LiteralPath $zip).Length
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "FOLDER=$folder"
Write-Output "ZIP=$zip"
Write-Output "FILES=$($manifest.Count + 1)"
Write-Output "BYTES=$bytes"
Write-Output "SHA256=$zipHash"
