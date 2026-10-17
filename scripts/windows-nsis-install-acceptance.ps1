$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# 不提供本机 override；安装/卸载只能发生在一次性 GitHub Windows runner。
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'shuangyan123/demo') { throw 'Hosted Windows runner only; local installation forbidden' }
$event = Get-Content -Raw $env:GITHUB_EVENT_PATH | ConvertFrom-Json
$policy = Get-Content -Raw (Join-Path $PSScriptRoot 'nsis-install-acceptance.json') | ConvertFrom-Json
if ($env:GITHUB_EVENT_NAME -ne 'pull_request' -or $event.number -ne 148 -or $event.label.name -ne $policy.label) { throw 'Explicit owned PR label required' }
$root = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'recall-install-acceptance'))
$evidence = Join-Path $root 'evidence'
$install = Join-Path $root 'installed'
$appData = [Environment]::GetFolderPath('ApplicationData')
$localData = [Environment]::GetFolderPath('LocalApplicationData')
$profiles = @((Join-Path $appData 'review-workspace'), (Join-Path $appData '错题复盘'))
$bootstrap = Join-Path $appData 'recall-storage'
$oldRoot = Join-Path $localData 'review_workspace'
$shortcutPaths = @((Join-Path ([Environment]::GetFolderPath('Desktop')) '错题复盘.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) '错题复盘.lnk'))
$assertions = [Collections.Generic.List[object]]::new()
$ownedData = $false
$current = $null
$complete = $false
function Check($condition, $name) {
  $assertions.Add(@{ assertion = $name; pass = [bool]$condition })
  if (-not $condition) { throw "Assertion failed: $name" }
  Write-Output "PASS: $name"
}
function Owned-Path($value, $parent) {
  $full = [IO.Path]::GetFullPath($value)
  $prefix = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes owned namespace' }
  $cursor = $full
  while ($cursor.Length -ge $prefix.Length) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked cleanup target forbidden' }
    $cursor = Split-Path $cursor -Parent
  }
}
function Registry-Entries {
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($branch in @('Software\Microsoft\Windows\CurrentVersion\Uninstall', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
      Get-ChildItem "$hive\$branch" -ErrorAction SilentlyContinue | ForEach-Object {
        $v = Get-ItemProperty -LiteralPath $_.PSPath
        if (($v.PSObject.Properties.Name -contains 'DisplayName') -and $v.DisplayName -match '错题复盘|ReviewWorkspace|review.workspace') {
          [pscustomobject]@{ key = $_.PSPath; hive = $hive; values = $v }
        }
      }
    }
  }
}
function Run-Owned($file, $arguments, $seconds = 120) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit($seconds * 1000)) { throw 'Installer process deadline exceeded' }
  Check ($process.ExitCode -eq 0) "Process exit zero: $(Split-Path $file -Leaf)"
}
function Stop-Owned-App {
  if ($null -ne $script:current -and -not $script:current.HasExited) {
    [void]$script:current.CloseMainWindow()
    if (-not $script:current.WaitForExit(30000)) { throw 'Installed application failed graceful shutdown' }
  }
  $script:current = $null
}
function Clean-Synthetic-Data {
  if (-not $script:ownedData) { throw 'Synthetic data not owned' }
  foreach ($directory in @($profiles) + @($bootstrap)) {
    Owned-Path $directory $appData
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
  }
  Check (@(@($profiles) + @($bootstrap) | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) 'Synthetic profiles and bootstrap cleaned'
}
function Install-Fixed {
  Owned-Path $install $root
  $setup = Join-Path $root "artifact/$($policy.installer)"
  Check ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant() -eq $policy.installerSha256) 'Installer SHA256 rechecked immediately before execution'
  # NSIS /D 必须是最后一个参数且不加引号；RUNNER_TEMP 本轮路径不含空格。
  Check (-not $install.Contains(' ')) 'Controlled NSIS destination has no spaces'
  Run-Owned $setup "/S /currentuser /D=$install"
  foreach ($file in @('review-workspace.exe', 'resources\app.asar', 'resources\.desktop-runtime\node\node.exe', 'resources\.desktop-runtime\app\server.js')) { Check (Test-Path -LiteralPath (Join-Path $install $file) -PathType Leaf) "Installed file: $file" }
  $records = @(Registry-Entries | Where-Object { $_.values.DisplayVersion -eq '0.3.1' })
  Check ($records.Count -eq 1) 'One current-version uninstall registration'
  Check ($records[0].hive -eq 'HKCU:') 'Per-user registration, no elevation'
  Check ([IO.Path]::GetFullPath($records[0].values.InstallLocation).TrimEnd('\') -eq $install) 'Registry installation location matches isolated target'
  Check ((Get-Item -LiteralPath (Join-Path $install 'review-workspace.exe')).VersionInfo.ProductVersion -like '0.3.1*') 'Installed executable version'
  $records | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'installed-registration.json')
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcut in $shortcutPaths) {
    Check (Test-Path -LiteralPath $shortcut) "Shortcut created: $(Split-Path $shortcut -Leaf)"
    Check ($shell.CreateShortcut($shortcut).TargetPath -eq (Join-Path $install 'review-workspace.exe')) 'Shortcut target is isolated executable'
  }
}
function Launch-Probe($exe, $mode, $name, $fresh) {
  $port = Get-Random -Minimum 30000 -Maximum 45000
  $script:current = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port --force-renderer-accessibility" -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence "$name.stdout.log") -RedirectStandardError (Join-Path $evidence "$name.stderr.log")
  if ($fresh) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $until = [DateTime]::UtcNow.AddSeconds(45)
    $clicked = $false
    while ([DateTime]::UtcNow -lt $until -and -not $clicked) {
      $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $script:current.Id))
      foreach ($window in $windows) {
        $button = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, '创建本地资料'))
        if ($null -ne $button) { ([Windows.Automation.InvokePattern]$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke(); $clicked = $true; break }
      }
      if (-not $clicked) { Start-Sleep -Milliseconds 250 }
    }
    Check $clicked 'Fresh-profile native confirmation exercised'
  }
  & node (Join-Path $PSScriptRoot 'install-acceptance-cdp.mjs') "$port" $mode (Join-Path $evidence "$name.json")
  Check ($LASTEXITCODE -eq 0) "Installed workspace and synthetic storage: $name"
  Stop-Owned-App
}
function Uninstall-Fixed {
  $uninstallers = @(Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe')
  Check ($uninstallers.Count -eq 1) 'Owned uninstaller present'
  Run-Owned $uninstallers[0].FullName '/S'
  $until = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $until -and ((Test-Path -LiteralPath (Join-Path $install 'review-workspace.exe')) -or @(Registry-Entries | Where-Object { $_.values.DisplayVersion -eq '0.3.1' }).Count)) { Start-Sleep -Milliseconds 250 }
  Check (-not (Test-Path -LiteralPath $install) -or @(Get-ChildItem -LiteralPath $install -Force).Count -eq 0) 'Installed payload removed by uninstaller'
  Check (@(Registry-Entries | Where-Object { $_.values.DisplayVersion -eq '0.3.1' }).Count -eq 0) 'Current uninstall registration removed'
  foreach ($shortcut in $shortcutPaths) { Check (-not (Test-Path -LiteralPath $shortcut)) 'Installed shortcut removed' }
  Check (Test-Path -LiteralPath (Join-Path $bootstrap 'bootstrap.json')) 'Uninstall preserves synthetic user profile metadata'
}
Start-Transcript -Path (Join-Path $evidence 'install-transcript.log')
try {
  Check ([string]::IsNullOrEmpty($env:GH_TOKEN) -and [string]::IsNullOrEmpty($env:GITHUB_TOKEN)) 'Artifact API credential is absent from installer environment'
  Check (@(Registry-Entries).Count -eq 0) 'No previous Recall installation on disposable runner'
  foreach ($candidate in @($profiles) + @($bootstrap, $oldRoot) + $shortcutPaths) { Check (-not (Test-Path -LiteralPath $candidate)) "No pre-existing fixture path: $candidate" }
  $ownedData = $true
  Install-Fixed
  Launch-Probe (Join-Path $install 'review-workspace.exe') 'write' 'fresh-launch' $true
  $record = Get-Content -Raw (Join-Path $bootstrap 'bootstrap.json') | ConvertFrom-Json
  Check ($record.activeManagedRoot -in $profiles) 'Main created managed profile in the expected synthetic namespace'
  $anchorHash = (Get-FileHash -LiteralPath (Join-Path $record.activeManagedRoot '.recall-storage/identity.json')).Hash
  Launch-Probe (Join-Path $install 'review-workspace.exe') 'read' 'restart-retention' $false
  Check ((Get-FileHash -LiteralPath (Join-Path $record.activeManagedRoot '.recall-storage/identity.json')).Hash -eq $anchorHash) 'Restart retains profile identity'
  Uninstall-Fixed
  Clean-Synthetic-Data
  $upgrade = Get-Content -Raw (Join-Path $evidence 'upgrade-provenance.json') | ConvertFrom-Json
  if ($upgrade.trusted) {
    # 旧版为 Squirrel：单独验证迁移安装及相同 partition/origin 的数据保留，不能冒称 NSIS 原位升级。
    Run-Owned (Join-Path $root 'previous.exe') '--silent'
    Owned-Path $oldRoot $localData
    $oldExe = @(Get-ChildItem -LiteralPath $oldRoot -Filter 'review-workspace.exe' -Recurse | Where-Object { $_.Directory.Name -eq 'app-0.2.2' })
    Check ($oldExe.Count -eq 1) 'Verified old Squirrel payload installed'
    # Setup may start the old app; close only that owned executable before controlled launch.
    Get-Process -Name 'review-workspace' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $oldExe[0].FullName } | ForEach-Object { [void]$_.CloseMainWindow(); if (-not $_.WaitForExit(30000)) { throw 'Old auto-launch failed shutdown' } }
    Launch-Probe $oldExe[0].FullName 'write' 'old-version-data' $false
    Install-Fixed
    Launch-Probe (Join-Path $install 'review-workspace.exe') 'read' 'upgrade-retention' $false
    Uninstall-Fixed
    Run-Owned (Join-Path $oldRoot 'Update.exe') '--uninstall --silent'
    $until = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $until -and (Test-Path -LiteralPath $oldExe[0].FullName)) { Start-Sleep -Milliseconds 250 }
    Check (-not (Test-Path -LiteralPath $oldExe[0].FullName)) 'Old Squirrel application payload uninstalled'
    # Squirrel 可留下 updater 残余；记录后只清理本轮从不存在开始创建的旧包目录。
    @{ paths = @(Get-ChildItem -LiteralPath $oldRoot -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) } | ConvertTo-Json | Set-Content (Join-Path $evidence 'squirrel-residue-before-fixture-cleanup.json')
    Owned-Path $oldRoot $localData
    if (Test-Path -LiteralPath $oldRoot) { Remove-Item -LiteralPath $oldRoot -Recurse -Force }
    Check (-not (Test-Path -LiteralPath $oldRoot)) 'Owned Squirrel residual directory cleaned'
    $upgrade | Add-Member -NotePropertyName result -NotePropertyValue 'PASS: Squirrel-to-NSIS storage handoff; synthetic localStorage/IndexedDB, not all business schema migrations' -Force
    $upgrade | ConvertTo-Json | Set-Content (Join-Path $evidence 'upgrade-result.json')
    Clean-Synthetic-Data
  } else { $upgrade | ConvertTo-Json | Set-Content (Join-Path $evidence 'upgrade-result.json') }
  Check (@(Registry-Entries).Count -eq 0) 'No remaining Recall uninstall registrations'
  $complete = $true
} catch {
  @{ status = 'FAIL'; error = $_.Exception.Message; stack = $_.ScriptStackTrace } | ConvertTo-Json | Set-Content (Join-Path $evidence 'failure.json')
  throw
} finally {
  # 不用强制清理伪造卸载成功；失败现场与断言留在 artifact，runner 任务后整体销毁。
  $assertions | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $evidence 'assertions.json')
  @{ status = $(if ($complete) { 'PASS' } else { 'FAIL' }); sourceCommit = $policy.sourceCommit; assertions = $assertions.Count; syntheticOnly = $true; runner = $env:RUNNER_NAME } | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
  Stop-Transcript
}
