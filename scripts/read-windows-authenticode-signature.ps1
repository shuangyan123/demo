param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
)

Import-Module Microsoft.PowerShell.Security -ErrorAction Stop

$signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
if ($null -eq $signature) {
    throw "Get-AuthenticodeSignature returned no result for $LiteralPath"
}

[ordered]@{
    status = [string]$signature.Status
    signerCertificatePresent = $null -ne $signature.SignerCertificate
    timestampSignerPresent = $null -ne $signature.TimeStamperCertificate
} | ConvertTo-Json -Compress
