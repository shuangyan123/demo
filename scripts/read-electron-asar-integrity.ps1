param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Electron executable not found: $ExecutablePath"
}

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ElectronAsarIntegrityResourceReader
{
    private const uint LoadLibraryAsDatafile = 0x00000002;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResource(IntPtr module, string name, string type);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr resource);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr module, IntPtr resource);

    public static byte[] Read(string fileName)
    {
        IntPtr module = LoadLibraryEx(fileName, IntPtr.Zero, LoadLibraryAsDatafile);
        if (module == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "LoadLibraryEx failed");
        }

        try
        {
            IntPtr resource = FindResource(module, "ELECTRONASAR", "INTEGRITY");
            if (resource == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "INTEGRITY/ELECTRONASAR resource not found");
            }

            IntPtr loaded = LoadResource(module, resource);
            IntPtr data = LockResource(loaded);
            uint size = SizeofResource(module, resource);
            if (loaded == IntPtr.Zero || data == IntPtr.Zero || size == 0)
            {
                throw new InvalidOperationException("INTEGRITY/ELECTRONASAR resource is empty");
            }

            byte[] payload = new byte[size];
            Marshal.Copy(data, payload, 0, checked((int)size));
            return payload;
        }
        finally
        {
            FreeLibrary(module);
        }
    }
}
"@

$payload = [ElectronAsarIntegrityResourceReader]::Read((Resolve-Path -LiteralPath $ExecutablePath))
[System.Text.Encoding]::UTF8.GetString($payload)
