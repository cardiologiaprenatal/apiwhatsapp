# GestRisk — contrato Gemini + sessões Supabase

## Webhook

- Path: `POST /webhook/gestrisk-whatsapp` (WAHA: `WHATSAPP_HOOK_URL=http://n8n:5678/webhook/gestrisk-whatsapp`)
- Workflow: `workflows/GestRisk-WAHA-Gemini-Supabase.json` (gerar: `node scripts/build-gestrisk-workflow.js`)

## SQL (ordem)

1. `supabase/migrations/003_gestrisk_sessoes.sql`
2. `supabase/migrations/004_gestrisk_sessoes_consentimento.sql`

### `gestrisk_sessoes`

| Campo | Tipo | Notas |
|-------|------|--------|
| chat_id | text PK | ex. `5511...@c.us` |
| gestante_id | text | Laravel / fallback env |
| historico | jsonb | turnos Gemini `[{role, parts}]` |
| status | text | `open` \| `closed_user` \| `closed_timeout` |
| consentimento | text | `pending` \| `accepted` \| `declined` |
| timeout_minutos | int | default 1440 |
| memoria | jsonb | nome, semana_gestacional, sintomas, clinico, … |
| ultima_interacao_em / fechado_em / consentimento_em | timestamptz | |

### `gestrisk_gestantes_cadastro`

Telefone (PK) + consentimento LGPD; upsert quando `consentimento_resposta=sim`.

## JSON de saída do Gemini

```json
{
  "resposta_paciente": "string curta",
  "intencao": "sintoma|medida|duvida|saudacao|consentimento|encerrar|outro",
  "gravidade": "low|mid|high",
  "consentimento_resposta": "sim|nao|null",
  "encerrar_ticket": false,
  "memoria_patch": {},
  "consulta": {}
}
```

Regras do prompt: respostas curtas; sem alarmismo (“emergência”, “urgente”, …); sem prescrição; consentimento SIM/NÃO na 1ª interação; memória clínica em `memoria_patch`/`consulta`.

## Encerramento sem Gemini

- Consentimento `declined` → nó `Resposta_encerramento`.
- Timeout de sessão: a **nova mensagem retoma** o Gemini (não envia “conversa encerrada por inatividade”).
- Ticket `closed_*` em mensagem posterior **reabre** (`open`) e segue no Gemini (exceto se `declined`).
