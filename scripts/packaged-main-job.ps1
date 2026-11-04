param([Parameter(Mandatory)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$job = $null
try {
  $request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
  $root = [IO.Path]::GetFullPath($request.cwd)
  if ($request.mode -ne 'node-tool-fixture' -or [IO.Path]::GetFileName($request.executable) -ne 'node.exe' -or
    -not [IO.Path]::IsPathRooted($request.executable) -or
    [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($RequestPath)) -ne $root -or
    [IO.Path]::GetFileName($root) -notmatch '^recall-packaged-smoke-' -or
    $request.arguments.Count -ne 4 -or $request.arguments[0] -ne (Join-Path $root 'mock-child.mjs') -or
    $request.arguments[1] -notin @('tree','orphan','environment','nonzero') -or
    $request.arguments[2] -ne (Join-Path $root 'temp\heartbeat') -or
    $request.arguments[3] -ne (Join-Path $root 'temp\environment.json')) { throw 'invalid_fixture_request' }
  foreach ($file in @($root, $RequestPath, $request.arguments[0], (Join-Path $root '.smoke-owner'), (Join-Path $root 'temp'))) {
    if ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'unsafe_fixture_link' }
  }
  if ((Get-Content -LiteralPath (Join-Path $root '.smoke-owner') -Raw) -notmatch '^[a-f0-9]{48}$') { throw 'fixture_owner_missing' }
  if ($request.timeoutMs -lt 10 -or $request.timeoutMs -gt 10000) { throw 'invalid_timeout' }
  $environment = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($property in $request.environment.PSObject.Properties) {
    if ($property.Name -notin @('SystemRoot','WINDIR','TEMP','TMP')) { throw 'unexpected_fixture_environment' }
    $environment.Add($property.Name, [string]$property.Value)
  }
  if ($environment['TEMP'] -ne (Join-Path $root 'temp') -or $environment['TMP'] -ne (Join-Path $root 'temp')) { throw 'unsafe_fixture_temp' }
  Add-Type -Path (Join-Path $PSScriptRoot 'packaged-main-job.cs')
  $job = [RecallSmokeJob]::new($request.executable, [string[]]$request.arguments, $request.cwd, $environment)
  $normal = $job.Wait([uint32]$request.timeoutMs)
  $exitCode = if ($normal) { $job.ExitCode } else { 124 }
  $contained = $job.Active -ne 0
  if ($contained) { $job.Stop() }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ($job.Active -ne 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }
  if ($job.Active -ne 0) { throw 'job_cleanup_unconfirmed' }
  [Console]::Out.WriteLine((@{ normalExit = ($normal -and -not $contained -and $exitCode -eq 0); processExited=$normal;
    timedOut = (-not $normal); exitCode = $exitCode; activeProcesses = 0; containmentUsed = $contained } | ConvertTo-Json -Compress))
} catch {
  # Keep this PS5.1 entry point ASCII-only; emit no raw errors or child output.
  [Console]::Out.WriteLine('{"error":"owned_process_job_failed"}')
  exit 1
} finally { if ($null -ne $job) { $job.Dispose() } }
