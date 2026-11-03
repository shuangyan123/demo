param([int]$TaskProcessId, [string]$Button,
  [string]$DialogTitle = 'Recall native contract fixture')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RecallFixtureDialog {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr arg);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  public static bool Click(uint pid, string button, string dialogTitle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, arg) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
      if(owner != pid || title.ToString() != dialogTitle) return true;
      EnumChildWindows(window, (child, ignored) => {
        var label = new StringBuilder(256); GetWindowText(child, label, label.Capacity);
        if(label.ToString().Replace("&", "") == button) { found = child; return false; }
        return true;
      }, IntPtr.Zero);
      return found == IntPtr.Zero;
    }, IntPtr.Zero);
    if(found == IntPtr.Zero) return false;
    SendMessage(found, 0x00F5, IntPtr.Zero, IntPtr.Zero);
    return true;
  }
}
'@
$taskDeadline = [DateTime]::UtcNow.AddSeconds(10)
while ([DateTime]::UtcNow -lt $taskDeadline) {
  if ([RecallFixtureDialog]::Click([uint32]$TaskProcessId, $Button, $DialogTitle)) { exit 0 }
  Start-Sleep -Milliseconds 50
}
throw 'Owned fixture dialog button was not found.'
