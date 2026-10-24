-- Sessões: status/timeout/consentimento/memória + cadastro leve com consentimento LGPD.
-- Execute no SQL Editor do Supabase após 003_gestrisk_sessoes.sql.

-- ---------------------------------------------------------------------------
-- gestrisk_sessoes: campos de ticket + memória
-- ---------------------------------------------------------------------------
alter table public.gestrisk_sessoes
  add column if not exists status text not null default 'open',
  add column if not exists consentimento text not null default 'pending',
  add column if not exists consentimento_em timestamptz,
  add column if not exists fechado_em timestamptz,
  add column if not exists ultima_interacao_em timestamptz,
  add column if not exists timeout_minutos integer not null default 1440,
  add column if not exists memoria jsonb not null default '{}'::jsonb;

alter table public.gestrisk_sessoes
  drop constraint if exists gestrisk_sessoes_status_check;
alter table public.gestrisk_sessoes
  add constraint gestrisk_sessoes_status_check
  check (status in ('open', 'closed_user', 'closed_timeout'));

alter table public.gestrisk_sessoes
  drop constraint if exists gestrisk_sessoes_consentimento_check;
alter table public.gestrisk_sessoes
  add constraint gestrisk_sessoes_consentimento_check
  check (consentimento in ('pending', 'accepted', 'declined'));

comment on column public.gestrisk_sessoes.status is 'open | closed_user | closed_timeout';
comment on column public.gestrisk_sessoes.consentimento is 'pending | accepted | declined (LGPD)';
comment on column public.gestrisk_sessoes.memoria is 'JSON: nome, semana_gestacional, sintomas[], exames{}, preferencias{}, clinico{}';
comment on column public.gestrisk_sessoes.timeout_minutos is 'Fecha ticket por inatividade (default 1440 = 24h)';

create index if not exists idx_gestrisk_sessoes_status on public.gestrisk_sessoes (status);
create index if not exists idx_gestrisk_sessoes_ultima on public.gestrisk_sessoes (ultima_interacao_em desc nulls last);

-- ---------------------------------------------------------------------------
-- Cadastro leve (consentimento) — separado da sessão de chat
-- ---------------------------------------------------------------------------
create table if not exists public.gestrisk_gestantes_cadastro (
  telefone text primary key,
  nome text,
  consentimento text not null default 'pending'
    check (consentimento in ('pending', 'accepted', 'declined')),
  consentimento_em timestamptz,
  gestante_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gestrisk_gestantes_cadastro is 'Cadastro WhatsApp com consentimento LGPD; telefone só dígitos E.164 BR.';

alter table public.gestrisk_gestantes_cadastro enable row level security;

-- Service role do n8n ignora RLS.
