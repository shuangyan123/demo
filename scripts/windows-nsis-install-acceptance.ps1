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
$installRegistration = $null
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
        if ($null -ne $v -and $null -ne $v.PSObject.Properties['DisplayName'] -and $v.DisplayName -match '错题复盘|ReviewWorkspace|review.workspace') {
          $version = if ($null -ne $v.PSObject.Properties['DisplayVersion']) { $v.DisplayVersion } else { '' }
          $values = [ordered]@{ DisplayName = $v.DisplayName; DisplayVersion = $version }
          foreach ($name in @('InstallLocation', 'UninstallString', 'QuietUninstallString', 'DisplayIcon')) { $values[$name] = if ($null -ne $v.PSObject.Properties[$name]) { $v.$name } else { '' } }
          [pscustomobject]@{ key = $_.PSPath; hive = $hive; values = [pscustomobject]$values }
        }
      }
    }
  }
}
function Installation-Registry($record) {
  # electron-builder 把 InstallLocation 存在 Software\APP_GUID，卸载键只保存命令/显示信息。
  $guid = Split-Path $record.key -Leaf
  if ($record.hive -ne 'HKCU:' -or $guid -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') { throw 'Unexpected NSIS registry identity' }
  $key = "HKCU:\Software\$guid"
  $value = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
  if ($null -eq $value.PSObject.Properties['InstallLocation'] -or [string]::IsNullOrWhiteSpace($value.InstallLocation)) { throw 'Missing application installation location' }
  [pscustomobject]@{ key = $key; location = $value.InstallLocation }
}
function Resolve-Installed-File($file) {
  if (-not ('RecallAcceptanceFilePath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class RecallAcceptanceFilePath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder value, uint length, uint flags);
  public static string Resolve(string path) {
    using (var file = File.OpenRead(path)) {
      var value = new StringBuilder(32768);
      var length = GetFinalPathNameByHandle(file.SafeFileHandle, value, (uint)value.Capacity, 0);
      if (length == 0 || length >= value.Capacity) throw new IOException("Unable to confirm installed file path");
      return value.ToString();
    }
  }
}
'@
  }
  [RecallAcceptanceFilePath]::Resolve($file)
}
function Invoke-OwnedNativeButton($element, $expectedProcessId) {
  # UIA exposes this TaskDialog child as ControlType.Pane with no patterns.
  # Never activate arbitrary windows: validate the exact native HWND, parent,
  # process, title, class, geometry, foreground and hit test on hosted Windows.
  $control = $element.Current
  if ($control.Name -ne '创建本地资料' -or $control.ClassName -ne 'CCPushButton' -or
      $control.ProcessId -ne $expectedProcessId -or -not $control.IsEnabled -or
      $control.IsOffscreen -or $control.NativeWindowHandle -le 0) {
    throw 'Native confirmation target identity mismatch'
  }
  if (-not ('RecallAcceptanceNativeButton' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class RecallAcceptanceNativeButton {
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  private static extern int GetClassName(IntPtr handle, StringBuilder name, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr handle, StringBuilder name, int length);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  private static void Require(bool condition, string stage) {
    if (!condition) throw new InvalidOperationException("Owned native button: " + stage);
  }
  public static void Click(int handle, int expectedPid) {
    var button = new IntPtr(handle);
    uint buttonPid = 0, dialogPid = 0;
    Require(handle > 0 && GetWindowThreadProcessId(button, out buttonPid) != 0 &&
      buttonPid == (uint)expectedPid, "button PID");
    Require(IsWindowVisible(button) && IsWindowEnabled(button), "button visibility/enabled");
    var className = new StringBuilder(128);
    Require(GetClassName(button, className, className.Capacity) > 0 &&
      className.ToString() == "CCPushButton", "button class");
    var dialog = GetAncestor(button, 2u); // GA_ROOT
    Require(dialog != IntPtr.Zero && GetWindowThreadProcessId(dialog, out dialogPid) != 0 &&
      dialogPid == (uint)expectedPid, "dialog PID");
    var title = new StringBuilder(256);
    Require(GetWindowText(dialog, title, title.Capacity) > 0 &&
      title.ToString() == "创建本地学习资料", "dialog title");
    Require(IsWindowVisible(dialog) && IsWindowEnabled(dialog), "dialog visibility/enabled");
    RECT buttonRect = default(RECT), dialogRect = default(RECT);
    Require(GetWindowRect(button, out buttonRect) && GetWindowRect(dialog, out dialogRect),
      "window rectangles");
    int x = buttonRect.Left + (buttonRect.Right - buttonRect.Left) / 2;
    int y = buttonRect.Top + (buttonRect.Bottom - buttonRect.Top) / 2;
    Require(buttonRect.Right > buttonRect.Left && buttonRect.Bottom > buttonRect.Top &&
      x > dialogRect.Left && x < dialogRect.Right &&
      y > dialogRect.Top && y < dialogRect.Bottom, "button geometry");
    if (GetForegroundWindow() != dialog) SetForegroundWindow(dialog);
    Thread.Sleep(100);
    Require(GetForegroundWindow() == dialog, "foreground owner");
    Require(SetCursorPos(x, y), "cursor placement");
    Thread.Sleep(75);
    Require(WindowFromPoint(new POINT { X = x, Y = y }) == button, "hit-tested HWND");
    // Genuine bounded desktop interaction with the sole verified owned control.
    // A successful gesture is not an acceptance PASS: CDP and storage tests follow.
    mouse_event(0x0002u, 0, 0, 0, UIntPtr.Zero); // LEFTDOWN
    Thread.Sleep(60);
    mouse_event(0x0004u, 0, 0, 0, UIntPtr.Zero); // LEFTUP
  }
}
'@
  }
  [RecallAcceptanceNativeButton]::Click([int]$control.NativeWindowHandle, [int]$expectedProcessId)
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
  $script:installRegistration = Installation-Registry $records[0]
  Check ([IO.Path]::GetFullPath($script:installRegistration.location).TrimEnd('\') -eq $install) 'Registry installation location matches isolated target'
  Check ($records[0].values.UninstallString.StartsWith('"' + $install + '\Uninstall', [StringComparison]::OrdinalIgnoreCase)) 'Registered uninstall command targets owned payload'
  Check ($records[0].values.DisplayIcon.StartsWith($install + '\', [StringComparison]::OrdinalIgnoreCase)) 'Registered icon targets owned payload'
  Check ((Get-Item -LiteralPath (Join-Path $install 'review-workspace.exe')).VersionInfo.ProductVersion -like '0.3.1*') 'Installed executable version'
  $records | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'installed-registration.json')
  $shell = New-Object -ComObject WScript.Shell
  $links = @()
  foreach ($shortcut in $shortcutPaths) {
    Check (Test-Path -LiteralPath $shortcut) "Shortcut created: $(Split-Path $shortcut -Leaf)"
    $link = $shell.CreateShortcut($shortcut)
    $target = $link.TargetPath
    $expected = Join-Path $install 'review-workspace.exe'
    # Shell.Application independently resolves the real Shell Link target. WScript.Shell
    # can return an empty TargetPath for this installed Unicode-named link on hosted Windows.
    # An existing expected EXE must be proved by file handles, never assumed from a string.
    $shellLinkTarget = ''
    $shellLinkError = ''
    try {
      $folder = (New-Object -ComObject Shell.Application).NameSpace((Split-Path $shortcut -Parent))
      $item = $folder.ParseName((Split-Path $shortcut -Leaf))
      if ($null -ne $item -and $item.IsLink) {
        $linkItem = $item.GetLink
        if ($null -ne $linkItem.Target) { $shellLinkTarget = $linkItem.Target.Path }
      }
    } catch { $shellLinkError = $_.Exception.Message }
    $shortcutFile = Get-Item -LiteralPath $shortcut -Force
    $links += @{ shortcut = $shortcut; target = $target; expected = $expected; arguments = $link.Arguments;
      shellLinkTarget = $shellLinkTarget; shellLinkError = $shellLinkError;
      bytes = $shortcutFile.Length; sha256 = (Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash.ToLowerInvariant() }
    ConvertTo-Json -InputObject $links -Depth 4 | Set-Content (Join-Path $evidence 'installed-shortcuts.json')
    # Accept the independently resolved Shell Link only when its opened native file handle
    # identifies the exact installed executable. If WScript also returns a target it must
    # independently agree; mismatched, missing or foreign targets still FAIL.
    $same = $false
    try {
      $expectedIdentity = Resolve-Installed-File $expected
      $shellIdentity = Resolve-Installed-File $shellLinkTarget
      $wscriptAgrees = [string]::IsNullOrWhiteSpace($target) -or ((Resolve-Installed-File $target) -eq $expectedIdentity)
      $same = $shellIdentity -eq $expectedIdentity -and $wscriptAgrees -and [string]::IsNullOrEmpty($link.Arguments)
    } catch { $same = $false }
    try { Check $same 'Shortcut target is isolated executable' }
    catch { Write-Output 'Shortcut assertion retained as FAIL; continue independent installed-executable checks' }
  }
}
function Launch-Probe($exe, $mode, $name, $fresh) {
  $port = Get-Random -Minimum 30000 -Maximum 45000
  # An installed app may need a visible native first-run dialog; hiding its window masks the acceptance surface.
  $script:current = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port --force-renderer-accessibility" -PassThru -RedirectStandardOutput (Join-Path $evidence "$name.stdout.log") -RedirectStandardError (Join-Path $evidence "$name.stderr.log")
  if ($fresh) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $until = [DateTime]::UtcNow.AddSeconds(45)
    $clicked = $false
    while ([DateTime]::UtcNow -lt $until -and -not $clicked) {
      $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $script:current.Id))
      $dialogs = @($windows | Where-Object { $_.Current.Name -eq '创建本地学习资料' -and $_.Current.ProcessId -eq $script:current.Id })
      if ($dialogs.Count -gt 1) { throw 'Ambiguous owned native confirmation dialogs' }
      foreach ($window in $dialogs) {
        $named = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, '创建本地资料'))
        $candidateDetails = @()
        foreach ($control in $named) {
          $candidateDetails += @{
            name = $control.Current.Name
            controlType = $control.Current.ControlType.ProgrammaticName
            className = $control.Current.ClassName
            nativeWindowHandle = $control.Current.NativeWindowHandle
            processId = $control.Current.ProcessId
            isEnabled = $control.Current.IsEnabled
            isOffscreen = $control.Current.IsOffscreen
            patterns = @($control.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
          }
        }
        @{ dialogTitle = $window.Current.Name; ownerProcessId = $script:current.Id; dialogProcessId = $window.Current.ProcessId; candidates = $candidateDetails } |
          ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'fresh-profile-native-controls.json')
        # TaskDialog can expose a non-Button control type; match the exact owned dialog,
        # unique enabled visible label and process, then require a supported action.
        $candidates = @($named | Where-Object { $_.Current.ProcessId -eq $script:current.Id -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
        if ($candidates.Count -gt 1) { throw 'Ambiguous native confirmation controls' }
        if ($candidates.Count -eq 1) {
          $button = $candidates[0]
          $pattern = $null
          if ($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            ([Windows.Automation.InvokePattern]$pattern).Invoke()
          } else {
            Invoke-OwnedNativeButton $button $script:current.Id
            'verified CCPushButton native pointer activation sent; workspace/storage remains unverified' |
              Set-Content (Join-Path $evidence 'fresh-profile-native-action.txt')
          }
          $clicked = $true
          break
        }
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
  Check (-not (Test-Path -LiteralPath $script:installRegistration.key)) 'Application installation registration removed'
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
  Check (@($assertions | Where-Object { -not $_.pass }).Count -eq 0) 'Every recorded assertion passed'
  $complete = $true
} catch {
  @{ status = 'FAIL'; error = $_.Exception.Message; stack = $_.ScriptStackTrace } | ConvertTo-Json | Set-Content (Join-Path $evidence 'failure.json')
  # 只采集本轮拥有的安装进程窗口；失败时保留原生对话框证据，不截图宿主其他应用。
  try {
    if ($null -ne $current -and -not $current.HasExited) {
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      Add-Type -AssemblyName System.Drawing
      $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $current.Id))
      $details = @(); $index = 0
      foreach ($window in $windows) {
        $controls = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        $details += @{ title = $window.Current.Name; controls = @($controls | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) }
        $bounds = $window.Current.BoundingRectangle
        if ($bounds.Width -gt 0 -and $bounds.Height -gt 0) {
          $bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height); $graphics = [Drawing.Graphics]::FromImage($bitmap)
          try { $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size); $bitmap.Save((Join-Path $evidence "failure-owned-window-$index.png")) } finally { $graphics.Dispose(); $bitmap.Dispose() }
        }
        $index++
      }
      ConvertTo-Json -InputObject $details -Depth 4 | Set-Content (Join-Path $evidence 'failure-owned-windows.json')
    }
  } catch { Write-Output 'Owned-window diagnostics unavailable; original failure retained' }
  throw
} finally {
  # 不用强制清理伪造卸载成功；失败现场与断言留在 artifact，runner 任务后整体销毁。
  $assertions | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $evidence 'assertions.json')
  @{ status = $(if ($complete) { 'PASS' } else { 'FAIL' }); sourceCommit = $policy.sourceCommit; assertions = $assertions.Count; syntheticOnly = $true; runner = $env:RUNNER_NAME } | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
  Stop-Transcript
}
