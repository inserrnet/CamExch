param(
  [ValidateSet("status", "preflight", "preflight-deactivate", "activate", "deactivate")]
  [string]$Action = "status",
  [string]$ResultPath = "",
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$OurCameraClsid = "{6E4A7C7A-6400-4A91-A857-E17A46D99431}"
$CategoryClsid = "{860BB310-5D01-11D0-BD3B-00A0C911CE86}"
$StateRoot = Join-Path $env:ProgramData "Cam Player\Emulator Camera Mode"
$ManifestPath = Join-Path $StateRoot "state.json"
$BackupRoot = Join-Path $StateRoot "registry"

function Write-Result([hashtable]$Value) {
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  if ($ResultPath) {
    $directory = Split-Path -Parent $ResultPath
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    [IO.File]::WriteAllText($ResultPath, $json, [Text.UTF8Encoding]::new($false))
  }
  Write-Output $json
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedSelf {
  $script = $PSCommandPath.Replace("'", "''")
  $result = $ResultPath.Replace("'", "''")
  $command = "& '$script' -Action '$Action' -ResultPath '$result' -Elevated"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  try {
    $process = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
      -ArgumentList @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
    if ($process.ExitCode -ne 0 -and -not (Test-Path -LiteralPath $ResultPath)) {
      throw "Elevated camera helper exited with code $($process.ExitCode)"
    }
  } catch {
    Write-Result @{ state = "incomplete"; message = "Administrator permission was not granted"; consumers = @() }
  }
}

function Get-FriendlyProcessName([string]$Path, [string]$Fallback) {
  $name = if ($Path) { [IO.Path]::GetFileNameWithoutExtension($Path) } else { $Fallback }
  switch -Regex ($name) {
    "^MuMuNxDevice$" { return "MuMu Player" }
    "^obs(32|64)?$" { return "OBS Studio" }
    "^firefox$" { return "Firefox" }
    "^msedge$" { return "Microsoft Edge" }
    "^chrome$" { return "Google Chrome" }
    "^ApplicationFrameHost$" { return "Windows Camera" }
    default { return $name }
  }
}

function Get-ActiveCameraConsumers {
  $processes = @{}
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $processes[[int]$_.ProcessId] = $_
  }
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $knownCameraHosts = @(
    "MuMuNxDevice", "MuMuPlayer", "NemuPlayer", "dnplayer", "LdVBoxHeadless",
    "HD-Player", "MEmuHeadless", "NoxVMHandle", "obs32", "obs64"
  )
  foreach ($process in $processes.Values) {
    $baseName = [IO.Path]::GetFileNameWithoutExtension([string]$process.Name)
    if ($knownCameraHosts -icontains $baseName) {
      [void]$names.Add((Get-FriendlyProcessName $process.ExecutablePath $process.Name))
    }
  }
  $consentRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\NonPackaged",
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam"
  )
  foreach ($root in $consentRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($null -eq $item -or [int64]$item.LastUsedTimeStart -le 0 -or [int64]$item.LastUsedTimeStop -ne 0) { return }
      $encodedPath = $_.PSChildName -replace "#", "\"
      $match = $processes.Values | Where-Object {
        $_.ExecutablePath -and ($_.ExecutablePath -ieq $encodedPath)
      } | Select-Object -First 1
      if ($match) {
        [void]$names.Add((Get-FriendlyProcessName $match.ExecutablePath $match.Name))
      }
    }
  }

  $filterDlls = Get-DirectShowEntries | ForEach-Object { $_.dll } | Where-Object { $_ } | Select-Object -Unique
  if ($filterDlls.Count -gt 0) {
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
      try {
        $loaded = $process.Modules | Where-Object { $filterDlls -icontains $_.FileName } | Select-Object -First 1
        if ($loaded) { [void]$names.Add((Get-FriendlyProcessName $process.Path $process.ProcessName)) }
      } catch {}
    }
  }
  return @($names | Sort-Object)
}

function Get-DirectShowEntries {
  $roots = @(
    @{ ps = "HKLM:\SOFTWARE\Classes\CLSID\$CategoryClsid\Instance"; reg = "HKLM\SOFTWARE\Classes\CLSID\$CategoryClsid\Instance"; view = "64" },
    @{ ps = "HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\$CategoryClsid\Instance"; reg = "HKLM\SOFTWARE\Classes\WOW6432Node\CLSID\$CategoryClsid\Instance"; view = "32" }
  )
  $entries = @()
  foreach ($root in $roots) {
    if (-not (Test-Path $root.ps)) { continue }
    foreach ($key in Get-ChildItem $root.ps -ErrorAction SilentlyContinue) {
      if ($key.PSChildName -ieq $OurCameraClsid) { continue }
      $clsidPath = "HKLM:\SOFTWARE\Classes\CLSID\$($key.PSChildName)\InprocServer32"
      if ($root.view -eq "32") {
        $clsidPath = "HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\$($key.PSChildName)\InprocServer32"
      }
      $dll = $null
      try { $dll = (Get-Item $clsidPath -ErrorAction Stop).GetValue("") } catch {}
      $entries += [pscustomobject]@{
        clsid = $key.PSChildName
        psPath = $key.PSPath
        regPath = "$($root.reg)\$($key.PSChildName)"
        view = $root.view
        name = [string]$key.GetValue("FriendlyName")
        dll = [string]$dll
      }
    }
  }
  return $entries
}

function Test-OurCameraRegistered {
  return Test-Path "HKLM:\SOFTWARE\Classes\CLSID\$CategoryClsid\Instance\$OurCameraClsid"
}

function Get-CameraDevices {
  $devices = @()
  foreach ($class in @("Camera", "Image")) {
    Get-PnpDevice -Class $class -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object {
      $service = ""
      try {
        $service = [string](Get-PnpDeviceProperty -InstanceId $_.InstanceId `
          -KeyName "DEVPKEY_Device_Service" -ErrorAction Stop).Data
      } catch {}
      if ($class -eq "Image" -and $service -notmatch "usbvideo|avstream|camera") { return }
      $problem = 0
      try {
        $problem = [int](Get-PnpDeviceProperty -InstanceId $_.InstanceId `
          -KeyName "DEVPKEY_Device_ProblemCode" -ErrorAction Stop).Data
      } catch {}
      $configFlags = 0
      try {
        $configFlags = [int](Get-PnpDeviceProperty -InstanceId $_.InstanceId `
          -KeyName "DEVPKEY_Device_ConfigFlags" -ErrorAction Stop).Data
      } catch {}
      $deviceName = if ($_.FriendlyName) { $_.FriendlyName } else { $_.Name }
      $devices += [pscustomobject]@{
        instanceId = $_.InstanceId
        name = [string]$deviceName
        class = $class
        problemCode = $problem
        configFlags = $configFlags
        runtimeStarted = ($problem -ne 22 -and $_.Status -eq "OK")
        enabled = ($problem -ne 22 -and $_.Status -eq "OK" -and (($configFlags -band 1) -eq 0))
      }
    }
  }
  return @($devices | Sort-Object instanceId -Unique)
}

function Read-Manifest {
  if (-not (Test-Path -LiteralPath $ManifestPath)) { return $null }
  try { return Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json } catch { return $null }
}

function Save-Manifest($Manifest) {
  New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
  $json = $Manifest | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($ManifestPath, $json, [Text.UTF8Encoding]::new($false))
}

function Test-Isolation($Manifest) {
  $failures = @()
  if (-not (Test-OurCameraRegistered)) { $failures += "Cam Player Camera is not registered" }
  foreach ($device in @($Manifest.devices)) {
    $current = Get-CameraDevices | Where-Object { $_.instanceId -eq $device.instanceId } | Select-Object -First 1
    if ($current -and ($current.problemCode -ne 22 -or $current.enabled)) {
      $failures += "$($device.name) is still started"
    }
  }
  foreach ($entry in @($Manifest.directShow)) {
    $psPath = if ($entry.view -eq "32") {
      "HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\$CategoryClsid\Instance\$($entry.clsid)"
    } else {
      "HKLM:\SOFTWARE\Classes\CLSID\$CategoryClsid\Instance\$($entry.clsid)"
    }
    if (Test-Path $psPath) { $failures += "$($entry.name) is still registered" }
  }
  return $failures
}

function Restore-Manifest($Manifest) {
  $failures = @()
  foreach ($device in @($Manifest.devices)) {
    $shouldEnable = [bool]$device.wasEnabled
    $hasInitialFlags = $null -ne $device.PSObject.Properties["initialConfigFlags"]
    if ($hasInitialFlags -and (([int]$device.initialConfigFlags -band 1) -ne 0)) { $shouldEnable = $false }
    if (-not $hasInitialFlags) {
      $current = Get-CameraDevices | Where-Object { $_.instanceId -eq $device.instanceId } | Select-Object -First 1
      if ($current -and (($current.configFlags -band 1) -ne 0)) { $shouldEnable = $false }
    }
    if (-not $shouldEnable) { continue }
    $output = (& pnputil.exe /enable-device $device.instanceId 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      $detail = if ($output) { ": $output" } else { "" }
      $failures += "Could not enable $($device.name)$detail"
    }
  }
  foreach ($entry in @($Manifest.directShow)) {
    $file = Join-Path $BackupRoot $entry.backup
    if (-not (Test-Path -LiteralPath $file)) {
      $failures += "Missing registry backup for $($entry.name)"
      continue
    }
    & reg.exe import $file | Out-Null
    if ($LASTEXITCODE -ne 0) { $failures += "Could not restore $($entry.name)" }
  }
  return $failures
}

function Test-Restored($Manifest) {
  $failures = @()
  foreach ($device in @($Manifest.devices)) {
    if (-not $device.wasEnabled) { continue }
    $current = Get-CameraDevices | Where-Object { $_.instanceId -eq $device.instanceId } | Select-Object -First 1
    $hasInitialFlags = $null -ne $device.PSObject.Properties["initialConfigFlags"]
    if ($hasInitialFlags -and (([int]$device.initialConfigFlags -band 1) -ne 0)) { continue }
    if (-not $hasInitialFlags -and $current -and (($current.configFlags -band 1) -ne 0)) { continue }
    if (-not $current -or -not $current.enabled) { $failures += "$($device.name) was not enabled" }
  }
  foreach ($entry in @($Manifest.directShow)) {
    $psPath = if ($entry.view -eq "32") {
      "HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\$CategoryClsid\Instance\$($entry.clsid)"
    } else {
      "HKLM:\SOFTWARE\Classes\CLSID\$CategoryClsid\Instance\$($entry.clsid)"
    }
    if (-not (Test-Path $psPath)) { $failures += "$($entry.name) was not restored" }
  }
  return $failures
}

function Get-StatusResult {
  $manifest = Read-Manifest
  if (-not $manifest) {
    return @{ state = "off"; message = "Other cameras are available"; consumers = @() }
  }
  if ($manifest.phase -ne "active") {
    return @{ state = "incomplete"; message = "Camera isolation did not finish; turn the mode off to restore cameras"; consumers = @() }
  }
  $failures = @(Test-Isolation $manifest)
  if ($failures.Count -gt 0) {
    return @{ state = "incomplete"; message = ($failures -join "; "); consumers = @() }
  }
  return @{ state = "active"; message = "Only Cam Player Camera is available"; consumers = @() }
}

if ($Action -notin @("status", "preflight", "preflight-deactivate") `
    -and -not $Elevated -and -not (Test-Administrator)) {
  Invoke-ElevatedSelf
  exit
}

try {
  if ($Action -eq "status") {
    Write-Result (Get-StatusResult)
    exit
  }

  if ($Action -in @("preflight", "activate") -and -not (Test-OurCameraRegistered)) {
    Write-Result @{
      state = "waiting"
      message = "Install Cam Player Camera before activating emulator mode"
      consumers = @()
    }
    exit
  }

  $consumers = @(Get-ActiveCameraConsumers)
  if ($consumers.Count -gt 0) {
    Write-Result @{
      state = "waiting"
      message = "Close camera consumers: $($consumers -join ', ')"
      consumers = $consumers
    }
    exit
  }

  if ($Action -in @("preflight", "preflight-deactivate")) {
    Write-Result @{ state = "ready"; message = "No active camera consumers"; consumers = @() }
    exit
  }

  if ($Action -eq "deactivate") {
    $manifest = Read-Manifest
    if (-not $manifest) {
      Write-Result @{ state = "off"; message = "Other cameras are available"; consumers = @() }
      exit
    }
    $failures = @(Restore-Manifest $manifest)
    if ($failures.Count -eq 0) { $failures = @(Test-Restored $manifest) }
    if ($failures.Count -gt 0) {
      Write-Result @{ state = "incomplete"; message = ($failures -join "; "); consumers = @() }
      exit
    }
    Remove-Item -LiteralPath $StateRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Result @{ state = "off"; message = "Other cameras were restored"; consumers = @() }
    exit
  }

  $existing = Read-Manifest
  if ($existing) {
    Write-Result (Get-StatusResult)
    exit
  }

  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  $devices = @(Get-CameraDevices)
  $directShow = @(Get-DirectShowEntries)
  $manifest = [ordered]@{
    version = 1
    phase = "applying"
    createdAt = [DateTime]::UtcNow.ToString("o")
    devices = @($devices | ForEach-Object {
      [ordered]@{
        instanceId = $_.instanceId
        name = $_.name
        wasEnabled = $_.enabled
        initialConfigFlags = $_.configFlags
      }
    })
    directShow = @()
  }
  Save-Manifest $manifest

  try {
    $index = 0
    foreach ($entry in $directShow) {
      $backup = "dshow-$($entry.view)-$index.reg"
      $backupPath = Join-Path $BackupRoot $backup
      & reg.exe export $entry.regPath $backupPath /y | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not back up $($entry.name)" }
      $manifest.directShow += [ordered]@{
        clsid = $entry.clsid; name = $entry.name; view = $entry.view; backup = $backup
      }
      Save-Manifest $manifest
      Remove-Item -LiteralPath $entry.psPath -Recurse -Force
      $index += 1
    }
    foreach ($device in $devices) {
      if (-not $device.runtimeStarted) { continue }
      $output = (& pnputil.exe /disable-device $device.instanceId 2>&1 | Out-String).Trim()
      if ($LASTEXITCODE -ne 0) {
        $detail = if ($output) { ": $output" } else { "" }
        throw "Could not disable $($device.name)$detail"
      }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      Start-Sleep -Milliseconds 250
      $failures = @(Test-Isolation $manifest)
    } while ($failures.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($failures.Count -gt 0) { throw ($failures -join "; ") }
    $manifest.phase = "active"
    Save-Manifest $manifest
    Write-Result @{ state = "active"; message = "Only Cam Player Camera is available"; consumers = @() }
  } catch {
    $rollbackFailures = @(Restore-Manifest $manifest)
    if ($rollbackFailures.Count -eq 0) {
      Remove-Item -LiteralPath $StateRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $message = "Camera isolation failed: $($_.Exception.Message)"
    if ($rollbackFailures.Count -gt 0) { $message += "; rollback: $($rollbackFailures -join '; ')" }
    Write-Result @{ state = "incomplete"; message = $message; consumers = @() }
  }
} catch {
  Write-Result @{ state = "incomplete"; message = $_.Exception.Message; consumers = @() }
}
