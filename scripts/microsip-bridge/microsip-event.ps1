param(
  [string]$Event = '',
  [string]$CallerId = '',
  [string]$Direction = ''
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'
$stateDir = Join-Path $env:ProgramData 'PauseSipBridge'
$stateFile = Join-Path $stateDir 'active-call.json'
$logFile = Join-Path $stateDir 'bridge.log'

if (-not (Test-Path $configPath)) {
  Write-Error "Arquivo config.json nao encontrado em $scriptDir"
  exit 1
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json

if (-not $config.webhook_url) {
  Write-Error 'webhook_url nao configurado em config.json'
  exit 1
}

if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
}

function New-CallId {
  return [guid]::NewGuid().ToString()
}

function Read-State {
  if (-not (Test-Path $stateFile)) { return $null }
  try {
    return (Get-Content -Raw -Path $stateFile | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Save-State($obj) {
  $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding utf8
}

function Clear-State {
  if (Test-Path $stateFile) {
    Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
  }
}

function Write-BridgeLog([string]$Message) {
  if (-not $Message) { return }
  try {
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $Message
    Add-Content -Path $logFile -Value $line -Encoding utf8
  } catch {
    # Mantem o bridge resiliente mesmo sem permissao de escrita.
  }
}

function Convert-BytesToHex([byte[]]$Bytes) {
  return ([System.BitConverter]::ToString($Bytes) -replace '-', '').ToLowerInvariant()
}

function Get-HmacSha256Hex([string]$Secret, [string]$Payload) {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
  try {
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Payload))
    return Convert-BytesToHex -Bytes $hash
  } finally {
    $hmac.Dispose()
  }
}

function Normalize-PartyNumber([string]$Value) {
  $raw = [string]$Value
  if (-not $raw) { return '' }
  $raw = $raw.Trim().Trim('"')
  if ($raw -match '<([^>]+)>') {
    $raw = $matches[1]
  }

  $onlyPhoneChars = ($raw -replace '[^0-9+]', '')
  if ($onlyPhoneChars.Length -ge 3) {
    return $onlyPhoneChars
  }

  if ($raw -match '(\+?[0-9]{3,})') {
    return $matches[1]
  }

  return $raw
}

function To-BooleanSafe($value, $defaultValue = $false) {
  if ($null -eq $value) { return $defaultValue }
  $text = [string]$value
  if (-not $text) { return $defaultValue }
  switch ($text.Trim().ToLower()) {
    '1' { return $true }
    'true' { return $true }
    'yes' { return $true }
    'on' { return $true }
    '0' { return $false }
    'false' { return $false }
    'no' { return $false }
    'off' { return $false }
    default { return $defaultValue }
  }
}

function Get-RecordingMimeType([string]$Path) {
  $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($ext -eq '.mp3') { return 'audio/mpeg' }
  if ($ext -eq '.wav') { return 'audio/wav' }
  return 'application/octet-stream'
}

function Resolve-RecordingPath {
  param(
    [string[]]$AllArgs,
    [pscustomobject]$Config
  )

  foreach ($arg in $AllArgs) {
    $candidate = [string]$arg
    if (-not $candidate) { continue }
    $normalized = $candidate.Trim('"')
    if (-not (Test-Path $normalized)) { continue }
    $ext = [System.IO.Path]::GetExtension($normalized).ToLowerInvariant()
    if ($ext -in @('.mp3', '.wav')) {
      return $normalized
    }
  }

  $recordingDir = [string]$Config.recording_dir
  if (-not $recordingDir) { return $null }
  if (-not (Test-Path $recordingDir)) { return $null }

  $recordingExt = [string]$Config.recording_extension
  if (-not $recordingExt) { $recordingExt = 'mp3' }
  $recordingExt = $recordingExt.Trim('.').ToLowerInvariant()
  $maxAgeSeconds = 300
  if ($Config.recording_max_age_seconds) {
    $parsedAge = 0
    if ([int]::TryParse([string]$Config.recording_max_age_seconds, [ref]$parsedAge)) {
      if ($parsedAge -gt 0) { $maxAgeSeconds = $parsedAge }
    }
  }

  $threshold = (Get-Date).AddSeconds(-1 * $maxAgeSeconds)
  $candidateFile = Get-ChildItem -Path $recordingDir -File -Filter "*.$recordingExt" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Where-Object { $_.LastWriteTime -ge $threshold } |
    Select-Object -First 1

  if ($candidateFile) {
    return $candidateFile.FullName
  }

  return $null
}

function Resolve-MicroSipIniPath([pscustomobject]$Config) {
  $explicit = [string]$Config.microsip_ini_path
  if ($explicit -and (Test-Path $explicit)) {
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

  return $null
}

function Resolve-SipExtension([pscustomobject]$Config) {
  $configured = [string]$Config.sip_extension
  $configured = $configured.Trim()

  $iniPath = Resolve-MicroSipIniPath -Config $Config
  if (-not $iniPath) {
    return $configured
  }

  try {
    $lines = Get-Content -Path $iniPath
  } catch {
    return $configured
  }

  $accountId = ''
  foreach ($line in $lines) {
    $trimmed = [string]$line
    if ($trimmed -match '^\s*accountId\s*=\s*(.+)\s*$') {
      $accountId = [string]$matches[1]
    }
  }

  if (-not $accountId) {
    return $configured
  }

  $section = "Account$accountId"
  $inSection = $false
  $username = ''
  $label = ''
  $authId = ''

  foreach ($line in $lines) {
    $trimmed = [string]$line
    if ($trimmed -match '^\s*\[(.+)\]\s*$') {
      $inSection = ([string]$matches[1] -eq $section)
      continue
    }
    if (-not $inSection) { continue }
    if ($trimmed -match '^\s*username\s*=\s*(.+)\s*$') { $username = [string]$matches[1] }
    if ($trimmed -match '^\s*label\s*=\s*(.+)\s*$') { $label = [string]$matches[1] }
    if ($trimmed -match '^\s*authID\s*=\s*(.+)\s*$') { $authId = [string]$matches[1] }
  }

  $detected = @($username, $authId, $label) | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1
  if ($detected) {
    return ([string]$detected).Trim()
  }

  return $configured
}

$rawArgs = @($args)
if (-not $Event -and $rawArgs.Count -gt 0) { $Event = [string]$rawArgs[0] }
if (-not $CallerId -and $rawArgs.Count -gt 1) { $CallerId = [string]$rawArgs[1] }
if (-not $CallerId -and $rawArgs.Count -eq 1 -and $Event) { $CallerId = [string]$rawArgs[0] }

$eventNormalized = [string]$Event
if (-not $eventNormalized) { $eventNormalized = 'update' }
$eventNormalized = $eventNormalized.Trim().ToLower()

$caller = [string]$CallerId
$caller = Normalize-PartyNumber -Value $caller

$state = Read-State
$callId = $null

if ($eventNormalized -in @('incoming','outgoing','start')) {
  $reuseExisting = $false
  if ($state -and $state.call_id -and $state.started_at) {
    try {
      $stateStart = [DateTime]::Parse([string]$state.started_at).ToUniversalTime()
      $elapsed = ((Get-Date).ToUniversalTime() - $stateStart).TotalSeconds
      if ($elapsed -ge 0 -and $elapsed -le 20) {
        $reuseExisting = $true
      }
    } catch {
      $reuseExisting = $false
    }
  }
  if ($reuseExisting) {
    $callId = [string]$state.call_id
  } else {
    $callId = New-CallId
  }
} elseif ($eventNormalized -eq 'ringing' -and $state -and $state.call_id) {
  $callId = [string]$state.call_id
} elseif ($state -and $state.call_id) {
  $callId = [string]$state.call_id
} else {
  $callId = New-CallId
}

$directionValue = [string]$Direction
$isSameStateCall = $false
if ($state -and $state.call_id -and [string]$state.call_id -eq [string]$callId) {
  $isSameStateCall = $true
}

$stateDirection = if ($isSameStateCall -and $state.direction) { [string]$state.direction } else { '' }
$stateDirection = $stateDirection.Trim().ToUpper()

if (
  $eventNormalized -in @('start', 'answer', 'ringing', 'end') -and
  $stateDirection -in @('INBOUND', 'OUTBOUND')
) {
  $directionValue = $stateDirection
}

if (-not $directionValue) {
  if ($eventNormalized -eq 'outgoing') {
    $directionValue = 'OUTBOUND'
  } elseif ($eventNormalized -eq 'incoming') {
    $directionValue = 'INBOUND'
  } else {
    $directionValue = [string]$config.direction_default
  }
}
$directionValue = $directionValue.ToUpper()
if ($directionValue -notin @('INBOUND','OUTBOUND')) {
  $directionValue = $null
}

$callerNumber = $null
$calleeNumber = $null
$effectiveSipExtension = Resolve-SipExtension -Config $config

if ($eventNormalized -in @('start', 'answer', 'end') -and $isSameStateCall) {
  $callerNumber = [string]$state.caller_number
  $calleeNumber = [string]$state.callee_number
} else {
  if ($directionValue -eq 'OUTBOUND') {
    $calleeNumber = $caller
    $callerNumber = [string]$effectiveSipExtension
  } else {
    $callerNumber = $caller
    $calleeNumber = [string]$effectiveSipExtension
  }
}

if (-not $callerNumber -and $state -and $state.caller_number) {
  $callerNumber = [string]$state.caller_number
}
if (-not $calleeNumber -and $state -and $state.callee_number) {
  $calleeNumber = [string]$state.callee_number
}

if ($eventNormalized -in @('incoming','outgoing','ringing','start')) {
  $stateStartedAt = $null
  if ($state -and $state.started_at) {
    $stateStartedAt = [string]$state.started_at
  }
  $state = [PSCustomObject]@{
    call_id = $callId
    caller_number = $callerNumber
    callee_number = $calleeNumber
    direction = $directionValue
    started_at = if ($stateStartedAt) { $stateStartedAt } else { (Get-Date).ToUniversalTime().ToString('o') }
  }
  Save-State $state
}

$payload = [ordered]@{
  call_id = $callId
  event = $eventNormalized
  status = if ($eventNormalized -eq 'end') { 'ENDED' } elseif ($eventNormalized -in @('answer', 'start')) { 'ACTIVE' } else { 'RINGING' }
  caller_number = $callerNumber
  callee_number = $calleeNumber
  sip_extension = [string]$effectiveSipExtension
  sip_extension_configured = [string]$config.sip_extension
  queue_code = [string]$config.queue_code
  agent_id = [string]$config.agent_id
  direction = $directionValue
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  metadata = @{
    source = 'microsip-bridge'
    event = $eventNormalized
    host = $env:COMPUTERNAME
    user = $env:USERNAME
    sip_extension_configured = [string]$config.sip_extension
    sip_extension_effective = [string]$effectiveSipExtension
  }
}

if ($eventNormalized -in @('answer', 'start')) {
  $payload['answered_at'] = (Get-Date).ToUniversalTime().ToString('o')
}
if ($eventNormalized -eq 'end') {
  $attachRecording = To-BooleanSafe -value $config.attach_recording_base64 -defaultValue $true
  if ($attachRecording) {
    $recordingPath = Resolve-RecordingPath -AllArgs $rawArgs -Config $config
    if ($recordingPath -and (Test-Path $recordingPath)) {
      try {
        $bytes = [System.IO.File]::ReadAllBytes($recordingPath)
        if ($bytes.Length -le 26214400) {
          $payload['recording_base64'] = [System.Convert]::ToBase64String($bytes)
          $payload['recording_filename'] = [System.IO.Path]::GetFileName($recordingPath)
          $payload['recording_mime_type'] = Get-RecordingMimeType -Path $recordingPath
          $payload['metadata'].recording_local_path = $recordingPath
        } else {
          $payload['metadata'].recording_error = 'recording_too_large'
        }
      } catch {
        $payload['metadata'].recording_error = 'recording_read_failed'
      }
    }
  }

  $payload['ended_at'] = (Get-Date).ToUniversalTime().ToString('o')
  Clear-State
}

$bodyJson = $payload | ConvertTo-Json -Depth 8 -Compress
Write-BridgeLog ("event={0} call_id={1} direction={2} sip_effective={3} sip_configured={4} caller={5} callee={6}" -f $eventNormalized, $callId, $directionValue, [string]$effectiveSipExtension, [string]$config.sip_extension, [string]$callerNumber, [string]$calleeNumber)

$headers = @{
  'Content-Type' = 'application/json'
}
if ($config.webhook_token) {
  $headers['x-sip-token'] = [string]$config.webhook_token
}
if ($config.webhook_signing_secret) {
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $signedPayload = "$timestamp.$bodyJson"
  $signature = Get-HmacSha256Hex -Secret ([string]$config.webhook_signing_secret) -Payload $signedPayload
  $headers['x-sip-timestamp'] = $timestamp
  $headers['x-sip-signature'] = $signature
}

try {
  Invoke-RestMethod -Method Post -Uri ([string]$config.webhook_url) -Headers $headers -Body $bodyJson | Out-Null
  Write-BridgeLog ("webhook_ok event={0} call_id={1}" -f $eventNormalized, $callId)
  exit 0
} catch {
  Write-BridgeLog ("webhook_error event={0} call_id={1} message={2}" -f $eventNormalized, $callId, [string]$_.Exception.Message)
  Write-Error $_
  exit 1
}
