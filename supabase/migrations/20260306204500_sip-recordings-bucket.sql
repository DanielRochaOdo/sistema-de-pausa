-- Public bucket for SIP recordings uploaded by webhook.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-recordings',
  'sip-recordings',
  true,
  26214400,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'application/octet-stream']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
