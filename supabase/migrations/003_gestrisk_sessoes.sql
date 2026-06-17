-- Sessões WhatsApp + histórico Gemini (turnos user/model) por chat_id.
-- Execute no SQL Editor do Supabase antes de usar o fluxo n8n atualizado.

create table if not exists public.gestrisk_sessoes (
  chat_id text primary key,
  gestante_id text,
  historico jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_gestrisk_sessoes_updated on public.gestrisk_sessoes (updated_at desc);

comment on table public.gestrisk_sessoes is 'Contexto de conversa por chat WhatsApp; historico = array [{role, parts}, ...] para Gemini.';

alter table public.gestrisk_sessoes enable row level security;

-- Service role do n8n ignora RLS; para anon/authenticated defina políticas depois.
