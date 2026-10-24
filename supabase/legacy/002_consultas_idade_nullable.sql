-- Idade pode ser desconhecida quando a mensagem WhatsApp não traz dado (ex.: só "oi").
-- Opcional: permitir NULL em vez de 0 enviado pelo n8n quando a IA não extrai idade.
-- Execute no SQL Editor do Supabase.
alter table public.consultas
  alter column idade drop not null;

comment on column public.consultas.idade is 'Idade da gestante; NULL se não informada. O fluxo n8n pode enviar 0 como placeholder se a coluna for NOT NULL.';
