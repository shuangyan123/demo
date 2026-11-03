param([Parameter(Mandatory=$true)][string]$OwnedRoot, [string]$ExpectedExecutable)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath $OwnedRoot).Path
if ([IO.Path]::GetFileName($taskRoot) -notmatch '^recall-(packaged|native)-profile-test-' -or
    ((Get-Item -LiteralPath $taskRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Not an owned packaged fixture root.'
}
$taskExecutable = if ($ExpectedExecutable) { (Resolve-Path -LiteralPath $ExpectedExecutable).Path }
  else { Join-Path $taskRoot 'binary\review-workspace.exe' }
$taskIds = Get-Content -LiteralPath (Join-Path $taskRoot 'owned-processes.json') -Raw | ConvertFrom-Json
foreach ($taskId in $taskIds) {
  if ($taskId -isnot [int] -or $taskId -le 0) { throw 'Invalid owned process identifier.' }
  try { $taskProcess = [Diagnostics.Process]::GetProcessById($taskId) }
  catch [ArgumentException] { continue } # Already exited; no process is terminated by this helper.
  try {
    if ($taskProcess.HasExited) { continue }
    if ($taskProcess.MainModule.FileName -ine $taskExecutable) { throw 'Process ownership changed.' }
    if (-not $taskProcess.WaitForExit(10000)) { throw 'Owned Electron process did not exit.' }
  } catch {
    if (-not $taskProcess.HasExited) { throw }
  } finally { $taskProcess.Dispose() }
}
