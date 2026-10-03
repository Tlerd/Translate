param([ValidateSet('cuda', 'cpu')][string]$Backend = 'cuda')
$ErrorActionPreference = 'Stop'
$webRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = Join-Path $webRoot '.cache\nemotron'
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
$runtimeVersion = '0.2.0'
$archiveName = "nemo-speech-$runtimeVersion-windows-x86_64-$Backend.zip"
$archivePath = Join-Path $cacheRoot $archiveName
$releaseUrl = "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v$runtimeVersion/$archiveName"

function Download-CheckedFile([string]$Url, [string]$Destination, [string]$Sha256) {
  if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA-256 digest' }
  if ((Test-Path -LiteralPath $Destination) -and ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256)) { return }
  Write-Output ('Downloading ' + [IO.Path]::GetFileName($Destination))
  $partialPath = $Destination + '.partial'
  & curl.exe --fail --location --retry 3 --silent --show-error --output $partialPath $Url
  if ($LASTEXITCODE -ne 0) { throw 'Download failed' }
  if ((Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash -ne $Sha256) { throw 'Downloaded file checksum mismatch' }
  Move-Item -LiteralPath $partialPath -Destination $Destination -Force
}

$checksumPath = $archivePath + '.sha256'
& curl.exe --fail --location --retry 3 --silent --show-error --output $checksumPath ($releaseUrl + '.sha256')
if ($LASTEXITCODE -ne 0) { throw 'Cannot download runtime checksum' }
$runtimeHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0]
Download-CheckedFile $releaseUrl $archivePath $runtimeHash
$extractRoot = Join-Path $cacheRoot "runtime-$Backend"
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
$runtimeExe = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter 'nemo-speech.exe')[0].FullName
if (-not $runtimeExe) { throw 'Runtime executable not found' }
& $runtimeExe --json doctor
if ($LASTEXITCODE -ne 0) { throw 'NeMo runtime health check failed' }

# Pin the official NVIDIA Q8 model revision and LFS digest checked 2026-10-04.
$modelName = 'nemotron-3.5-asr-streaming-0.6b.q8_0.gguf'
$modelRevision = 'ea30d66debe3740a08b573244286791d423d6b3e'
$modelHash = '3fc991d3badad7277c11030a7519832cddaf2057aafed6d4b25147e953a070b1'
$modelPath = Join-Path $cacheRoot $modelName
Download-CheckedFile "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/$modelRevision/$modelName" $modelPath $modelHash
@{ executable = $runtimeExe; model = $modelPath; version = $runtimeVersion; backend = $Backend; modelRevision = $modelRevision; sha256 = $modelHash } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cacheRoot 'installation.json') -Encoding utf8

# Preserve existing provider/authentication configuration and never print keys.
$envPath = Join-Path $webRoot '.env.local'
$envText = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$newValues = @{
  NEMOTRON_BASE_URL = 'http://127.0.0.1:8080'
  NEMOTRON_WEBSOCKET_URL = 'ws://127.0.0.1:8081/speech'
  NEMOTRON_GATEWAY_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  NEMOTRON_API_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
}
foreach ($entry in $newValues.GetEnumerator()) {
  $pattern = '(?m)^' + [regex]::Escape($entry.Key) + '=([^\r\n]*)'
  $existing = [regex]::Match($envText, $pattern)
  if ($existing.Success -and $existing.Groups[1].Value.Trim()) { continue }
  $line = $entry.Key + '=' + $entry.Value
  if ($existing.Success) { $envText = [regex]::Replace($envText, $pattern, $line) }
  else { $envText = $envText.TrimEnd() + "`n" + $line + "`n" }
}
[IO.File]::WriteAllText($envPath, $envText, [Text.UTF8Encoding]::new($false))
Write-Output 'Nemotron setup complete. Run npm run speech:nemotron, then restart the Next.js dev server.'
