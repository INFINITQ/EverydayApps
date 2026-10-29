<#
.SYNOPSIS
  Folio's network lock: a private WebView2 runtime for Folio that Windows Firewall blocks.

.DESCRIPTION
  Folio's apps draw their window with WebView2. WebView2's own browser process sends
  diagnostic data to Microsoft outside anything an app can control (docs/adr/0005). This
  script gives Folio a private copy of the runtime and blocks that copy, and only that copy,
  in Windows Firewall. Other apps that use WebView2 (Teams, Outlook...) are not affected.

  -Install    (administrator) Puts Windows' current WebView2 runtime in
              C:\Program Files\Folio\WebView2Runtime\current, as hard links (no extra disk
              space; files are copied instead, about 870 MB, if linking fails), and adds the
              firewall rule. Run it again after Windows updates WebView2 to move Folio to the
              new version. Close all Folio apps first.
  -Status     Shows what is set up. No administrator needed.
  -Uninstall  (administrator) Removes the firewall rule and the private runtime. Folio then
              falls back to the shared WebView2 and shows that the lock is off.

  Nothing is downloaded: the runtime comes from the copy Windows already keeps updated.

.EXAMPLE
  # In PowerShell opened with "Run as administrator", from the repository folder:
  powershell -ExecutionPolicy Bypass -File tools\network-lock.ps1 -Install
#>
param([switch]$Install, [switch]$Status, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
# Must match RULE_NAME in crates/folio-core/src/netlock.rs.
$RuleName = 'Folio: block private WebView2'
$Root = Join-Path $env:ProgramFiles 'Folio\WebView2Runtime'
$Current = Join-Path $Root 'current'
$Exe = Join-Path $Current 'msedgewebview2.exe'
$SystemBase = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'

function Get-SystemRuntime {
  Get-ChildItem $SystemBase -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+(\.\d+){3}$' -and (Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')) } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
}

function Assert-Admin {
  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from PowerShell opened with "Run as administrator".'
  }
}

function Assert-FolioClosed {
  $running = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Current, [StringComparison]::OrdinalIgnoreCase) }
  if ($running) { throw 'A Folio app is still running. Close all Folio apps, then run this again.' }
}

function Show-Status {
  $system = Get-SystemRuntime
  if (Test-Path $Exe) {
    $info = Get-Content (Join-Path $Current 'folio-runtime.json') -Raw | ConvertFrom-Json
    Write-Host "Private runtime: WebView2 $($info.version) ($($info.mode)), at $Current"
    if ($system -and [version]$system.Name -gt [version]$info.version) {
      Write-Host "  Windows has a newer WebView2 ($($system.Name)). Run -Install again to update Folio's copy." -ForegroundColor Yellow
    }
  } else {
    Write-Host 'Private runtime: not installed. Folio uses the shared WebView2.' -ForegroundColor Yellow
  }
  $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  if ($rule) {
    $program = ($rule | Get-NetFirewallApplicationFilter).Program
    Write-Host "Firewall rule: enabled=$($rule.Enabled), $($rule.Direction) $($rule.Action), program $program"
  } else {
    Write-Host 'Firewall rule: missing.' -ForegroundColor Yellow
  }
}

if ($Install) {
  Assert-Admin
  $system = Get-SystemRuntime
  if (-not $system) { throw "No WebView2 runtime found in $SystemBase." }
  if (Test-Path $Current) { Assert-FolioClosed }

  Write-Host "Using Windows' WebView2 $($system.Name)."
  $staging = Join-Path $Root "staging-$($system.Name)"
  if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  $mode = 'hard links'
  $count = 0
  foreach ($file in Get-ChildItem -LiteralPath $system.FullName -Recurse -File) {
    $relative = $file.FullName.Substring($system.FullName.Length).TrimStart('\')
    $target = Join-Path $staging $relative
    $folder = Split-Path $target
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
    try {
      New-Item -ItemType HardLink -Path $target -Target $file.FullName -ErrorAction Stop | Out-Null
    } catch {
      Copy-Item -LiteralPath $file.FullName -Destination $target
      $mode = 'copied'
    }
    $count++
  }
  Write-Host "  $count files ($mode)."

  [ordered]@{ version = $system.Name; mode = $mode; installed = (Get-Date).ToString('s') } |
    ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $staging 'folio-runtime.json')

  if (Test-Path $Current) { Remove-Item -LiteralPath $Current -Recurse -Force }
  Rename-Item -LiteralPath $staging -NewName 'current'

  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $RuleName `
    -Description "Blocks Folio's private copy of WebView2 from the network (Folio docs/adr/0005)." `
    -Direction Outbound -Action Block -Program $Exe -Profile Any -Enabled True | Out-Null

  Write-Host 'Done: Folio now uses its own WebView2, and Windows Firewall blocks it.' -ForegroundColor Green
  Show-Status
} elseif ($Uninstall) {
  Assert-Admin
  if (Test-Path $Current) { Assert-FolioClosed }
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (Test-Path $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
  Write-Host 'Removed the firewall rule and the private runtime. Folio falls back to the shared WebView2.'
} else {
  Show-Status
  if (-not $Status) {
    Write-Host ''
    Write-Host 'Set up or update:  run "tools\network-lock.ps1 -Install" in PowerShell opened as administrator.'
  }
}
