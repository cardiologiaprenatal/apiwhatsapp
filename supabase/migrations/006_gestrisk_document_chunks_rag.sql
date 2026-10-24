-- RAG opcional no Supabase (espelho / evolução futura com embeddings).
-- No fluxo atual o retrieval principal é no Laravel (MySQL).
-- Habilita pgvector para chunks por gestante_id.

create extension if not exists vector;

create table if not exists public.gestrisk_document_chunks (
  id bigserial primary key,
  gestante_id text not null,
  source text not null default 'documento',
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists idx_gestrisk_doc_chunks_gestante
  on public.gestrisk_document_chunks (gestante_id);

comment on table public.gestrisk_document_chunks is
  'Chunks de documentos para RAG WhatsApp (opcional). Retrieval atual no Laravel.';

alter table public.gestrisk_document_chunks enable row level security;

grant select, insert, update, delete on table public.gestrisk_document_chunks to anon, authenticated, service_role;
grant usage, select on sequence public.gestrisk_document_chunks_id_seq to anon, authenticated, service_role;
