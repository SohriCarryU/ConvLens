$ErrorActionPreference = 'Stop'
if ($env:CONVLENS_SIGNING_MODE -ne 'signed') { throw 'Signature verification requires signed mode' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$files = @(
  "release/ConvLens-$version-Setup-x64.exe",
  "release/ConvLens-$version-Portable-x64.exe",
  'release/win-unpacked/ConvLens.exe'
)
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/signtool.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
if (-not $signtool) { throw 'Windows SDK signtool.exe is required' }
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed file: $file" }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $file ($($signature.Status))" }
  if (-not $signature.TimeStamperCertificate) { throw "Missing trusted timestamp: $file" }
  if (($env:WINDOWS_SIGNING_PROVIDER -eq 'pfx') -or (-not $env:WINDOWS_SIGNING_PROVIDER)) {
    if (-not $env:WIN_CERT_SHA1 -or $signature.SignerCertificate.Thumbprint -ne $env:WIN_CERT_SHA1) {
      throw "Unexpected certificate thumbprint: $file"
    }
  } elseif ($env:WINDOWS_SIGNING_PROVIDER -eq 'azure') {
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if (-not $env:WIN_PUBLISHER_NAME -or $publisher -cne $env:WIN_PUBLISHER_NAME) {
      throw "Unexpected signing publisher: $file"
    }
  } else { throw 'Unknown Windows signing provider' }
  & $signtool.FullName verify /pa /all /tw $file
  if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed: $file" }
}
