param([Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceCommit)
$ErrorActionPreference = 'Stop'
$stage = 'assemblies'
try {
  # Read-only OS probe: no users, firewall changes, path overrides or app launch.
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RecallRunnerDesktopProbe {
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("wtsapi32.dll", SetLastError=true)] static extern bool WTSQuerySessionInformation(IntPtr server, int session, int kind, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
  [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
  public static bool InputDesktopReadable() {
    var desktop=OpenInputDesktop(0,false,1); if(desktop==IntPtr.Zero)return false; CloseDesktop(desktop); return true;
  }
  public static bool ActiveSession(int id) {
    IntPtr buffer; int size; if(!WTSQuerySessionInformation(IntPtr.Zero,id,8,out buffer,out size))return false;
    try{return size>=4 && Marshal.ReadInt32(buffer)==0;}finally{WTSFreeMemory(buffer);}
  }
  public static string Folder(string id) {
    Guid guid=new Guid(id); IntPtr value; if(SHGetKnownFolderPath(ref guid,0,IntPtr.Zero,out value)!=0)throw new InvalidOperationException();
    try{return Marshal.PtrToStringUni(value);}finally{Marshal.FreeCoTaskMem(value);}
  }
}
'@
  $stage = 'source'
  $head = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -ne $SourceCommit) { throw 'source_head_mismatch' }
  $stage = 'desktop'
  $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $desktop = [Environment]::UserInteractive -and $session -ne 0 -and
    [RecallRunnerDesktopProbe]::ActiveSession($session) -and [RecallRunnerDesktopProbe]::InputDesktopReadable()
  $automation = $null -ne [System.Windows.Automation.AutomationElement]::RootElement
  $stage = 'known_folders'
  $roaming = [RecallRunnerDesktopProbe]::Folder('3EB685DB-65F9-4CF6-A03A-E3EF65729F3D')
  $local = [RecallRunnerDesktopProbe]::Folder('F1B32785-6FBA-4FCF-9D55-7B8E7F157091')
  $profile = [RecallRunnerDesktopProbe]::Folder('5E6C858F-0E22-4760-9AFE-EA3317B67173')
  $stage = 'process'
  $processReadable = $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId=$PID")
  $stage = 'listeners'
  $null = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
  $firewallApi = $null -ne (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)
  $stage = 'environment'
  $runner = $env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_OS -eq 'Windows'
  $supported = $runner -and $desktop -and $automation -and $processReadable
  # Emit only fixed booleans, never actual user paths, account names or tokens.
  $result = [ordered]@{ schemaVersion=1; sourceCommit=$SourceCommit; scope='read-only-runner-capability';
    status=$(if($supported){'DESKTOP_CANDIDATE_ONLY'}else{'ENVIRONMENT_UNSUPPORTED'});
    hostedWindows=$runner; interactiveSession=$desktop; accessibilityReadable=$automation;
    processObservation=$processReadable; listenerObservation=$true; artifactObservation='not_performed';
    firewallRuleApiPresent=$firewallApi;
    knownFoldersQueried=$true; roamingMatchesEnvironment=($roaming -eq $env:APPDATA);
    localMatchesEnvironment=($local -eq $env:LOCALAPPDATA); profileMatchesEnvironment=($profile -eq $env:USERPROFILE);
    runnerTempPresent=($null -ne $env:RUNNER_TEMP -and (Test-Path -LiteralPath $env:RUNNER_TEMP));
    freshUserIsolationVerified=$false; uiInteractionVerified=$false; egressEnforcementVerified=$false;
    fileWriteBoundaryVerified=$false; realProcessCleanupVerified=$false; packagedMainStarted=$false;
    actualPackagedAcceptance=$false
  }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  if (-not $supported) { exit 2 }
} catch {
  [Console]::Out.WriteLine((@{ status='PROBE_ERROR'; code='runner_probe_failed'; stage=$stage;
    sourceCommit=$SourceCommit; packagedMainStarted=$false; actualPackagedAcceptance=$false } | ConvertTo-Json -Compress))
  exit 1
}
