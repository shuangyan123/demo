param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"

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
