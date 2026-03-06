param()

$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'

if (-not (Test-Path $configPath)) {
  exit 0
}

try {
  $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
} catch {
  exit 0
}

function Resolve-MicroSipIniPath {
  param([pscustomobject]$Config)

  $explicit = [string]$Config.microsip_ini_path
  if ($explicit) {
    return $explicit
  }

  $candidates = @(
    (Join-Path $env:APPDATA 'MicroSIP\microsip.ini'),
    (Join-Path $env:LOCALAPPDATA 'MicroSIP\microsip.ini')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $candidates[0]
}

function Format-IniCommandValue {
  param([string]$Path)
  if (-not $Path) {
    return '""'
  }
  $trimmed = $Path.Trim()
  if ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
    return $trimmed
  }
  return "`"$trimmed`""
}

function Set-IniValueInSection {
  param(
    [string[]]$Lines,
    [string]$Section,
    [string]$Key,
    [string]$Value
  )

  $buffer = [System.Collections.Generic.List[string]]::new()
  if ($Lines) {
    foreach ($line in $Lines) {
      $buffer.Add([string]$line)
    }
  }

  $keyPattern = "^\s*$([regex]::Escape($Key))\s*="
  $updatedAnyKey = $false
  for ($index = 0; $index -lt $buffer.Count; $index += 1) {
    if ($buffer[$index] -match $keyPattern) {
      $buffer[$index] = "$Key=$Value"
      $updatedAnyKey = $true
    }
  }
  if ($updatedAnyKey) {
    return $buffer.ToArray()
  }

  $sectionPattern = "^\s*\[$([regex]::Escape($Section))\]\s*$"
  $sectionStart = -1
  for ($index = 0; $index -lt $buffer.Count; $index += 1) {
    if ($buffer[$index] -match $sectionPattern) {
      $sectionStart = $index
    }
  }

  if ($sectionStart -lt 0) {
    if ($buffer.Count -gt 0 -and $buffer[$buffer.Count - 1].Trim() -ne '') {
      $buffer.Add('')
    }
    $buffer.Add("[$Section]")
    $buffer.Add("$Key=$Value")
    return $buffer.ToArray()
  }

  $sectionEnd = $buffer.Count
  for ($index = $sectionStart + 1; $index -lt $buffer.Count; $index += 1) {
    if ($buffer[$index] -match '^\s*\[.+\]\s*$') {
      $sectionEnd = $index
      break
    }
  }

  for ($index = $sectionStart + 1; $index -lt $sectionEnd; $index += 1) {
    if ($buffer[$index] -match $keyPattern) {
      $buffer[$index] = "$Key=$Value"
      return $buffer.ToArray()
    }
  }

  $buffer.Insert($sectionEnd, "$Key=$Value")
  return $buffer.ToArray()
}

function Ensure-MicroSipHooks {
  param([pscustomobject]$Config)

  $incomingCmd = Join-Path $scriptDir 'microsip-incoming.cmd'
  $outgoingCmd = Join-Path $scriptDir 'microsip-outgoing.cmd'
  $ringingCmd = Join-Path $scriptDir 'microsip-ringing.cmd'
  $startCmd = Join-Path $scriptDir 'microsip-start.cmd'
  $answerCmd = Join-Path $scriptDir 'microsip-answer.cmd'
  $endCmd = Join-Path $scriptDir 'microsip-end.cmd'

  $requiredFiles = @($incomingCmd, $outgoingCmd, $ringingCmd, $startCmd, $answerCmd, $endCmd)
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path $requiredFile)) {
      return
    }
  }

  $iniPath = Resolve-MicroSipIniPath -Config $Config
  if (-not $iniPath) {
    return
  }

  $iniDirectory = Split-Path -Parent $iniPath
  if ($iniDirectory -and -not (Test-Path $iniDirectory)) {
    New-Item -ItemType Directory -Force -Path $iniDirectory | Out-Null
  }

  if (-not (Test-Path $iniPath)) {
    Set-Content -Path $iniPath -Value '[Settings]' -Encoding utf8
  }

  $iniLines = Get-Content -Path $iniPath
  $hookMap = [ordered]@{
    cmdCallIncoming = (Format-IniCommandValue -Path $incomingCmd)
    cmdCallOutcoming = (Format-IniCommandValue -Path $outgoingCmd)
    cmdIncomingCall = (Format-IniCommandValue -Path $incomingCmd)
    cmdOutgoingCall = (Format-IniCommandValue -Path $outgoingCmd)
    cmdCallRing = (Format-IniCommandValue -Path $ringingCmd)
    cmdCallStart = (Format-IniCommandValue -Path $startCmd)
    cmdCallAnswer = (Format-IniCommandValue -Path $answerCmd)
    cmdCallBusy = (Format-IniCommandValue -Path $endCmd)
    cmdCallEnd = (Format-IniCommandValue -Path $endCmd)
  }

  foreach ($key in $hookMap.Keys) {
    $iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key $key -Value ([string]$hookMap[$key])
  }

  $iniLines | Set-Content -Path $iniPath -Encoding utf8
}

try {
  Ensure-MicroSipHooks -Config $config
} catch {
  # Silencioso por design para nao interromper login do agente.
}

$autoStart = $true
if ($null -ne $config.auto_start_microsip -and [string]$config.auto_start_microsip -ne '') {
  $autoStart = [System.Convert]::ToBoolean($config.auto_start_microsip)
}
if (-not $autoStart) {
  exit 0
}

$exePath = [string]$config.microsip_exe_path
if (-not $exePath) {
  $exeCandidates = @(
    (Join-Path ${env:ProgramFiles} 'MicroSIP\microsip.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'MicroSIP\microsip.exe')
  )
  foreach ($candidate in $exeCandidates) {
    if ($candidate -and (Test-Path $candidate)) {
      $exePath = $candidate
      break
    }
  }
}

if (-not $exePath -or -not (Test-Path $exePath)) {
  exit 0
}

$alreadyRunning = Get-Process -Name 'microsip' -ErrorAction SilentlyContinue
if ($alreadyRunning) {
  exit 0
}

Start-Sleep -Seconds 4
Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) | Out-Null

exit 0
