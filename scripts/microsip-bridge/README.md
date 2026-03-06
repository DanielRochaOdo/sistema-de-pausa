Bridge local para registrar chamadas do MicroSIP no banco via webhook SIP.

1) Instalacao automatica (recomendado)
- Execute uma vez por maquina (PowerShell):
```powershell
.\install-agent-login.ps1 `
  -WebhookUrl "https://SEU-PROJETO.supabase.co/functions/v1/sip-call-webhook" `
  -WebhookToken "SEU_SIP_WEBHOOK_TOKEN" `
  -WebhookSigningSecret "SEU_SIP_WEBHOOK_SIGNING_SECRET" `
  -SipExtension "203" `
  -QueueCode "DENTALMASTER" `
  -RecordingDir "C:\Users\Public\Documents\MicroSIP\Recordings" `
  -RecordingExtension "mp3"
```
- O script:
`configura config.json`, `atualiza microsip.ini`, `cria tarefa no logon` para iniciar o MicroSIP automaticamente.
- O bridge usa automaticamente o ramal ativo no `microsip.ini` (Account atual), mesmo se `sip_extension` do config estiver desatualizado.

2) Parametros principais do instalador
- `-WebhookUrl` (obrigatorio): URL da function `sip-call-webhook`.
- `-SipExtension` (obrigatorio): ramal da maquina.
- `-WebhookToken` (opcional): token compartilhado (`SIP_WEBHOOK_TOKEN`).
- `-WebhookSigningSecret` (opcional): segredo HMAC (`SIP_WEBHOOK_SIGNING_SECRET`).
- `-QueueCode` (opcional): codigo da fila SIP.
- `-AgentId` (opcional): UUID do agente SIP.
- `-MicroSipIniPath` (opcional): caminho customizado do `microsip.ini`.
- `-MicroSipExePath` (opcional): caminho customizado do `microsip.exe`.
- `-AutoStartMicroSip $false` (opcional): nao abre MicroSIP no login.
- `-AttachRecordingBase64 $false` (opcional): nao envia audio para o webhook no evento `end`.
- `-RecordingDir` (opcional): pasta local onde o MicroSIP salva gravacoes.
- `-RecordingExtension` (opcional): extensao da gravacao (`mp3` recomendado).
- `-RecordingMaxAgeSeconds` (opcional): janela para buscar ultimo arquivo gravado.
- `-SkipLogonTask` (opcional): nao cria tarefa de logon.

3) Arquivos importantes
- `config.sample.json`: modelo de configuracao.
- `install-agent-login.ps1`: provisiona a estacao automaticamente.
- `start-microsip-on-login.ps1`: executado no logon (abre o MicroSIP se necessario).
- `microsip-*.cmd`: hooks chamados pelo MicroSIP (`incoming`, `outgoing`, `ringing`, `start`, `answer`, `end`).
- `microsip-event.ps1`: envia eventos para a Edge Function.

4) Como funciona
- `incoming/outgoing`: abre uma chamada no banco.
- `start/answer`: marca como ativa.
- `end`: finaliza, registra duracao e envia o audio (quando configurado) para download no painel.

5) Observacoes
- O bridge salva estado em `%ProgramData%\PauseSipBridge\active-call.json`.
- Logs locais do bridge ficam em `%ProgramData%\PauseSipBridge\bridge.log`.
- No login do Windows, o script revalida os hooks `cmdCall*` no `microsip.ini` para evitar status quebrado por config sobrescrita.
- Se houver mais de uma chamada simultanea no mesmo MicroSIP, o estado simples pode nao distinguir 100% dos casos.
- Recomenda-se manter `webhook_token` + assinatura HMAC (`webhook_signing_secret`) habilitados juntos.
- Para download no portal, use gravacao em `mp3` no MicroSIP e informe `recording_dir`.
- O bridge detecta automaticamente o ramal ativo no `microsip.ini` (conta atual), reduzindo divergencia entre ramal configurado e ramal real.
