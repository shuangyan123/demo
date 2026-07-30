param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$IntegrityPayloadPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Electron executable not found: $ExecutablePath"
}

if (-not (Test-Path -LiteralPath $IntegrityPayloadPath -PathType Leaf)) {
  throw "ASAR integrity payload not found: $IntegrityPayloadPath"
}

# Write Electron's INTEGRITY/ELECTRONASAR resource through the Win32 API.
# This avoids expanding the 200MB-plus executable in the JavaScript heap.
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ElectronAsarIntegrityResource
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResource(
        IntPtr update,
        string type,
        string name,
        ushort language,
        byte[] data,
        uint dataLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr update, bool discard);

    public static void Write(string executablePath, byte[] payload)
    {
        IntPtr update = BeginUpdateResource(executablePath, false);
        if (update == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "BeginUpdateResource failed");
        }

        bool committed = false;
        try
        {
            if (!UpdateResource(
                update,
                "INTEGRITY",
                "ELECTRONASAR",
                1033,
                payload,
                (uint)payload.Length
            ))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateResource failed");
            }

            if (!EndUpdateResource(update, false))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "EndUpdateResource failed");
            }

            committed = true;
        }
        finally
        {
            if (!committed)
            {
                EndUpdateResource(update, true);
            }
        }
    }
}
"@

$payload = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $IntegrityPayloadPath))
[ElectronAsarIntegrityResource]::Write(
  (Resolve-Path -LiteralPath $ExecutablePath),
  $payload
)
