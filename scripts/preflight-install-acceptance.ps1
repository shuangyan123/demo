$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Compile only. No installer, app or native UI interaction is permitted here.
$file = Join-Path $PSScriptRoot 'windows-nsis-install-acceptance.ps1'
$contents = Get-Content -LiteralPath $file -Raw
$start = $contents.IndexOf('function Invoke-OwnedNativeButton(', [StringComparison]::Ordinal)
if ($start -lt 0) { throw 'Native button helper not found' }
$end = $contents.IndexOf('function Run-Owned(', $start, [StringComparison]::Ordinal)
if ($end -le $start) { throw 'Native button helper not properly delimited' }
$helper = $contents.Substring($start, $end - $start)
$matches = [regex]::Matches($helper, "(?s)Add-Type -TypeDefinition @'\r?\n(?<csharp>.*?)\r?\n'@")
if ($matches.Count -ne 1) { throw 'Expected exactly one native helper C# source block' }
Add-Type -TypeDefinition $matches[0].Groups['csharp'].Value -ErrorAction Stop
if (-not ('RecallAcceptanceNativeButton' -as [type])) { throw 'Native button helper failed to compile' }
Write-Output 'PASS: owned native button helper compiles (no app or installer run)'
