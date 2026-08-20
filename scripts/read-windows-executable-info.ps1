param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 otherwise emits redirected stdout using the active
# console code page, which corrupts the Chinese PE metadata consumed as JSON.
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Windows executable not found: $ExecutablePath"
}

$versionInfo = (Get-Item -LiteralPath $ExecutablePath).VersionInfo
[pscustomobject]@{
  FileVersion = $versionInfo.FileVersion
  ProductVersion = $versionInfo.ProductVersion
  ProductName = $versionInfo.ProductName
  FileDescription = $versionInfo.FileDescription
  InternalName = $versionInfo.InternalName
  OriginalFilename = $versionInfo.OriginalFilename
} | ConvertTo-Json -Compress
