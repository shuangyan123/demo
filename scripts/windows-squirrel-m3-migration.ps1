[CmdletBinding()]
param(
  [switch]$ExecuteCleanup,
  [switch]$Stage1Verified,
  [string]$SnapshotPath
)

$ErrorActionPreference = "Stop"
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$script:ProductNameZh = -join @([char]0x9519, [char]0x9898, [char]0x590D, [char]0x76D8)
$script:ProductNames = @("review-workspace", $script:ProductNameZh)
$script:LegacyVersion = "0.2.4"
$script:LegacyStubName = "review-workspace.exe"
$script:LegacyVersionDirectoryName = "app-0.2.4"
$script:LegacyRootName = "review_workspace"
$script:ShortcutName = $script:ProductNameZh + ".lnk"
$script:ElectronBuilderVersion = "26.15.3"
$script:ElectronBuilderAppId = "com.squirrel.review_workspace.review-workspace"
$script:ElectronBuilderNsisNamespace = "50e065bc-3134-11e6-9bab-38c9862bdaf3"

# electron-builder 26.15.3 calls UUID.v5(appId, ELECTRON_BUILDER_NS_UUID).
# Keep the derivation compatible with builder-util-runtime: hash the raw
# namespace UUID bytes followed by the UTF-8 appId, then apply RFC 4122 v5
# version/variant bits. This is intentionally derived, not a new nsis.guid.
function Convert-UuidStringToBytes {
  param([Parameter(Mandatory = $true)][string]$Uuid)
  $hex = ($Uuid -replace "-", "").ToLowerInvariant()
  if ($hex -notmatch '^[0-9a-f]{32}$') { throw "UUID_INVALID" }
  $bytes = New-Object byte[] 16
  for ($index = 0; $index -lt 16; $index++) {
    $bytes[$index] = [Convert]::ToByte($hex.Substring($index * 2, 2), 16)
  }
  return ,$bytes
}

function Convert-BytesToUuidString {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  if ($Bytes.Length -lt 16) { throw "UUID_BYTES_INVALID" }
  $segments = @(
    (($Bytes[0..3] | ForEach-Object { $_.ToString("x2") }) -join ""),
    (($Bytes[4..5] | ForEach-Object { $_.ToString("x2") }) -join ""),
    (($Bytes[6..7] | ForEach-Object { $_.ToString("x2") }) -join ""),
    (($Bytes[8..9] | ForEach-Object { $_.ToString("x2") }) -join ""),
    (($Bytes[10..15] | ForEach-Object { $_.ToString("x2") }) -join "")
  )
  return ($segments -join "-")
}

function Get-ElectronBuilderNsisGuid {
  param(
    [Parameter(Mandatory = $true)][string]$AppId,
    [Parameter(Mandatory = $true)][string]$NamespaceUuid
  )
  $namespaceBytes = Convert-UuidStringToBytes $NamespaceUuid
  $nameBytes = [System.Text.Encoding]::UTF8.GetBytes($AppId)
  $inputBytes = New-Object byte[] ($namespaceBytes.Length + $nameBytes.Length)
  [System.Buffer]::BlockCopy($namespaceBytes, 0, $inputBytes, 0, $namespaceBytes.Length)
  [System.Buffer]::BlockCopy($nameBytes, 0, $inputBytes, $namespaceBytes.Length, $nameBytes.Length)
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $hash = $sha1.ComputeHash($inputBytes)
  } finally {
    $sha1.Dispose()
  }
  $hash[6] = [byte](($hash[6] -band 0x0f) -bor 0x50)
  $hash[8] = [byte](($hash[8] -band 0x3f) -bor 0x80)
  return Convert-BytesToUuidString $hash
}

$script:ElectronBuilderNsisGuid = Get-ElectronBuilderNsisGuid $script:ElectronBuilderAppId $script:ElectronBuilderNsisNamespace

function Get-Val {
  param([AllowNull()]$Object, [Parameter(Mandatory = $true)][string]$Name, $Default = $null)
  if ($null -eq $Object) { return $Default }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $Default }
  return $property.Value
}

function Normalize-PathString {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "PATH_EMPTY" }
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { $full = $full.TrimEnd('\', '/') }
  return $full
}

function Test-PathEqual {
  param([Parameter(Mandatory = $true)][string]$Left, [Parameter(Mandatory = $true)][string]$Right)
  return [string]::Equals((Normalize-PathString $Left), (Normalize-PathString $Right), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathUnderOrEqual {
  param([Parameter(Mandatory = $true)][string]$Candidate, [Parameter(Mandatory = $true)][string]$Root)
  $candidatePath = Normalize-PathString $Candidate
  $rootPath = Normalize-PathString $Root
  if ([string]::Equals($candidatePath, $rootPath, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $candidatePath.StartsWith("$rootPath\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathInside {
  param([Parameter(Mandatory = $true)][string]$Candidate, [Parameter(Mandatory = $true)][string]$Root)
  if (Test-PathEqual $Candidate $Root) { return $false }
  return Test-PathUnderOrEqual $Candidate $Root
}

function Test-StringContainsPath {
  param([AllowNull()][string]$Value, [Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  return $Value.IndexOf((Normalize-PathString $Path), [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-ExpectedPaths {
  if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw "WINDOWS_PROFILE_PATHS_UNAVAILABLE"
  }
  $desktopRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
  if ([string]::IsNullOrWhiteSpace($desktopRoot)) { $desktopRoot = Join-Path $env:USERPROFILE "Desktop" }
  $legacyRoot = Normalize-PathString (Join-Path $env:LOCALAPPDATA $script:LegacyRootName)
  $nsisRoot = Normalize-PathString (Join-Path $env:LOCALAPPDATA "Programs\review-workspace")
  return [pscustomobject][ordered]@{
    legacyRoot = $legacyRoot
    legacyRegistryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\review_workspace"
    legacyUpdate = Normalize-PathString (Join-Path $legacyRoot "Update.exe")
    legacyStub = Normalize-PathString (Join-Path $legacyRoot $script:LegacyStubName)
    legacyVersionDirectory = Normalize-PathString (Join-Path $legacyRoot $script:LegacyVersionDirectoryName)
    nsisRoot = $nsisRoot
    nsisExecutable = Normalize-PathString (Join-Path $nsisRoot $script:LegacyStubName)
    nsisUninstaller = Normalize-PathString (Join-Path $nsisRoot "Uninstall review-workspace.exe")
    nsisInstallRegistryKey = "HKCU:\Software\$script:ElectronBuilderNsisGuid"
    nsisUninstallRegistryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:ElectronBuilderNsisGuid"
    userData = Normalize-PathString (Join-Path $env:APPDATA $script:ProductNameZh)
    desktopShortcut = Normalize-PathString (Join-Path $desktopRoot $script:ShortcutName)
    startMenuShortcut = Normalize-PathString (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$script:ShortcutName")
  }
}

function Get-PathFact {
  param([Parameter(Mandatory = $true)][string]$Path)
  $normalized = Normalize-PathString $Path
  try {
    if (-not (Test-Path -LiteralPath $normalized)) {
      return [pscustomobject][ordered]@{ status = "ABSENT"; path = $normalized; isDirectory = $false; isReparsePoint = $false }
    }
    $item = Get-Item -LiteralPath $normalized -Force
    return [pscustomobject][ordered]@{
      status = "FOUND"
      path = (Normalize-PathString $item.FullName)
      isDirectory = [bool]$item.PSIsContainer
      isReparsePoint = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
    }
  } catch {
    return [pscustomobject][ordered]@{ status = "INVALID"; path = $normalized; isDirectory = $false; isReparsePoint = $false; reason = "PATH_INSPECTION_FAILED" }
  }
}

function Test-NoReparseTree {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    $root = Get-Item -LiteralPath $Path -Force
    if (($root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      return [pscustomobject][ordered]@{ valid = $false; reason = "REPARSE_POINT" }
    }
    if ($root.PSIsContainer) {
      foreach ($entry in @(Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop)) {
        if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          return [pscustomobject][ordered]@{ valid = $false; reason = "REPARSE_POINT" }
        }
      }
    }
    return [pscustomobject][ordered]@{ valid = $true; reason = $null }
  } catch {
    return [pscustomobject][ordered]@{ valid = $false; reason = "TREE_INSPECTION_FAILED" }
  }
}

function Get-ProductExecutableFact {
  param([Parameter(Mandatory = $true)][string]$Path)
  $pathFact = Get-PathFact $Path
  if ($pathFact.status -ne "FOUND" -or $pathFact.isDirectory -or $pathFact.isReparsePoint) {
    $invalidStatus = $pathFact.status
    if ($pathFact.status -eq "FOUND") { $invalidStatus = "INVALID" }
    return [pscustomobject][ordered]@{ status = $invalidStatus; path = $pathFact.path; identity = $false; isDirectory = [bool]$pathFact.isDirectory; isReparsePoint = [bool]$pathFact.isReparsePoint }
  }
  try {
    $info = (Get-Item -LiteralPath $pathFact.path -Force).VersionInfo
    $identity = $false
    foreach ($value in @([string]$info.InternalName, [string]$info.OriginalFilename, [string]$info.ProductName, [string]$info.FileDescription)) {
      if ($value -ieq "review-workspace" -or $value -ieq "review-workspace.exe" -or $value -ieq $script:ProductNameZh) { $identity = $true }
    }
    $versionPattern = '^' + [regex]::Escape($script:LegacyVersion) + '(?:\.0)?$'
    $version = ([string]$info.ProductVersion -match $versionPattern) -or ([string]$info.FileVersion -match $versionPattern)
    $identityStatus = "INVALID"
    if ($identity -and $version) { $identityStatus = "VALID" }
    return [pscustomobject][ordered]@{
      status = $identityStatus
      path = $pathFact.path
      identity = ($identity -and $version)
      isDirectory = [bool]$pathFact.isDirectory
      isReparsePoint = [bool]$pathFact.isReparsePoint
      productName = [string]$info.ProductName
      internalName = [string]$info.InternalName
      originalFilename = [string]$info.OriginalFilename
      productVersion = [string]$info.ProductVersion
    }
  } catch {
    return [pscustomobject][ordered]@{ status = "INVALID"; path = $pathFact.path; identity = $false; reason = "EXECUTABLE_METADATA_UNAVAILABLE" }
  }
}

function Get-RootResidualFacts {
  param([Parameter(Mandatory = $true)][string]$Root)
  $knownInert = @(".dead", "Update.exe", "RELEASES", "packages")
  $residuals = @()
  try {
    foreach ($entry in @(Get-ChildItem -LiteralPath $Root -Force -ErrorAction Stop)) {
      $reparse = (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
      $kind = "UNKNOWN"
      if ($entry.Name -eq $script:LegacyVersionDirectoryName -or $entry.Name -ieq $script:LegacyStubName) { $kind = "ACTIVE" } elseif ($knownInert -contains $entry.Name) { $kind = "INERT" }
      $residualKind = $kind
      if ($reparse) { $residualKind = "UNKNOWN" }
      $residuals += [pscustomobject][ordered]@{
        name = $entry.Name
        path = (Normalize-PathString $entry.FullName)
        kind = $residualKind
        isReparsePoint = $reparse
      }
    }
  } catch {
    $residuals += [pscustomobject][ordered]@{ name = "<inspection>"; path = (Normalize-PathString $Root); kind = "UNKNOWN"; isReparsePoint = $false }
  }
  return ,$residuals
}

function Get-LegacyRootFact {
  param([Parameter(Mandatory = $true)]$Paths)
  $root = Get-PathFact $Paths.legacyRoot
  $stub = Get-ProductExecutableFact $Paths.legacyStub
  $update = Get-PathFact $Paths.legacyUpdate
  $versionDirectory = Get-PathFact $Paths.legacyVersionDirectory
  $versionExecutable = Get-ProductExecutableFact (Join-Path $Paths.legacyVersionDirectory $script:LegacyStubName)
  $residuals = @()
  if ($root.status -eq "FOUND" -and $root.isDirectory) { $residuals = @(Get-RootResidualFacts $root.path) }
  $rootSafe = $false
  if ($root.status -eq "FOUND" -and $root.isDirectory -and -not $root.isReparsePoint) { $rootSafe = (Test-NoReparseTree $root.path).valid }
  $valid = (
    $root.status -eq "FOUND" -and $root.isDirectory -and -not $root.isReparsePoint -and $rootSafe -and
    $stub.status -eq "VALID" -and -not $stub.isDirectory -and -not $stub.isReparsePoint -and
    $update.status -eq "FOUND" -and -not $update.isDirectory -and -not $update.isReparsePoint -and
    $versionDirectory.status -eq "FOUND" -and $versionDirectory.isDirectory -and -not $versionDirectory.isReparsePoint -and
    $versionExecutable.status -eq "VALID"
  )
  $rootStatus = "INVALID"
  if ($root.status -eq "ABSENT") { $rootStatus = "ABSENT" } elseif ($valid) { $rootStatus = "VALID" }
  return [pscustomobject][ordered]@{
    status = $rootStatus
    path = $root.path
    isReparsePoint = [bool]$root.isReparsePoint
    stub = $stub
    update = $update
    versionDirectory = $versionDirectory
    versionExecutable = $versionExecutable
    residuals = $residuals
    unknownResiduals = @($residuals | Where-Object { $_.kind -eq "UNKNOWN" })
  }
}

function Test-ExpectedSquirrelCommand {
  param([AllowNull()][string]$Value, [Parameter(Mandatory = $true)][string]$UpdatePath, [switch]$Quiet)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  $pattern = '^\s*"?'+[regex]::Escape((Normalize-PathString $UpdatePath))+'"?\s+--uninstall'
  if ($Quiet) { $pattern += '\s+-s' }
  $pattern += '\s*$'
  return $Value -match $pattern
}

function Get-ExpectedRegistryIdentity {
  param([Parameter(Mandatory = $true)]$Paths)
  $nsisRoot = [string](Get-Val $Paths "nsisRoot" "")
  $installKey = [string](Get-Val $Paths "nsisInstallRegistryKey" "")
  $uninstallKey = [string](Get-Val $Paths "nsisUninstallRegistryKey" "")
  if ([string]::IsNullOrWhiteSpace($installKey)) { $installKey = "HKCU:\Software\$script:ElectronBuilderNsisGuid" }
  if ([string]::IsNullOrWhiteSpace($uninstallKey)) { $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:ElectronBuilderNsisGuid" }
  $uninstaller = [string](Get-Val $Paths "nsisUninstaller" "")
  if ([string]::IsNullOrWhiteSpace($uninstaller)) { $uninstaller = Normalize-PathString (Join-Path $nsisRoot "Uninstall review-workspace.exe") }
  return [pscustomobject][ordered]@{
    appId = $script:ElectronBuilderAppId
    electronBuilderVersion = $script:ElectronBuilderVersion
    namespace = $script:ElectronBuilderNsisNamespace
    guid = $script:ElectronBuilderNsisGuid
    installRegistryKey = $installKey
    uninstallRegistryKey = $uninstallKey
    installLocation = $nsisRoot
    uninstaller = $uninstaller
    displayName = $script:ProductNameZh
    displayVersion = $script:LegacyVersion
  }
}

function Test-RegistryKeyEqual {
  param([AllowNull()][string]$Left, [Parameter(Mandatory = $true)][string]$Right)
  return (-not [string]::IsNullOrWhiteSpace($Left)) -and [string]::Equals($Left, $Right, [System.StringComparison]::OrdinalIgnoreCase)
}

function New-SafeRegistryFact {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [AllowNull()]$Properties,
    [string]$Status = "PRESENT",
    [AllowNull()][string]$Reason
  )
  $source = $Properties
  $nestedProperties = Get-Val $Properties "properties" $null
  if ($null -ne $nestedProperties) { $source = $nestedProperties }
  $statusValue = ([string]$Status).ToUpperInvariant()
  if ($statusValue -eq "FOUND") { $statusValue = "PRESENT" }
  if ($statusValue -ne "PRESENT" -and $statusValue -ne "ABSENT" -and $statusValue -ne "INVALID") { $statusValue = "INVALID" }
  $hive = [string](Get-Val $Properties "hive" "")
  if ([string]::IsNullOrWhiteSpace($hive) -and $Key -match '^HKCU:\\') { $hive = "HKCU" }
  if ([string]::IsNullOrWhiteSpace($hive) -and $Key -match '^HKLM:\\') { $hive = "HKLM" }
  return [pscustomobject][ordered]@{
    key = $Key
    hive = $hive
    status = $statusValue
    displayName = [string](Get-Val $source "DisplayName" "")
    displayVersion = [string](Get-Val $source "DisplayVersion" "")
    installLocation = [string](Get-Val $source "InstallLocation" "")
    uninstallString = [string](Get-Val $source "UninstallString" "")
    quietUninstallString = [string](Get-Val $source "QuietUninstallString" "")
    reason = $Reason
  }
}

function Get-LiveRegistryFact {
  param([Parameter(Mandatory = $true)][string]$Key)
  if (-not (Test-Path -LiteralPath $Key)) {
    return New-SafeRegistryFact $Key $null -Status "ABSENT" -Reason "REGISTRY_KEY_ABSENT"
  }
  try {
    return New-SafeRegistryFact $Key (Get-ItemProperty -LiteralPath $Key -ErrorAction Stop)
  } catch {
    return New-SafeRegistryFact $Key $null -Status "INVALID" -Reason "REGISTRY_VALUE_INSPECTION_FAILED"
  }
}

function Test-ExpectedNsisCommand {
  param([AllowNull()][string]$Value, [Parameter(Mandatory = $true)][string]$UninstallerPath, [switch]$Quiet)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  $pattern = '^\s*"?'+[regex]::Escape((Normalize-PathString $UninstallerPath))+'"?\s+/currentuser'
  if ($Quiet) { $pattern += '\s+/S' }
  $pattern += '\s*$'
  return $Value -match $pattern
}

function Test-CurrentUserRegistryFact {
  param([Parameter(Mandatory = $true)]$Fact)
  return ([string](Get-Val $Fact "hive" "") -ieq "HKCU") -and ([string](Get-Val $Fact "key" "") -match '^HKCU:\\')
}

function Test-ExpectedSquirrelRegistryFact {
  param([Parameter(Mandatory = $true)]$Fact, [Parameter(Mandatory = $true)]$Paths)
  if ([string](Get-Val $Fact "status" "") -ne "PRESENT") { return $false }
  if (-not (Test-CurrentUserRegistryFact $Fact)) { return $false }
  if (-not (Test-RegistryKeyEqual ([string](Get-Val $Fact "key" "")) ([string](Get-Val $Paths "legacyRegistryKey" "")))) { return $false }
  $displayValid = $script:ProductNames -contains ([string](Get-Val $Fact "displayName" ""))
  $versionValid = [string](Get-Val $Fact "displayVersion" "") -eq $script:LegacyVersion
  $location = [string](Get-Val $Fact "installLocation" "")
  $locationValid = [string]::IsNullOrWhiteSpace($location) -or (Test-PathEqual $location ([string](Get-Val $Paths "legacyRoot" "")))
  $commandsValid = (Test-ExpectedSquirrelCommand ([string](Get-Val $Fact "uninstallString" "")) ([string](Get-Val $Paths "legacyUpdate" ""))) -and (Test-ExpectedSquirrelCommand ([string](Get-Val $Fact "quietUninstallString" "")) ([string](Get-Val $Paths "legacyUpdate" "")) -Quiet)
  return $displayValid -and $versionValid -and $locationValid -and $commandsValid
}

function Test-ExpectedNsisInstallRegistryFact {
  param([Parameter(Mandatory = $true)]$Fact, [Parameter(Mandatory = $true)]$Identity)
  if ([string](Get-Val $Fact "status" "") -ne "PRESENT") { return $false }
  if (-not (Test-CurrentUserRegistryFact $Fact)) { return $false }
  if (-not (Test-RegistryKeyEqual ([string](Get-Val $Fact "key" "")) ([string](Get-Val $Identity "installRegistryKey" "")))) { return $false }
  $location = [string](Get-Val $Fact "installLocation" "")
  return (-not [string]::IsNullOrWhiteSpace($location)) -and (Test-PathEqual $location ([string](Get-Val $Identity "installLocation" "")))
}

function Test-ExpectedNsisUninstallRegistryFact {
  param([Parameter(Mandatory = $true)]$Fact, [Parameter(Mandatory = $true)]$Identity)
  if ([string](Get-Val $Fact "status" "") -ne "PRESENT") { return $false }
  if (-not (Test-CurrentUserRegistryFact $Fact)) { return $false }
  if (-not (Test-RegistryKeyEqual ([string](Get-Val $Fact "key" "")) ([string](Get-Val $Identity "uninstallRegistryKey" "")))) { return $false }
  if ([string](Get-Val $Fact "displayName" "") -cne [string](Get-Val $Identity "displayName" "")) { return $false }
  if ([string](Get-Val $Fact "displayVersion" "") -cne [string](Get-Val $Identity "displayVersion" "")) { return $false }
  $uninstallValid = Test-ExpectedNsisCommand ([string](Get-Val $Fact "uninstallString" "")) ([string](Get-Val $Identity "uninstaller" ""))
  $quietUninstallValid = Test-ExpectedNsisCommand ([string](Get-Val $Fact "quietUninstallString" "")) ([string](Get-Val $Identity "uninstaller" "")) -Quiet
  return $uninstallValid -and $quietUninstallValid
}

function Get-RegistryIdentityInspection {
  param([Parameter(Mandatory = $true)]$Facts, [Parameter(Mandatory = $true)]$Paths)
  $identity = Get-ExpectedRegistryIdentity $Paths
  $safeFacts = @()
  foreach ($fact in @($Facts)) {
    if ($null -eq $fact) { continue }
    $key = [string](Get-Val $fact "key" (Get-Val $fact "keyPath" ""))
    if ([string]::IsNullOrWhiteSpace($key)) {
      $safeFacts += New-SafeRegistryFact "<missing-key>" $null -Status "INVALID" -Reason "REGISTRY_KEY_MISSING"
    } else {
      $factStatus = [string](Get-Val $fact "status" "PRESENT")
      if ([string]::IsNullOrWhiteSpace($factStatus)) { $factStatus = "PRESENT" }
      $safeFacts += New-SafeRegistryFact $key $fact -Status $factStatus -Reason ([string](Get-Val $fact "reason" $null))
    }
  }
  $installFacts = @($safeFacts | Where-Object { Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $identity "installRegistryKey" "")) })
  $installIdentityValid = ($installFacts.Count -eq 1) -and (Test-ExpectedNsisInstallRegistryFact $installFacts[0] $identity)
  $classified = @()
  foreach ($fact in $safeFacts) {
    $key = [string](Get-Val $fact "key" "")
    $classification = "UNRELATED"
    $reason = "KEY_NOT_PRODUCT_IDENTITY"
    if (Test-RegistryKeyEqual $key ([string](Get-Val $Paths "legacyRegistryKey" ""))) {
      if (Test-ExpectedSquirrelRegistryFact $fact $Paths) { $classification = "SQUIRREL_EXPECTED"; $reason = "EXACT_SQUIRREL_IDENTITY" } else { $classification = "INVALID"; $reason = "SQUIRREL_IDENTITY_INVALID" }
    } elseif (Test-RegistryKeyEqual $key ([string](Get-Val $identity "installRegistryKey" ""))) {
      if (Test-ExpectedNsisInstallRegistryFact $fact $identity) { $classification = "NSIS_EXPECTED"; $reason = "EXACT_NSIS_INSTALL_IDENTITY" } else { $classification = "INVALID"; $reason = "NSIS_INSTALL_IDENTITY_INVALID" }
    } elseif (Test-RegistryKeyEqual $key ([string](Get-Val $identity "uninstallRegistryKey" ""))) {
      if (Test-ExpectedNsisUninstallRegistryFact $fact $identity) { $classification = "NSIS_EXPECTED"; $reason = "EXACT_NSIS_UNINSTALL_IDENTITY" } else { $classification = "INVALID"; $reason = "NSIS_UNINSTALL_IDENTITY_INVALID" }
    } elseif ($script:ProductNames -contains ([string](Get-Val $fact "displayName" ""))) {
      $classification = "UNKNOWN_SAME_PRODUCT"
      $reason = "SAME_PRODUCT_UNEXPECTED_REGISTRY_KEY"
    }
    $classified += [pscustomobject][ordered]@{
      classification = $classification
      key = $key
      hive = [string](Get-Val $fact "hive" "")
      displayName = [string](Get-Val $fact "displayName" "")
      displayVersion = [string](Get-Val $fact "displayVersion" "")
      installLocation = [string](Get-Val $fact "installLocation" "")
      reason = $reason
    }
  }
  $legacyMatches = @($classified | Where-Object { (Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $Paths "legacyRegistryKey" ""))) })
  $legacyExpected = @($classified | Where-Object { $_.classification -eq "SQUIRREL_EXPECTED" })
  $unknownCandidates = @($classified | Where-Object { $_.classification -eq "UNKNOWN_SAME_PRODUCT" })
  $invalidCandidates = @($classified | Where-Object { $_.classification -eq "INVALID" })
  $blockingInvalidCandidates = @($invalidCandidates | Where-Object {
    -not (Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $identity "installRegistryKey" ""))) -and
    -not (Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $identity "uninstallRegistryKey" "")))
  })
  $legacyStatus = "INVALID"
  if ($legacyMatches.Count -eq 0) {
    $legacyStatus = "ABSENT"
  } elseif ($unknownCandidates.Count -gt 0) {
    $legacyStatus = "AMBIGUOUS"
  } elseif ($blockingInvalidCandidates.Count -gt 0) {
    $legacyStatus = "INVALID"
  } elseif ($legacyExpected.Count -eq 1) {
    $legacyStatus = "VALID"
  }
  $legacyFact = $null
  if ($legacyMatches.Count -eq 1) { $legacyFact = $safeFacts | Where-Object { Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $Paths "legacyRegistryKey" "")) } | Select-Object -First 1 }
  $legacyRegistration = [pscustomobject][ordered]@{
    status = $legacyStatus
    key = [string](Get-Val $Paths "legacyRegistryKey" "")
    identity = ($legacyStatus -eq "VALID")
    displayName = [string](Get-Val $legacyFact "displayName" "")
    displayVersion = [string](Get-Val $legacyFact "displayVersion" "")
    installLocationPresent = (-not [string]::IsNullOrWhiteSpace([string](Get-Val $legacyFact "installLocation" "")))
    uninstallCommandsValid = ($legacyExpected.Count -eq 1)
    ambiguousCandidates = @($unknownCandidates | ForEach-Object { $_.key })
    invalidCandidates = @($invalidCandidates | ForEach-Object { $_.key })
  }
  return [pscustomobject][ordered]@{
    identity = $identity
    classifications = $classified
    legacyRegistration = $legacyRegistration
    nsisInstallRegistry = [pscustomobject][ordered]@{ key = [string](Get-Val $identity "installRegistryKey" ""); status = if ($installIdentityValid) { "NSIS_EXPECTED" } else { "INVALID" }; installLocation = [string](Get-Val $identity "installLocation" "") }
    nsisUninstallRegistry = [pscustomobject][ordered]@{ key = [string](Get-Val $identity "uninstallRegistryKey" ""); status = if (@($classified | Where-Object { (Test-RegistryKeyEqual ([string](Get-Val $_ "key" "")) ([string](Get-Val $identity "uninstallRegistryKey" ""))) -and $_.classification -eq "NSIS_EXPECTED" }).Count -eq 1) { "NSIS_EXPECTED" } else { "INVALID" } }
    unknownSameProduct = @($unknownCandidates | ForEach-Object { $_.key })
    invalid = @($invalidCandidates | ForEach-Object { $_.key })
  }
}

function Get-LegacyRegistrationFact {
  param([Parameter(Mandatory = $true)]$Paths)
  $registryBase = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  $facts = @(
    (Get-LiveRegistryFact ([string](Get-Val $Paths "legacyRegistryKey" "")))
    (Get-LiveRegistryFact ([string](Get-Val $Paths "nsisInstallRegistryKey" "")))
    (Get-LiveRegistryFact ([string](Get-Val $Paths "nsisUninstallRegistryKey" "")))
  )
  try {
    foreach ($key in @(Get-ChildItem -LiteralPath $registryBase -ErrorAction Stop)) {
      $candidateKey = "$registryBase\$($key.PSChildName)"
      if ((Test-RegistryKeyEqual $candidateKey ([string](Get-Val $Paths "legacyRegistryKey" ""))) -or (Test-RegistryKeyEqual $candidateKey ([string](Get-Val $Paths "nsisUninstallRegistryKey" "")))) { continue }
      try {
        $facts += New-SafeRegistryFact $candidateKey (Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop)
      } catch {
        $facts += New-SafeRegistryFact $candidateKey $null -Status "INVALID" -Reason "REGISTRY_VALUE_INSPECTION_FAILED"
      }
    }
  } catch {
    return [pscustomobject][ordered]@{ status = "INVALID"; key = [string](Get-Val $Paths "legacyRegistryKey" ""); identity = $false; ambiguousCandidates = @(); invalidCandidates = @(); reason = "REGISTRY_ENUMERATION_FAILED" }
  }
  $inspection = Get-RegistryIdentityInspection $facts $Paths
  $legacy = $inspection.legacyRegistration
  return [pscustomobject][ordered]@{
    status = [string](Get-Val $legacy "status" "INVALID")
    key = [string](Get-Val $legacy "key" "")
    identity = [bool](Get-Val $legacy "identity" $false)
    displayName = [string](Get-Val $legacy "displayName" "")
    displayVersion = [string](Get-Val $legacy "displayVersion" "")
    installLocationPresent = [bool](Get-Val $legacy "installLocationPresent" $false)
    uninstallCommandsValid = [bool](Get-Val $legacy "uninstallCommandsValid" $false)
    ambiguousCandidates = @((Get-Val $legacy "ambiguousCandidates" @()))
    invalidCandidates = @((Get-Val $legacy "invalidCandidates" @()))
    registryIdentity = $inspection
  }
}

function Get-LegacyProcessFact {
  param([Parameter(Mandatory = $true)][string]$LegacyRoot)
  try {
    $matches = @()
    foreach ($process in @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)) {
      $executablePath = [string]$process.ExecutablePath
      $commandLine = [string]$process.CommandLine
      $legacy = $false
      $reason = $null
      if (-not [string]::IsNullOrWhiteSpace($executablePath)) {
        if (Test-PathInside $executablePath $LegacyRoot) { $legacy = $true; $reason = "EXECUTABLE_PATH_INSIDE_LEGACY_ROOT" }
      } elseif (Test-StringContainsPath $commandLine $LegacyRoot) {
        $legacy = $true
        $reason = "LEGACY_ROOT_IN_UNVERIFIED_COMMAND_LINE"
      }
      if ($legacy) {
        $safeExecutablePath = $null
        if (-not [string]::IsNullOrWhiteSpace($executablePath)) { $safeExecutablePath = Normalize-PathString $executablePath }
        $matches += [pscustomobject][ordered]@{
          executablePath = $safeExecutablePath
          commandLineObserved = (-not [string]::IsNullOrWhiteSpace($commandLine))
          reason = $reason
        }
      }
    }
    return [pscustomobject][ordered]@{ status = "VALID"; count = $matches.Count; entries = $matches }
  } catch {
    return [pscustomobject][ordered]@{ status = "INVALID"; count = 0; entries = @(); reason = "PROCESS_INSPECTION_FAILED" }
  }
}

function Get-ShortcutFact {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$LegacyRoot, [Parameter(Mandatory = $true)][string]$NsisRoot)
  $pathFact = Get-PathFact $Path
  if ($pathFact.status -eq "ABSENT") { return [pscustomobject][ordered]@{ status = "ABSENT"; path = $pathFact.path; targetPath = $null } }
  if ($pathFact.status -ne "FOUND" -or $pathFact.isDirectory -or $pathFact.isReparsePoint) { return [pscustomobject][ordered]@{ status = "INVALID"; path = $pathFact.path; targetPath = $null } }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($pathFact.path)
    $target = [string]$shortcut.TargetPath
    if ([string]::IsNullOrWhiteSpace($target) -or -not [System.IO.Path]::IsPathRooted($target)) {
      return [pscustomobject][ordered]@{ status = "OTHER_TARGET"; path = $pathFact.path; targetPath = $target }
    }
    $canonicalTarget = Normalize-PathString $target
    $kind = "OTHER_TARGET"
    if (Test-PathInside $canonicalTarget $LegacyRoot) { $kind = "LEGACY_TARGET" } elseif (Test-PathInside $canonicalTarget $NsisRoot) { $kind = "NSIS_TARGET" }
    return [pscustomobject][ordered]@{ status = $kind; path = $pathFact.path; targetPath = $canonicalTarget }
  } catch {
    return [pscustomobject][ordered]@{ status = "INVALID"; path = $pathFact.path; targetPath = $null; reason = "SHORTCUT_RESOLUTION_FAILED" }
  }
}

function Get-LiveSnapshot {
  $paths = Get-ExpectedPaths
  $root = Get-LegacyRootFact $paths
  $userData = Get-PathFact $paths.userData
  $legacyRegistration = Get-LegacyRegistrationFact $paths
  return [pscustomobject][ordered]@{
    paths = $paths
    legacyRoot = $root
    legacyRegistration = $legacyRegistration
    registryIdentity = Get-Val $legacyRegistration "registryIdentity" $null
    legacyProcesses = Get-LegacyProcessFact $paths.legacyRoot
    desktopShortcut = Get-ShortcutFact $paths.desktopShortcut $paths.legacyRoot $paths.nsisRoot
    startMenuShortcut = Get-ShortcutFact $paths.startMenuShortcut $paths.legacyRoot $paths.nsisRoot
    userData = [pscustomobject][ordered]@{ status = $userData.status; path = $userData.path; isReparsePoint = [bool]$userData.isReparsePoint }
    nsisRoot = Get-PathFact $paths.nsisRoot
    nsisExecutable = Get-PathFact $paths.nsisExecutable
    ambiguities = @()
    unknownPaths = @($root.unknownResiduals | ForEach-Object { $_.path })
  }
}

function Read-SnapshotFixture {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "SNAPSHOT_NOT_FOUND" }
  $fixture = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq (Get-Val $fixture "paths" $null)) { throw "SNAPSHOT_PATHS_MISSING" }
  $registryFacts = Get-Val $fixture "registryFacts" $null
  if ($null -ne $registryFacts) {
    $inspection = Get-RegistryIdentityInspection @($registryFacts) (Get-Val $fixture "paths" $null)
    $fixture | Add-Member -MemberType NoteProperty -Name registryIdentity -Value $inspection -Force
    $fixture | Add-Member -MemberType NoteProperty -Name legacyRegistration -Value $inspection.legacyRegistration -Force
  }
  return $fixture
}

function Add-Reason {
  param([Parameter(Mandatory = $true)]$List, [Parameter(Mandatory = $true)][string]$Reason)
  if (-not ($List -contains $Reason)) { [void]$List.Add($Reason) }
}

function New-Action {
  param([Parameter(Mandatory = $true)][string]$Type, [Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Reason)
  return [pscustomobject][ordered]@{ type = $Type; path = $Path; reason = $Reason }
}

function Get-ActiveState {
  param([Parameter(Mandatory = $true)]$Snapshot)
  $items = @()
  $root = Get-Val $Snapshot "legacyRoot" $null
  if ([string](Get-Val (Get-Val $Snapshot "legacyRegistration" $null) "status" "") -eq "VALID") { $items += "legacy-registration" }
  if ([string](Get-Val (Get-Val $root "stub" $null) "status" "") -eq "VALID") { $items += "legacy-root-stub" }
  if ([string](Get-Val (Get-Val $root "versionExecutable" $null) "status" "") -eq "VALID") { $items += "legacy-app-0.2.4" }
  if ([int](Get-Val (Get-Val $Snapshot "legacyProcesses" $null) "count" 0) -gt 0) { $items += "legacy-process" }
  foreach ($shortcut in @((Get-Val $Snapshot "desktopShortcut" $null), (Get-Val $Snapshot "startMenuShortcut" $null))) {
    if ([string](Get-Val $shortcut "status" "") -eq "LEGACY_TARGET") { $items += "legacy-shortcut" }
  }
  return [pscustomobject][ordered]@{ present = ($items.Count -gt 0); items = $items }
}

function Get-CleanupPlan {
  param([Parameter(Mandatory = $true)]$Snapshot)
  $reasons = New-Object 'System.Collections.Generic.List[string]'
  $actions = @()
  $paths = Get-Val $Snapshot "paths" $null
  $root = Get-Val $Snapshot "legacyRoot" $null
  $registration = Get-Val $Snapshot "legacyRegistration" $null
  if ($null -eq $paths -or $null -eq $root -or $null -eq $registration) {
    Add-Reason $reasons "SNAPSHOT_INCOMPLETE"
  } else {
    $legacyRoot = [string](Get-Val $paths "legacyRoot" "")
    $nsisRoot = [string](Get-Val $paths "nsisRoot" "")
    $userData = [string](Get-Val $paths "userData" "")
    try {
      if (-not (Test-PathEqual ([string](Get-Val $root "path" "")) $legacyRoot)) { Add-Reason $reasons "LEGACY_ROOT_MISMATCH" }
      if ((Test-PathUnderOrEqual $legacyRoot $userData) -or (Test-PathUnderOrEqual $userData $legacyRoot)) { Add-Reason $reasons "USERDATA_BOUNDARY_COLLISION" }
      if ((Test-PathUnderOrEqual $legacyRoot $nsisRoot) -or (Test-PathUnderOrEqual $nsisRoot $legacyRoot)) { Add-Reason $reasons "NSIS_LEGACY_ROOT_COLLISION" }
    } catch { Add-Reason $reasons "PATH_NORMALIZATION_FAILED" }
    if ([string](Get-Val $root "status" "") -ne "VALID") { Add-Reason $reasons "LEGACY_ROOT_IDENTITY_INVALID" }
    if ([bool](Get-Val $root "isReparsePoint" $false)) { Add-Reason $reasons "LEGACY_ROOT_REPARSE_POINT" }
    if ([string](Get-Val (Get-Val $root "stub" $null) "status" "") -ne "VALID") { Add-Reason $reasons "LEGACY_ROOT_STUB_INVALID" }
    if ([bool](Get-Val (Get-Val $root "stub" $null) "isReparsePoint" $false)) { Add-Reason $reasons "LEGACY_ROOT_STUB_REPARSE_POINT" }
    if ([string](Get-Val (Get-Val $root "versionDirectory" $null) "status" "") -ne "FOUND") { Add-Reason $reasons "LEGACY_VERSION_DIRECTORY_INVALID" }
    if ([bool](Get-Val (Get-Val $root "versionDirectory" $null) "isReparsePoint" $false)) { Add-Reason $reasons "LEGACY_VERSION_DIRECTORY_REPARSE_POINT" }
    if ([string](Get-Val (Get-Val $root "versionExecutable" $null) "status" "") -ne "VALID") { Add-Reason $reasons "LEGACY_VERSION_IDENTITY_INVALID" }
    if ([string](Get-Val $registration "status" "") -ne "VALID") { Add-Reason $reasons "LEGACY_REGISTRATION_INVALID" }
    $registryIdentity = Get-Val $Snapshot "registryIdentity" $null
    if ($null -ne $registryIdentity) {
      if ([string](Get-Val (Get-Val $registryIdentity "nsisInstallRegistry" $null) "status" "") -ne "NSIS_EXPECTED") { Add-Reason $reasons "NSIS_INSTALL_REGISTRY_IDENTITY_INVALID" }
      if ([string](Get-Val (Get-Val $registryIdentity "nsisUninstallRegistry" $null) "status" "") -ne "NSIS_EXPECTED") { Add-Reason $reasons "NSIS_UNINSTALL_REGISTRY_IDENTITY_INVALID" }
    }
    if ([string](Get-Val (Get-Val $Snapshot "legacyProcesses" $null) "status" "") -ne "VALID") { Add-Reason $reasons "LEGACY_PROCESS_INSPECTION_INVALID" }
    if ([int](Get-Val (Get-Val $Snapshot "legacyProcesses" $null) "count" 0) -gt 0) { Add-Reason $reasons "LEGACY_APP_RUNNING" }
    $userDataFact = Get-Val $Snapshot "userData" $null
    $nsisRootFact = Get-Val $Snapshot "nsisRoot" $null
    $nsisExecutableFact = Get-Val $Snapshot "nsisExecutable" $null
    if ([string](Get-Val $userDataFact "status" "") -ne "FOUND") {
      Add-Reason $reasons "USERDATA_NOT_PRESENT"
    } elseif (-not (Test-PathEqual ([string](Get-Val $userDataFact "path" "")) $userData)) {
      Add-Reason $reasons "USERDATA_PATH_MISMATCH"
    }
    if ([bool](Get-Val $userDataFact "isReparsePoint" $false)) {
      Add-Reason $reasons "USERDATA_REPARSE_POINT"
    }
    if ([string](Get-Val $nsisRootFact "status" "") -ne "FOUND" -or -not [bool](Get-Val $nsisRootFact "isDirectory" $false)) {
      Add-Reason $reasons "NSIS_ROOT_NOT_PRESENT"
    } elseif ([bool](Get-Val $nsisRootFact "isReparsePoint" $false)) {
      Add-Reason $reasons "NSIS_ROOT_REPARSE_POINT"
    } elseif (-not (Test-PathEqual ([string](Get-Val $nsisRootFact "path" "")) $nsisRoot)) {
      Add-Reason $reasons "NSIS_ROOT_MISMATCH"
    }
    if ([string](Get-Val $nsisExecutableFact "status" "") -ne "FOUND" -or [bool](Get-Val $nsisExecutableFact "isDirectory" $false)) {
      Add-Reason $reasons "NSIS_EXECUTABLE_NOT_PRESENT"
    } elseif ([bool](Get-Val $nsisExecutableFact "isReparsePoint" $false)) {
      Add-Reason $reasons "NSIS_EXECUTABLE_REPARSE_POINT"
    } elseif (-not (Test-PathEqual ([string](Get-Val $nsisExecutableFact "path" "")) ([string](Get-Val $paths "nsisExecutable" "")))) {
      Add-Reason $reasons "NSIS_EXECUTABLE_MISMATCH"
    }
    foreach ($value in @((Get-Val $Snapshot "ambiguities" @()))) { Add-Reason $reasons ([string]$value) }
    foreach ($value in @((Get-Val $Snapshot "unknownPaths" @()))) { Add-Reason $reasons "UNKNOWN_PATH_STATE" }
    foreach ($value in @((Get-Val $root "unknownResiduals" @()))) { Add-Reason $reasons "UNKNOWN_LEGACY_RESIDUAL" }

    $versionPath = [string](Get-Val (Get-Val $root "versionDirectory" $null) "path" "")
    $stubPath = [string](Get-Val (Get-Val $root "stub" $null) "path" "")
    if ($versionPath -and -not (Test-PathEqual $versionPath ([string](Get-Val $paths "legacyVersionDirectory" "")))) { Add-Reason $reasons "LEGACY_VERSION_PATH_MISMATCH" }
    if ($stubPath -and -not (Test-PathEqual $stubPath ([string](Get-Val $paths "legacyStub" "")))) { Add-Reason $reasons "LEGACY_STUB_PATH_MISMATCH" }
    if ([string](Get-Val $registration "key" "") -and -not [string]::Equals([string](Get-Val $registration "key" ""), [string](Get-Val $paths "legacyRegistryKey" ""), [System.StringComparison]::OrdinalIgnoreCase)) { Add-Reason $reasons "LEGACY_REGISTRY_KEY_MISMATCH" }

    foreach ($shortcut in @(
      [pscustomobject][ordered]@{ name = "desktop"; fact = (Get-Val $Snapshot "desktopShortcut" $null); expected = [string](Get-Val $paths "desktopShortcut" "") },
      [pscustomobject][ordered]@{ name = "startMenu"; fact = (Get-Val $Snapshot "startMenuShortcut" $null); expected = [string](Get-Val $paths "startMenuShortcut" "") }
    )) {
      $fact = $shortcut.fact
      $status = [string](Get-Val $fact "status" "")
      if ($status -eq "INVALID") {
        Add-Reason $reasons (("{0}_SHORTCUT_INVALID" -f $shortcut.name).ToUpperInvariant())
      } elseif ($status -eq "LEGACY_TARGET") {
        $shortcutPath = [string](Get-Val $fact "path" "")
        $targetPath = [string](Get-Val $fact "targetPath" "")
        if (-not (Test-PathEqual $shortcutPath $shortcut.expected)) {
          Add-Reason $reasons (("{0}_SHORTCUT_PATH_NOT_EXPECTED" -f $shortcut.name).ToUpperInvariant())
        } elseif (-not (Test-PathInside $targetPath $legacyRoot)) {
          Add-Reason $reasons (("{0}_SHORTCUT_TARGET_NOT_LEGACY" -f $shortcut.name).ToUpperInvariant())
        } elseif ((Test-PathUnderOrEqual $shortcutPath $userData) -or (Test-PathUnderOrEqual $shortcutPath $nsisRoot)) {
          Add-Reason $reasons (("{0}_SHORTCUT_BOUNDARY_COLLISION" -f $shortcut.name).ToUpperInvariant())
        } else {
          $actions += New-Action "remove-file" $shortcutPath ("remove legacy-target {0} shortcut" -f $shortcut.name)
        }
      }
    }
    if ($versionPath -and (Test-PathEqual $versionPath ([string](Get-Val $paths "legacyVersionDirectory" "")))) { $actions += New-Action "remove-directory" $versionPath "remove validated active app-0.2.4 payload" }
    if ($stubPath -and (Test-PathEqual $stubPath ([string](Get-Val $paths "legacyStub" "")))) { $actions += New-Action "remove-file" $stubPath "remove validated active Squirrel root stub" }
    if ([string](Get-Val $registration "status" "") -eq "VALID") { $actions += New-Action "remove-registry-key" ([string](Get-Val $paths "legacyRegistryKey" "")) "remove exact legacy Squirrel uninstall registration" }
  }
  $reasonsArray = $reasons.ToArray()
  if ($reasonsArray.Count -gt 0) { $actions = @() }
  return [pscustomobject][ordered]@{ cleanupEligible = ($reasonsArray.Count -eq 0 -and $actions.Count -gt 0); blockingReasons = $reasonsArray; actions = $actions }
}

function Get-Result {
  param([Parameter(Mandatory = $true)]$Snapshot, [Parameter(Mandatory = $true)]$Plan, [Parameter(Mandatory = $true)][string]$Mode)
  $root = Get-Val $Snapshot "legacyRoot" $null
  $processes = Get-Val $Snapshot "legacyProcesses" $null
  $residuals = @((Get-Val $root "residuals" @()))
  $activeState = Get-ActiveState $Snapshot
  $inertResiduals = @()
  if (-not $activeState.present) { $inertResiduals = @($residuals | Where-Object { $_.kind -eq "INERT" }) }
  $legacyVersionValue = "unexpected"
  if ([string](Get-Val (Get-Val $root "versionExecutable" $null) "status" "") -eq "VALID") { $legacyVersionValue = $script:LegacyVersion }
  return [ordered]@{
    schemaVersion = "m3-squirrel-nsis-migration-1"
    mode = $Mode
    defaultMode = "NON-DESTRUCTIVE"
    cleanupPerformed = $false
    legacyRoot = if ([string](Get-Val $root "status" "INVALID") -eq "VALID") { "FOUND" } else { [string](Get-Val $root "status" "INVALID") }
    legacyRootPath = [string](Get-Val $root "path" "")
    legacyRegistration = if ([string](Get-Val (Get-Val $Snapshot "legacyRegistration" $null) "status" "INVALID") -eq "VALID") { "FOUND" } else { [string](Get-Val (Get-Val $Snapshot "legacyRegistration" $null) "status" "INVALID") }
    registryIdentity = Get-Val $Snapshot "registryIdentity" $null
    legacyVersion = $legacyVersionValue
    legacyProcesses = [ordered]@{ count = [int](Get-Val $processes "count" 0); entries = @((Get-Val $processes "entries" @())) }
    desktopShortcut = [string](Get-Val (Get-Val $Snapshot "desktopShortcut" $null) "status" "INVALID")
    startMenuShortcut = [string](Get-Val (Get-Val $Snapshot "startMenuShortcut" $null) "status" "INVALID")
    userData = [ordered]@{ status = if ([string](Get-Val (Get-Val $Snapshot "userData" $null) "status" "INVALID") -eq "FOUND") { "PRESENT" } else { [string](Get-Val (Get-Val $Snapshot "userData" $null) "status" "INVALID") }; path = [string](Get-Val (Get-Val $Snapshot "userData" $null) "path" "") }
    nsisRoot = [string](Get-Val (Get-Val $Snapshot "nsisRoot" $null) "status" "INVALID")
    nsisExecutable = [string](Get-Val (Get-Val $Snapshot "nsisExecutable" $null) "status" "INVALID")
    cleanupEligible = [bool]$Plan.cleanupEligible
    blockingReasons = @($Plan.blockingReasons)
    cleanupPlan = @($Plan.actions)
    activeLegacyState = $activeState
    legacyResiduals = $residuals
    inertResiduals = $inertResiduals
    unknownResiduals = @($residuals | Where-Object { $_.kind -eq "UNKNOWN" })
  }
}

function Assert-SafeLegacyDeletion {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Paths, [switch]$Directory)
  if (-not (Test-PathEqual $Path $Paths.legacyVersionDirectory) -and -not (Test-PathEqual $Path $Paths.legacyStub)) { throw "DELETION_TARGET_NOT_ALLOWLISTED" }
  if (-not (Test-PathInside $Path $Paths.legacyRoot)) { throw "DELETION_TARGET_OUTSIDE_LEGACY_ROOT" }
  if ((Test-PathUnderOrEqual $Path $Paths.userData) -or (Test-PathUnderOrEqual $Path $Paths.nsisRoot)) { throw "DELETION_BOUNDARY_COLLISION" }
  $fact = Get-PathFact $Path
  if ($fact.status -ne "FOUND" -or $fact.isReparsePoint) { throw "DELETION_TARGET_CHANGED" }
  if ($Directory -and -not $fact.isDirectory) { throw "DELETION_DIRECTORY_EXPECTED" }
  if (-not $Directory -and $fact.isDirectory) { throw "DELETION_FILE_EXPECTED" }
  if (-not (Test-NoReparseTree $Path).valid) { throw "DELETION_REPARSE_POINT_OR_TREE_FAILURE" }
}

function Invoke-ValidatedCleanup {
  param([Parameter(Mandatory = $true)]$Snapshot, [Parameter(Mandatory = $true)]$Plan)
  $paths = $Snapshot.paths
  $performed = @()
  try {
    foreach ($action in @($Plan.actions)) {
      switch ([string]$action.type) {
        "remove-directory" {
          Assert-SafeLegacyDeletion $action.path $paths -Directory
          $versionExecutable = Get-ProductExecutableFact (Join-Path $action.path $script:LegacyStubName)
          if ($versionExecutable.status -ne "VALID") { throw "LEGACY_VERSION_IDENTITY_CHANGED" }
          Remove-Item -LiteralPath $action.path -Recurse -Force -Confirm:$false
        }
        "remove-file" {
          if ((Test-PathEqual $action.path $paths.desktopShortcut) -or (Test-PathEqual $action.path $paths.startMenuShortcut)) {
            $shortcut = Get-ShortcutFact $action.path $paths.legacyRoot $paths.nsisRoot
            if ($shortcut.status -ne "LEGACY_TARGET" -or -not (Test-PathInside $shortcut.targetPath $paths.legacyRoot)) { throw "SHORTCUT_TARGET_CHANGED" }
            $fact = Get-PathFact $action.path
            if ($fact.status -ne "FOUND" -or $fact.isDirectory -or $fact.isReparsePoint) { throw "SHORTCUT_DELETION_TARGET_CHANGED" }
            Remove-Item -LiteralPath $action.path -Force -Confirm:$false
          } else {
            Assert-SafeLegacyDeletion $action.path $paths
            $stub = Get-ProductExecutableFact $action.path
            if ($stub.status -ne "VALID") { throw "LEGACY_STUB_IDENTITY_CHANGED" }
            Remove-Item -LiteralPath $action.path -Force -Confirm:$false
          }
        }
        "remove-registry-key" {
          if (-not [string]::Equals([string]$action.path, [string]$paths.legacyRegistryKey, [System.StringComparison]::OrdinalIgnoreCase)) { throw "REGISTRY_DELETION_TARGET_NOT_ALLOWLISTED" }
          $liveRegistration = Get-LegacyRegistrationFact $paths
          if ($liveRegistration.status -ne "VALID") { throw "LEGACY_REGISTRATION_CHANGED" }
          $liveRegistryIdentity = Get-Val $liveRegistration "registryIdentity" $null
          if ($null -eq $liveRegistryIdentity -or [string](Get-Val (Get-Val $liveRegistryIdentity "nsisInstallRegistry" $null) "status" "") -ne "NSIS_EXPECTED" -or [string](Get-Val (Get-Val $liveRegistryIdentity "nsisUninstallRegistry" $null) "status" "") -ne "NSIS_EXPECTED") { throw "NSIS_REGISTRY_IDENTITY_CHANGED" }
          Remove-Item -LiteralPath $paths.legacyRegistryKey -Recurse -Force -Confirm:$false
        }
        default { throw "UNKNOWN_CLEANUP_ACTION" }
      }
      $performed += [string]$action.path
    }
    return [pscustomobject][ordered]@{ success = $true; performed = $performed; postSnapshot = (Get-LiveSnapshot); error = $null }
  } catch {
    return [pscustomobject][ordered]@{ success = $false; performed = $performed; postSnapshot = $null; error = $_.Exception.Message }
  }
}

function Write-Json {
  param([Parameter(Mandatory = $true)]$Value)
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 20 -Compress))
}

try {
  if ($SnapshotPath -and $ExecuteCleanup) {
    Write-Json ([ordered]@{
      schemaVersion = "m3-squirrel-nsis-migration-1"
      mode = "cleanup"
      defaultMode = "NON-DESTRUCTIVE"
      cleanupPerformed = $false
      cleanupEligible = $false
      blockingReasons = @("SNAPSHOT_CLEANUP_FORBIDDEN")
    })
    exit 2
  }
  $snapshot = $null
  if ($SnapshotPath) { $snapshot = Read-SnapshotFixture $SnapshotPath } else { $snapshot = Get-LiveSnapshot }
  $plan = Get-CleanupPlan $snapshot
  $executionMode = "inspect"
  if ($ExecuteCleanup) { $executionMode = "cleanup" }
  $result = Get-Result $snapshot $plan $executionMode
  if (-not $ExecuteCleanup) {
    Write-Json $result
    exit 0
  }
  if (-not $Stage1Verified) {
    $result.cleanupEligible = $false
    $result.blockingReasons = @($result.blockingReasons + "STAGE1_VERIFICATION_REQUIRED")
    Write-Json $result
    exit 2
  }
  if (-not $plan.cleanupEligible) {
    Write-Json $result
    exit 2
  }
  $execution = Invoke-ValidatedCleanup $snapshot $plan
  $result.cleanupPerformed = [bool]$execution.success
  $result.cleanupActionsPerformed = @($execution.performed)
  if (-not $execution.success) {
    $result.cleanupError = $execution.error
    $result.cleanupOutcome = "PARTIAL_OR_FAILED"
    Write-Json $result
    exit 3
  }
  $post = Get-Result $execution.postSnapshot (Get-CleanupPlan $execution.postSnapshot) "post-cleanup"
  $result.postCleanup = $post
  if ($post.activeLegacyState.present) {
    $result.cleanupOutcome = "ACTIVE_LEGACY_STATE_REMAINS"
    Write-Json $result
    exit 3
  }
  if (@($post.unknownResiduals).Count -gt 0) {
    $result.cleanupOutcome = "UNKNOWN_RESIDUAL_REMAINS"
    Write-Json $result
    exit 3
  }
  $result.cleanupOutcome = "ACTIVE_REMOVED"
  if (@($post.inertResiduals).Count -gt 0) { $result.cleanupOutcome = "ACTIVE_REMOVED_INERT_RESIDUAL_RECORDED" }
  Write-Json $result
  exit 0
} catch {
  $failureMode = "inspect"
  if ($ExecuteCleanup) { $failureMode = "cleanup" }
  Write-Json ([ordered]@{
    schemaVersion = "m3-squirrel-nsis-migration-1"
    mode = $failureMode
    defaultMode = "NON-DESTRUCTIVE"
    cleanupPerformed = $false
    cleanupEligible = $false
    blockingReasons = @([string]$_.Exception.Message)
  })
  exit 1
}
