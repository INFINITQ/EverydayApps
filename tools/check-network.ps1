<#
.SYNOPSIS
  Proves that a Folio build makes no network connections.

.DESCRIPTION
  Starts the app, hands it the given files (through a second launch, as Explorer would),
  then watches every process that belongs to it for -Seconds:
    - the app itself and its child processes,
    - every msedgewebview2.exe whose command line names it (--webview-exe-name=<exe>),
      which includes WebView2's renderer, GPU, network-service and crash-handler processes.
  Any TCP connection or UDP endpoint owned by those processes that isn't on the loopback
  address fails the run. Loopback sockets are listed as warnings.

  A visible run won't start while the app is already open (the files would go to that copy),
  and puts the app's recent-files list back afterwards. A -Background run uses a data folder
  of its own, deleted afterwards.

  Polling can miss a connection that opens and closes within half a second, and DNS lookups
  are made by Windows' DNS Client service, not by the app. With -Etw (run as administrator)
  the script also records Windows' own Kernel-Network and DNS-Client events, which attribute
  every connection and lookup to the process that made it.

.EXAMPLE
  powershell -File tools\check-network.ps1 -Exe target\release\folio-pdf.exe -Files fixtures\pdf\*.pdf

.EXAMPLE
  # Debug build, window kept hidden, with a data folder of its own (both only work in debug
  # builds):
  powershell -File tools\check-network.ps1 -Exe target\debug\folio-hello.exe -Background -Seconds 30
#>
param(
  [Parameter(Mandatory)] [string]$Exe,
  [string[]]$Files = @(),
  [int]$Seconds = 60,
  [switch]$Etw,
  [switch]$Background,
  # The app's data folder, whose recent-files list is put back as it was after a visible run
  # (found from the exe name for Folio's own apps).
  [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Exe).Path
$exeName = [IO.Path]::GetFileName($exePath)
$fileList = @($Files | ForEach-Object { Resolve-Path $_ } | ForEach-Object { $_.Path })
$testData = $null
$recentFile = $null
$recentBefore = $null
if ($Background) {
  # A hidden debug run keeps its data in a folder of its own (FOLIO_TEST_DATA_DIR): it never
  # touches the installed app's data, and never hands files to a running copy.
  $env:FOLIO_BACKGROUND = '1'
  $testData = Join-Path ([IO.Path]::GetTempPath()) "folio-audit-data-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  New-Item -ItemType Directory -Path $testData | Out-Null
  $env:FOLIO_TEST_DATA_DIR = $testData
} else {
  # A visible run opens the files the way Explorer would. With the app already open they'd go to
  # that copy, and the audit would watch nothing.
  $running = @(Get-CimInstance Win32_Process -Filter "Name='$exeName'" | Where-Object { $_.ExecutablePath -eq $exePath })
  if ($running.Count -gt 0) { throw "Close $exeName first: the audit starts a copy of its own." }
  if (-not $DataDir) {
    $known = @{ 'folio-pdf.exe' = 'app.folio.pdf'; 'folio-slides.exe' = 'app.folio.slides'; 'folio-hello.exe' = 'dev.folio.hello' }
    if ($known.ContainsKey($exeName)) { $DataDir = Join-Path $env:LOCALAPPDATA $known[$exeName] }
  }
  # Opening the test files adds them to recent files; the list is put back afterwards.
  if ($DataDir) {
    $recentFile = Join-Path $DataDir 'recent.json'
    if (Test-Path -LiteralPath $recentFile) { $recentBefore = [IO.File]::ReadAllBytes($recentFile) }
  }
}

if ($Etw) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { throw '-Etw needs an elevated (administrator) PowerShell.' }
  $etl = Join-Path $env:TEMP "folio-network-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).etl"
  netsh trace start capture=no report=disabled persistent=no tracefile="$etl" `
    provider=Microsoft-Windows-Kernel-Network provider=Microsoft-Windows-DNS-Client | Out-Null
}

function Get-AppProcessIds([int]$rootId) {
  $all = Get-CimInstance Win32_Process
  $ids = [Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($rootId)
  # WebView2 processes are launched by the runtime, not by the app, but carry its exe name.
  $all | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match "webview-exe-name=$([regex]::Escape($exeName))" } |
    ForEach-Object { [void]$ids.Add([int]$_.ProcessId) }
  # Children of anything already in the set.
  do {
    $before = $ids.Count
    $all | Where-Object { $ids.Contains([int]$_.ParentProcessId) } | ForEach-Object { [void]$ids.Add([int]$_.ProcessId) }
  } while ($ids.Count -gt $before)
  [void]$ids.Remove(0)
  return @($ids)
}

$roles = @{}
function Get-Role([int]$id) {
  if (-not $roles.ContainsKey($id)) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    $type = if ($p.CommandLine -match '--type=(\S+)') { $Matches[1] } else { 'main' }
    $sub = if ($p.CommandLine -match '--utility-sub-type=(\S+)') { "/$($Matches[1])" } else { '' }
    $roles[$id] = "$($p.Name) [$type$sub]"
  }
  return $roles[$id]
}

$loopback = @('127.0.0.1', '::1')
$failures = [Collections.Generic.List[string]]::new()
$warnings = [Collections.Generic.List[string]]::new()
$seen = @{}
$watched = [Collections.Generic.HashSet[int]]::new()

Write-Host "Starting $exeName ..."
$app = Start-Process -FilePath $exePath -PassThru
Start-Sleep -Seconds 3
foreach ($file in $fileList) {
  Write-Host "  opening $([IO.Path]::GetFileName($file))"
  Start-Process -FilePath $exePath -ArgumentList "`"$file`"" -Wait
}

$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end -and -not $app.HasExited) {
  $ids = Get-AppProcessIds $app.Id
  foreach ($id in $ids) { [void]$watched.Add($id) }
  foreach ($c in @(Get-NetTCPConnection -OwningProcess $ids -ErrorAction SilentlyContinue)) {
    if ($c.OwningProcess -eq 0) { continue }
    $key = "tcp $($c.OwningProcess) $(Get-Role $c.OwningProcess) $($c.LocalAddress):$($c.LocalPort) -> $($c.RemoteAddress):$($c.RemotePort) $($c.State)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $local = ($loopback -contains $c.RemoteAddress) -or ($c.State -eq 'Listen' -and $loopback -contains $c.LocalAddress)
    if ($local) { $warnings.Add($key) } else { $failures.Add($key) }
  }
  foreach ($u in @(Get-NetUDPEndpoint -OwningProcess $ids -ErrorAction SilentlyContinue)) {
    if ($u.OwningProcess -eq 0) { continue }
    $key = "udp $($u.OwningProcess) $(Get-Role $u.OwningProcess) $($u.LocalAddress):$($u.LocalPort)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    if ($loopback -contains $u.LocalAddress) { $warnings.Add($key) } else { $failures.Add($key) }
  }
  Start-Sleep -Milliseconds 500
}

if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }

if ($testData) {
  # WebView2 lets go of its profile a moment after the app stops.
  for ($try = 0; $try -lt 20 -and (Test-Path -LiteralPath $testData); $try++) {
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $testData -Recurse -Force -ErrorAction SilentlyContinue
  }
} elseif ($recentFile) {
  Start-Sleep -Milliseconds 500
  if ($null -ne $recentBefore) { [IO.File]::WriteAllBytes($recentFile, $recentBefore) }
  elseif (Test-Path -LiteralPath $recentFile) { Remove-Item -LiteralPath $recentFile -Force }
}

if ($Etw) {
  netsh trace stop | Out-Null
  $events = Get-WinEvent -Path $etl -Oldest -ErrorAction SilentlyContinue |
    Where-Object { $watched.Contains([int]$_.ProcessId) }
  foreach ($e in $events) {
    $failures.Add("etw $($e.ProviderName) event $($e.Id) by process $($e.ProcessId): $($e.Message -replace '\s+', ' ')")
  }
  Write-Host "ETW trace kept at $etl"
}

Write-Host ''
Write-Host "Watched $($watched.Count) processes for $Seconds s."
foreach ($w in $warnings) { Write-Host "  loopback  $w" }
if ($failures.Count -eq 0) {
  Write-Host 'PASS: no network activity outside this PC.' -ForegroundColor Green
  exit 0
}
foreach ($f in $failures) { Write-Host "  FAIL  $f" -ForegroundColor Red }
Write-Host "FAIL: $($failures.Count) network events." -ForegroundColor Red
exit 1
