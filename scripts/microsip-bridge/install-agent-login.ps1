param(
  [Parameter(Mandatory = $true)]
  [string]$WebhookUrl,
  [string]$WebhookToken = '',
  [string]$WebhookSigningSecret = '',
  [Parameter(Mandatory = $true)]
  [string]$SipExtension,
  [string]$QueueCode = '',
  [string]$AgentId = '',
  [ValidateSet('INBOUND', 'OUTBOUND')]
  [string]$DirectionDefault = 'INBOUND',
  [string]$MicroSipIniPath = '',
  [string]$MicroSipExePath = '',
  [bool]$AutoStartMicroSip = $true,
  [bool]$AttachRecordingBase64 = $true,
  [string]$RecordingDir = '',
  [string]$RecordingExtension = 'mp3',
  [int]$RecordingMaxAgeSeconds = 300,
  [string]$TaskName = 'PauseSIP-MicroSIP',
  [switch]$SkipLogonTask
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'
$loginScriptPath = Join-Path $scriptDir 'start-microsip-on-login.ps1'

$incomingCmd = Join-Path $scriptDir 'microsip-incoming.cmd'
$outgoingCmd = Join-Path $scriptDir 'microsip-outgoing.cmd'
$ringingCmd = Join-Path $scriptDir 'microsip-ringing.cmd'
$startCmd = Join-Path $scriptDir 'microsip-start.cmd'
$answerCmd = Join-Path $scriptDir 'microsip-answer.cmd'
$endCmd = Join-Path $scriptDir 'microsip-end.cmd'

$requiredFiles = @($incomingCmd, $outgoingCmd, $ringingCmd, $startCmd, $answerCmd, $endCmd, $loginScriptPath)
foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path $requiredFile)) {
    throw "Arquivo obrigatorio nao encontrado: $requiredFile"
  }
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

function Resolve-MicroSipIniPath {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ExplicitPath)
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

if (-not $WebhookToken -and -not $WebhookSigningSecret) {
  throw 'Configure pelo menos um mecanismo de seguranca: WebhookToken ou WebhookSigningSecret.'
}

$resolvedIniPath = Resolve-MicroSipIniPath -ExplicitPath $MicroSipIniPath
$iniDirectory = Split-Path -Parent $resolvedIniPath
if (-not (Test-Path $iniDirectory)) {
  New-Item -ItemType Directory -Force -Path $iniDirectory | Out-Null
}

if (-not (Test-Path $resolvedIniPath)) {
  Set-Content -Path $resolvedIniPath -Value '[Settings]' -Encoding utf8
}

$config = [ordered]@{
  webhook_url = $WebhookUrl.Trim()
  webhook_token = $WebhookToken.Trim()
  webhook_signing_secret = $WebhookSigningSecret.Trim()
  sip_extension = $SipExtension.Trim()
  queue_code = $QueueCode.Trim()
  agent_id = $AgentId.Trim()
  direction_default = $DirectionDefault
  microsip_exe_path = $MicroSipExePath.Trim()
  microsip_ini_path = $resolvedIniPath
  auto_start_microsip = $AutoStartMicroSip
  attach_recording_base64 = $AttachRecordingBase64
  recording_dir = $RecordingDir.Trim()
  recording_extension = $RecordingExtension.Trim().Trim('.').ToLowerInvariant()
  recording_max_age_seconds = if ($RecordingMaxAgeSeconds -gt 0) { $RecordingMaxAgeSeconds } else { 300 }
}

$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding utf8

$iniLines = Get-Content -Path $resolvedIniPath
$incomingCmdIni = Format-IniCommandValue -Path $incomingCmd
$outgoingCmdIni = Format-IniCommandValue -Path $outgoingCmd
$ringingCmdIni = Format-IniCommandValue -Path $ringingCmd
$startCmdIni = Format-IniCommandValue -Path $startCmd
$answerCmdIni = Format-IniCommandValue -Path $answerCmd
$endCmdIni = Format-IniCommandValue -Path $endCmd

$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallIncoming' -Value $incomingCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallOutcoming' -Value $outgoingCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdIncomingCall' -Value $incomingCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdOutgoingCall' -Value $outgoingCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallRing' -Value $ringingCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallStart' -Value $startCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallAnswer' -Value $answerCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallBusy' -Value $endCmdIni
$iniLines = Set-IniValueInSection -Lines $iniLines -Section 'Settings' -Key 'cmdCallEnd' -Value $endCmdIni
$iniLines | Set-Content -Path $resolvedIniPath -Encoding utf8

if (-not $SkipLogonTask) {
  $powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $taskRun = "`"$powershellPath`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$loginScriptPath`""
  $taskCreated = $false
  try {
    schtasks /Create /TN $TaskName /SC ONLOGON /TR $taskRun /F 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
      $taskCreated = $true
    }
  } catch {
    $taskCreated = $false
  }

  if (-not $taskCreated) {
    $startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    if (-not (Test-Path $startupDir)) {
      New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
    }
    $startupCmdPath = Join-Path $startupDir "$TaskName.cmd"
    @(
      '@echo off'
      "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$loginScriptPath`""
    ) | Set-Content -Path $startupCmdPath -Encoding ascii
  }
}

Write-Host "Config SIP salva em: $configPath"
Write-Host "MicroSIP configurado em: $resolvedIniPath"
if ($SkipLogonTask) {
  Write-Host 'Tarefa de logon nao criada (SkipLogonTask ativo).'
} else {
  $taskExists = $false
  try {
    cmd /c "schtasks /Query /TN ""$TaskName"" >nul 2>nul"
    $taskExists = ($LASTEXITCODE -eq 0)
  } catch {
    $taskExists = $false
  }
  if ($taskExists) {
    Write-Host "Tarefa de logon criada/atualizada: $TaskName"
  } else {
    Write-Host "Fallback em Startup aplicado: $env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\$TaskName.cmd"
  }
}
