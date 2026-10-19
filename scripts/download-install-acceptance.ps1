$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'shuangyan123/demo') { throw 'Hosted Windows runner only' }
$policy = Get-Content -Raw (Join-Path $PSScriptRoot 'nsis-install-acceptance.json') | ConvertFrom-Json
$root = Join-Path $env:RUNNER_TEMP 'recall-install-acceptance'
if (Test-Path -LiteralPath $root) { throw 'Acceptance directory already exists' }
New-Item -ItemType Directory -Path (Join-Path $root 'evidence') | Out-Null
$headers = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
$api = "https://api.github.com/repos/$($policy.repository)"
function Read-Api($suffix) { Invoke-RestMethod -Headers $headers -Uri "$api/$suffix" -TimeoutSec 30 }
function Save-Artifact($uri, $destination, $expected, $mediaType = 'application/vnd.github+json') {
  $binaryHeaders = $headers.Clone()
  $binaryHeaders.Accept = $mediaType
  Invoke-WebRequest -Headers $binaryHeaders -Uri $uri -OutFile $destination -TimeoutSec 120
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "SHA256 mismatch: $destination" }
}
try {
  $run = Read-Api "actions/runs/$($policy.runId)"
  $artifact = Read-Api "actions/artifacts/$($policy.artifactId)"
  if ($run.head_sha -ne $policy.sourceCommit -or $run.conclusion -ne 'success' -or $artifact.expired -or $artifact.workflow_run.id -ne $policy.runId -or $artifact.workflow_run.head_sha -ne $policy.sourceCommit -or $artifact.digest -ne "sha256:$($policy.artifactDigest)") { throw 'Fixed artifact provenance mismatch' }
  $zip = Join-Path $root 'fixed.zip'
  Save-Artifact "$api/actions/artifacts/$($policy.artifactId)/zip" $zip $policy.artifactDigest
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $entries = @($archive.Entries.FullName | Sort-Object)
    if (($entries -join ',') -ne ((@($policy.installer, 'SHA256SUMS.txt') | Sort-Object) -join ',')) { throw 'Unexpected archive entries' }
  } finally { $archive.Dispose() }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $root 'artifact')
  $setup = Join-Path $root "artifact/$($policy.installer)"
  if ((Get-FileHash -LiteralPath $setup).Hash.ToLowerInvariant() -ne $policy.installerSha256) { throw 'Fixed installer digest mismatch' }
  if ((Get-Content -Raw (Join-Path $root 'artifact/SHA256SUMS.txt')).Trim() -ne "$($policy.installerSha256)  $($policy.installer)") { throw 'Fixed manifest mismatch' }
  $upgrade = @{ status = 'NOT_RUN'; reason = 'No verified previous artifact'; trusted = $false }
  # 旧版只从同仓库固定 release asset 下载；不能取得/核验时只运行新装。
  try {
    $release = Read-Api "releases/tags/$($policy.previous.tag)"
    $old = @($release.assets | Where-Object id -EQ $policy.previous.assetId)
    $tagRef = Read-Api "git/ref/tags/$($policy.previous.tag)"
    $tag = Read-Api "git/tags/$($tagRef.object.sha)"
    if ($old.Count -ne 1 -or $old[0].digest -ne "sha256:$($policy.previous.sha256)" -or $tag.object.sha -ne $policy.previous.commit) { throw 'Previous release identity mismatch' }
    Save-Artifact "$api/releases/assets/$($policy.previous.assetId)" (Join-Path $root 'previous.exe') $policy.previous.sha256 'application/octet-stream'
    $upgrade = @{ status = 'PLANNED'; trusted = $true; tag = $policy.previous.tag; commit = $policy.previous.commit; sha256 = $policy.previous.sha256; provenance = 'Owned release API digest and fixed tag commit; unsigned, no publisher signature claim' }
  } catch { $upgrade.reason = $_.Exception.Message }
  $upgrade | ConvertTo-Json | Set-Content (Join-Path $root 'evidence/upgrade-provenance.json')
  @{ sourceCommit = $policy.sourceCommit; runId = $policy.runId; artifactId = $policy.artifactId; archiveSha256 = $policy.artifactDigest; installerSha256 = $policy.installerSha256; status = 'PASS' } | ConvertTo-Json | Set-Content (Join-Path $root 'evidence/artifact-verification.json')
} catch {
  @{ status = 'FAIL'; phase = 'artifact-download'; reason = $_.Exception.Message } | ConvertTo-Json | Set-Content (Join-Path $root 'evidence/download-failure.json')
  throw
} finally { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
