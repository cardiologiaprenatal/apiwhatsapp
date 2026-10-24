/**
 * Gera workflows/GestRisk-WAHA-Gemini-Supabase.json
 * Topologia do fluxo anexado + prompt/consentimento/timeout/memória.
 */
const fs = require('fs');
const path = require('path');

const prepararWaha = String.raw`const root = items[0].json;
const body = root.body ?? root;
const event = body.event ?? root.event;
const payload = body.payload ?? root.payload ?? {};

if (event !== 'message') {
  return [];
}
if (payload.fromMe === true) {
  return [];
}

const message = String(payload.body ?? '').trim();
if (!message) {
  return [];
}

function waMsgId(p) {
  const id = p && p.id;
  if (id == null || id === '') return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && id._serialized) return String(id._serialized);
  return String(id);
}

const mid = waMsgId(payload);
if (mid) {
  const sd = $getWorkflowStaticData('global');
  sd._gestriskSeenIds = sd._gestriskSeenIds || {};
  const seen = sd._gestriskSeenIds;
  const now = Date.now();
  if (seen[mid] && now - seen[mid] < 120000) {
    return [];
  }
  seen[mid] = now;
  const keys = Object.keys(seen);
  while (keys.length > 300) {
    delete seen[keys.shift()];
  }
}

const session = body.session || root.session || 'default';
const helpers = this.helpers;

function jidLocalPart(jid) {
  const s = String(jid || '');
  const i = s.indexOf('@');
  return i === -1 ? s : s.slice(0, i);
}

function hasLid(j) {
  return j && String(j).includes('@lid');
}

function isPhoneJid(j) {
  if (!j || hasLid(j)) return false;
  const s = String(j);
  return s.includes('@c.us') || s.includes('@s.whatsapp.net');
}

function allJidCandidates(p) {
  const key = (p._data && p._data.key) || {};
  return [key.remoteJidAlt, key.remoteJid, key.participant, p.from, p.chatId]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean);
}

function pickContactPhoneJid(p) {
  const cands = allJidCandidates(p);
  for (const j of cands) {
    if (isPhoneJid(j)) return j;
  }
  for (const j of cands) {
    if (!hasLid(j)) return j;
  }
  return cands[0] || '';
}

function toTelefoneDigits(jidOrDigits) {
  return jidLocalPart(jidOrDigits).replace(/\D/g, '');
}

function toChatIdForWaha(jid) {
  if (!jid) return '';
  const s = String(jid);
  if (s.includes('@s.whatsapp.net')) {
    return jidLocalPart(s) + '@c.us';
  }
  if (!s.includes('@')) {
    return jidLocalPart(s) + '@c.us';
  }
  return s;
}

async function wahaGet(pathAndQuery) {
  const url = 'http://waha:3000' + pathAndQuery;
  return helpers.httpRequest({ method: 'GET', url, json: true });
}

async function resolveLidToPn(lidJid) {
  const lid = jidLocalPart(lidJid);
  if (!lid) return null;
  try {
    const data = await wahaGet(
      '/api/' + encodeURIComponent(session) + '/lids/' + encodeURIComponent(lid),
    );
    const pn = data && data.pn ? String(data.pn) : '';
    return pn || null;
  } catch (e) {
    return null;
  }
}

async function resolveContact(contactId) {
  if (!contactId) return null;
  try {
    const data = await wahaGet(
      '/api/contacts?contactId=' +
        encodeURIComponent(contactId) +
        '&session=' +
        encodeURIComponent(session),
    );
    if (!data) return null;
    return Array.isArray(data) ? data[0] : data;
  } catch (e) {
    return null;
  }
}

function pareceNumeroBrValido(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return false;
  if (d.startsWith('55') && d.length >= 12 && d.length <= 13) return true;
  if (d.length === 10 || d.length === 11) return true;
  return false;
}

function normalizeTelefoneBrParaApi(digits) {
  let d = String(digits || '').replace(/\D/g, '');
  if (!d) return '';

  if (!d.startsWith('55') && d.length === 11) {
    const d1 = d.charCodeAt(0) - 48;
    const d2 = d.charCodeAt(1) - 48;
    const ddd = d1 * 10 + d2;
    if (ddd >= 11 && ddd <= 99) {
      d = '55' + d;
    }
  }

  if (d.startsWith('55') && d.length === 12 && d.charAt(4) !== '9') {
    d = d.slice(0, 4) + '9' + d.slice(4);
  }

  return d;
}

return (async () => {
  const key = payload._data && payload._data.key;
  const cands = allJidCandidates(payload);
  let phoneJid = pickContactPhoneJid(payload);
  let fromRaw = String(payload.from || '').trim();
  let chatId = toChatIdForWaha(phoneJid || fromRaw);
  let telefone = toTelefoneDigits(phoneJid || fromRaw);

  const lidJids = [...new Set(cands.filter(hasLid))];
  const precisaResolver =
    lidJids.length > 0 ||
    hasLid(fromRaw) ||
    hasLid(phoneJid) ||
    (key && hasLid(key.participant)) ||
    (key && hasLid(key.remoteJid)) ||
    !pareceNumeroBrValido(telefone);

  if (precisaResolver) {
    let pnJid = null;
    const tentarLids = [
      ...lidJids,
      fromRaw,
      phoneJid,
      key && key.participant,
      key && key.remoteJid,
      key && key.remoteJidAlt,
    ];
    for (const j of tentarLids) {
      if (j && hasLid(j)) {
        pnJid = await resolveLidToPn(j);
        if (pnJid) break;
      }
    }

    if (pnJid) {
      phoneJid = pnJid;
      chatId = toChatIdForWaha(pnJid);
      telefone = toTelefoneDigits(pnJid);
    } else {
      let c = null;
      for (const id of [...new Set(cands)]) {
        c = await resolveContact(id);
        if (c && (c.number || c.id)) break;
      }

      if (c) {
        if (c.number) {
          telefone = String(c.number).replace(/\D/g, '');
        } else if (c.id) {
          telefone = toTelefoneDigits(c.id);
        }
        if (c.id) {
          chatId = toChatIdForWaha(c.id);
          phoneJid = c.id;
        }
      }
    }
  }

  telefone = normalizeTelefoneBrParaApi(telefone);

  const PHONE_TO_GESTANTE = {};
  const gestante_id = PHONE_TO_GESTANTE[telefone] ? String(PHONE_TO_GESTANTE[telefone]) : '';

  return [
    {
      json: {
        message,
        chatId,
        telefone,
        session,
        gestante_id,
        telefone_resolvido: pareceNumeroBrValido(telefone),
      },
    },
  ];
})();`;

const mesclarLaravel = String.raw`const prep = $('Preparar_WAHA').first().json;
const laravelItem = $('Laravel_log_entrada').first().json;

function parseBody(raw) {
  if (raw == null) return null;
  let b = raw.body !== undefined ? raw.body : raw;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch (e) {
      return null;
    }
  }
  return b && typeof b === 'object' ? b : null;
}

const status = laravelItem.statusCode ?? laravelItem.status;
const body = parseBody(laravelItem);
const ok = status === 201 || status === '201';

let gestante_id = '';
if (ok && body && body.gestante_id != null && body.gestante_id !== '') {
  gestante_id = String(body.gestante_id);
}

if (!gestante_id && prep.gestante_id) {
  gestante_id = String(prep.gestante_id);
}

const fallback = $env.GESTRISK_DEFAULT_GESTANTE_ID || '';
if (!gestante_id && fallback) {
  gestante_id = String(fallback);
}

const respostaPronta = ok && body ? String(body.resposta_pronta || '').trim() : '';
const fluxo_respondido = respostaPronta.length > 0;
const pular_ia = fluxo_respondido || (ok && body && body.pular_ia === true);

return [
  {
    json: {
      ...prep,
      gestante_id,
      laravel_gestante_id: ok && body ? body.gestante_id : null,
      fluxo_respondido,
      pular_ia,
      fluxo_estado: ok && body ? body.fluxo_estado || null : null,
    },
  },
];`;

const supabaseGet = String.raw`const prep = $('Mesclar_Laravel_gestante').first().json;
let base = String($env.SUPABASE_URL ?? '');
if (base.endsWith('/')) base = base.slice(0, -1);
const select =
  'chat_id,gestante_id,historico,status,consentimento,consentimento_em,fechado_em,ultima_interacao_em,timeout_minutos,memoria';
const url =
  base +
  '/rest/v1/gestrisk_sessoes?chat_id=eq.' +
  encodeURIComponent(prep.chatId) +
  '&select=' +
  select;
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
const helpers = this.helpers;

return (async () => {
  let rows = [];
  try {
    const data = await helpers.httpRequest({
      method: 'GET',
      url,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
      },
      json: true,
    });
    rows = Array.isArray(data) ? data : [];
  } catch (e) {
    rows = [];
  }

  const row = rows[0] || null;
  let status = row && row.status ? String(row.status) : 'open';
  let consentimento = row && row.consentimento ? String(row.consentimento) : 'pending';
  const timeoutMin = Number(row && row.timeout_minutos != null ? row.timeout_minutos : 1440) || 1440;
  const ultima = row && row.ultima_interacao_em ? new Date(row.ultima_interacao_em) : null;
  const memoria =
    row && row.memoria && typeof row.memoria === 'object' && !Array.isArray(row.memoria)
      ? row.memoria
      : {};

  let motivo_encerramento = null;
  let mensagem_encerramento = null;
  let timedOut = false;

  if (status === 'open' && ultima && !Number.isNaN(ultima.getTime())) {
    const limiteMs = timeoutMin * 60 * 1000;
    if (Date.now() - ultima.getTime() > limiteMs) {
      timedOut = true;
      status = 'open';
    }
  }

  // Ticket já fechado: a nova mensagem retoma o atendimento (exceto consentimento recusado).
  if (status === 'closed_user' || status === 'closed_timeout') {
    status = 'open';
  }

  if (!motivo_encerramento && consentimento === 'declined') {
    motivo_encerramento = 'consentimento_declined';
    mensagem_encerramento =
      'Tudo bem. Sem o seu consentimento não seguimos com o atendimento por aqui. Cuide-se e conte com a equipe de saúde do seu acompanhamento presencial.';
  }

  const continuar_gemini = !motivo_encerramento && !prep.fluxo_respondido && !prep.pular_ia;

  return [
    {
      json: {
        rows,
        row,
        status,
        consentimento,
        timedOut,
        timeout_minutos: timeoutMin,
        memoria,
        continuar_gemini,
        motivo_encerramento,
        mensagem_encerramento,
      },
    },
  ];
})();`;

const montarPrompt = String.raw`const prep = $('Mesclar_Laravel_gestante').first().json;
const sess = $('Supabase_GET_sessao').first().json;
const msg = String(prep.message || '').trim();
if (!msg) {
  return [];
}

let historicoCarregado = [];
let rowList = Array.isArray(sess.rows) ? sess.rows : [];
if (Array.isArray(rowList) && rowList[0] && Array.isArray(rowList[0].historico)) {
  historicoCarregado = rowList[0].historico;
}

let gestante_id = String(prep.gestante_id || '');
if (!gestante_id && Array.isArray(rowList) && rowList[0] && rowList[0].gestante_id) {
  gestante_id = String(rowList[0].gestante_id);
}

const memoria =
  sess.memoria && typeof sess.memoria === 'object' ? sess.memoria : {};
const consentimento = String(sess.consentimento || 'pending');
const semana =
  memoria.semana_gestacional != null ? String(memoria.semana_gestacional) : '';

// RAG Laravel (prontuário + documentos indexados)
let ragTexto = '';
let ragFound = false;
let ragIntencao = '';
try {
  const ragItem = $('Laravel_RAG').first().json;
  let rb = ragItem && (ragItem.body !== undefined ? ragItem.body : ragItem);
  if (typeof rb === 'string') {
    try { rb = JSON.parse(rb); } catch (e) { rb = null; }
  }
  if (rb && typeof rb === 'object') {
    ragFound = !!rb.found;
    ragIntencao = String(rb.intencao || '');
    ragTexto = String(rb.contexto_texto || '');
    if (!gestante_id && rb.gestante_id != null) {
      gestante_id = String(rb.gestante_id);
    }
  }
} catch (e) {
  ragTexto = '';
}

const usarProntuario = ragIntencao === 'exames_consultas';
const regrasRag = usarProntuario
  ? [
      'Regras do RAG: use só o que estiver nesses trechos; se não houver dado, diga que não há registro no prontuário; não invente exames, consultas, datas, horários, locais, profissionais ou resultados.',
      'Nunca interprete exames, faça diagnóstico, recomende medicamentos ou classifique sintomas como normais/graves.',
      'Não complete informações ausentes com conhecimento médico geral. Não altere dados das APIs.',
    ].join('\n')
  : '';

const prior = Array.isArray(historicoCarregado) ? historicoCarregado.slice(-24) : [];
const contents = prior.concat([{ role: 'user', parts: [{ text: msg }] }]);

const systemText = [
  'Você é uma assistente de saúde para gestantes, com postura de obstetra experiente: acolhedora, clara e objetiva.',
  'Fale em português do Brasil, linguagem simples. Evite termos técnicos sem explicação curta.',
  'Respostas CURTAS: 2 a 5 frases no campo resposta_paciente. Sem listas longas.',
  'Use o histórico em contents, a memória e o contexto abaixo. NÃO repita perguntas já respondidas (nome, sintomas, consentimento).',
  '',
  'Memória atual (JSON): ' + JSON.stringify(memoria),
  'Consentimento LGPD atual: ' + consentimento,
  semana ? 'Semana gestacional conhecida: ' + semana + '. Adapte o tom à fase da gravidez.' : 'Semana gestacional ainda desconhecida.',
  '',
  usarProntuario ? 'RAG / prontuário (fonte Laravel; found=' + String(ragFound) + '):' : 'Conversa (sem prontuário nesta mensagem):',
  ragTexto || (usarProntuario ? 'Sem trechos RAG disponíveis nesta mensagem.' : 'Converse de forma acolhedora. Não consulte o prontuário nesta mensagem.'),
  regrasRag,
  '',
  'Regras de segurança:',
  '- Nunca prescreva medicamentos, doses ou condutas invasivas.',
  '- Reforce, com naturalidade, que este canal NÃO substitui consulta presencial com a equipe de saúde.',
  '- NÃO use no texto ao paciente palavras alarmistas como: emergência, emergencial, urgente, urgência, agora (no sentido de alarme), imediato, correr.',
  '- Se a situação parecer grave (classifique gravidade=high), oriente com calma a procurar a unidade de saúde / equipe de referência, sem alarmismo.',
  '',
  'Consentimento (obrigatório na 1ª interação se consentimento=pending):',
  '- Explique em 1–2 frases que podemos guardar dados do atendimento para acompanhar melhor.',
  '- Peça resposta clara: SIM ou NÃO.',
  '- Se a mensagem atual já for sim/não, preencha consentimento_resposta e siga.',
  '',
  'Encerrar ticket: se a pessoa pedir para finalizar/encerrar/parar o atendimento, encerrar_ticket=true e uma despedida curta.',
  '',
  'Extraia dados clínicos e de perfil quando existirem na mensagem ou no contexto (memoria_patch + consulta).',
  'O IMC NÃO deve aparecer no JSON (é calculado no banco se houver peso/altura).',
  '',
  'Classificação interna (não verbalizar alarmismo):',
  '- pressao_sistolica >= 160 → gravidade high',
  '- glicemia >= 180 → gravidade high',
  '- doppler_umbilical == 2 → gravidade high',
  '',
  'IMPORTANTE: responda APENAS com JSON válido, sem markdown e sem texto fora do JSON.',
  '',
  'Formato:',
  '{',
  '  "resposta_paciente": "string",',
  '  "intencao": "sintoma|medida|duvida|saudacao|consentimento|encerrar|outro",',
  '  "gravidade": "low|mid|high",',
  '  "consentimento_resposta": "sim|nao|null",',
  '  "encerrar_ticket": false,',
  '  "memoria_patch": {',
  '    "nome": null,',
  '    "semana_gestacional": null,',
  '    "sintomas": [],',
  '    "preferencias": {},',
  '    "exames": {},',
  '    "clinico": {',
  '      "pressao_sistolica": null,',
  '      "glicemia": null,',
  '      "frequencia_cardiaca": null,',
  '      "febre": null,',
  '      "doppler_umbilical": null,',
  '      "percentil_peso": null,',
  '      "volume_liquido": null,',
  '      "peso_gestante": null,',
  '      "altura_gestante": null',
  '    }',
  '  },',
  '  "consulta": {',
  '    "idade": null,',
  '    "pressao_sistolica": null,',
  '    "glicemia": null,',
  '    "frequencia_cardiaca": null,',
  '    "doppler_umbilical": null,',
  '    "percentil_peso": null,',
  '    "volume_liquido": null,',
  '    "peso_gestante": null,',
  '    "altura_gestante": null',
  '  }',
  '}',
].join('\n');

const geminiBody = {
  systemInstruction: { parts: [{ text: systemText }] },
  contents,
  generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
};

return [
  {
    json: {
      ...prep,
      gestante_id,
      consentimento,
      memoria,
      status: sess.status || 'open',
      timeout_minutos: sess.timeout_minutos || 1440,
      rag_found: ragFound,
      geminiBody,
      _historicoAntes: prior,
    },
  },
];`;

const montarResposta = String.raw`const prep = $('Mesclar_Laravel_gestante').first().json;
const mp = $('Montar_prompt').first().json;
const prior = Array.isArray(mp._historicoAntes) ? mp._historicoAntes.slice() : [];
const g = items[0].json;
const helpers = this.helpers;

return (async () => {
  let text = g.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const fence = String.fromCharCode(96).repeat(3);
  text = text
    .replace(new RegExp('^' + fence + 'json\\s*', 'i'), '')
    .replace(new RegExp(fence + '\\s*$'), '')
    .trim();

  let ai;
  try {
    ai = JSON.parse(text);
  } catch (e) {
    throw new Error('Gemini não retornou JSON válido: ' + String(text).slice(0, 800));
  }

  function deepMerge(base, patch) {
    const out = { ...(base || {}) };
    if (!patch || typeof patch !== 'object') return out;
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        const prev = Array.isArray(out[k]) ? out[k] : [];
        out[k] = [...new Set(prev.concat(v).map((x) => String(x)))].slice(-40);
      } else if (typeof v === 'object') {
        out[k] = deepMerge(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  let reply = String(
    ai.resposta_paciente ||
      'Obrigada pela mensagem. Estou aqui para apoiar no seu acompanhamento. Este canal não substitui a consulta presencial com a equipe de saúde.',
  );

  const banned = /\b(emerg[eê]ncia|emergencial|urg[eê]ncia|urgente|imediato|corra|correr)\b/gi;
  reply = reply.replace(banned, '').replace(/\s{2,}/g, ' ').trim();

  let memoria = deepMerge(mp.memoria || {}, ai.memoria_patch || {});
  if (ai.consulta && typeof ai.consulta === 'object') {
    memoria.clinico = deepMerge(memoria.clinico || {}, ai.consulta);
  }

  let consentimento = String(mp.consentimento || 'pending');
  let status = String(mp.status || 'open');
  let consentimento_em = null;
  let fechado_em = null;
  const nowIso = new Date().toISOString();

  const cr = ai.consentimento_resposta;
  if (cr === 'sim' || cr === 'SIM' || cr === true) {
    consentimento = 'accepted';
    consentimento_em = nowIso;
  }
  if (cr === 'nao' || cr === 'não' || cr === 'NAO' || cr === 'NÃO' || cr === false) {
    consentimento = 'declined';
    consentimento_em = nowIso;
    status = 'closed_user';
    fechado_em = nowIso;
    reply =
      'Tudo bem. Sem o seu consentimento não seguimos com o atendimento por aqui. Cuide-se e conte com a equipe de saúde do seu acompanhamento presencial.';
  }

  if (ai.encerrar_ticket === true) {
    status = 'closed_user';
    fechado_em = nowIso;
  }

  const msg = String(prep.message || '').trim();
  let h = prior;
  h.push({ role: 'user', parts: [{ text: msg }] });
  h.push({ role: 'model', parts: [{ text: reply }] });
  h = h.slice(-40);

  const gestante_id = mp.gestante_id || prep.gestante_id || '';

  if (consentimento === 'accepted' && prep.telefone) {
    try {
      let base = String($env.SUPABASE_URL ?? '');
      if (base.endsWith('/')) base = base.slice(0, -1);
      const key = $env.SUPABASE_SERVICE_ROLE_KEY;
      await helpers.httpRequest({
        method: 'POST',
        url: base + '/rest/v1/gestrisk_gestantes_cadastro?on_conflict=telefone',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: {
          telefone: String(prep.telefone).replace(/\D/g, ''),
          nome: memoria.nome || null,
          consentimento: 'accepted',
          consentimento_em: consentimento_em || nowIso,
          gestante_id: gestante_id || null,
          updated_at: nowIso,
        },
        json: true,
      });
    } catch (e) {
      // não interrompe o fluxo
    }
  }

  return [
    {
      json: {
        resposta_paciente: reply,
        telefone: prep.telefone,
        chatId: prep.chatId,
        session: prep.session,
        gestante_id,
        ai,
        sessao_body: {
          chat_id: prep.chatId,
          gestante_id,
          historico: h,
          status,
          consentimento,
          consentimento_em,
          fechado_em,
          ultima_interacao_em: nowIso,
          timeout_minutos: mp.timeout_minutos || 1440,
          memoria,
          updated_at: nowIso,
        },
      },
    },
  ];
})();`;

const respostaEncerramento = String.raw`const prep = $('Mesclar_Laravel_gestante').first().json;
const sess = $('Supabase_GET_sessao').first().json;
const nowIso = new Date().toISOString();

const reply = String(
  sess.mensagem_encerramento ||
    'Esta conversa já foi finalizada. Se precisar de um novo atendimento, envie uma nova mensagem.',
);

const row = sess.row || {};
const historico = Array.isArray(row.historico) ? row.historico.slice(-40) : [];
historico.push({ role: 'user', parts: [{ text: String(prep.message || '') }] });
historico.push({ role: 'model', parts: [{ text: reply }] });

const status = String(sess.status || 'closed_user');
const consentimento = String(sess.consentimento || 'pending');

return [
  {
    json: {
      resposta_paciente: reply,
      telefone: prep.telefone,
      chatId: prep.chatId,
      session: prep.session,
      gestante_id: prep.gestante_id || (row.gestante_id ? String(row.gestante_id) : ''),
      sessao_body: {
        chat_id: prep.chatId,
        gestante_id: prep.gestante_id || row.gestante_id || null,
        historico,
        status,
        consentimento,
        consentimento_em: row.consentimento_em || null,
        fechado_em: row.fechado_em || (status.startsWith('closed') ? nowIso : null),
        ultima_interacao_em: nowIso,
        timeout_minutos: sess.timeout_minutos || 1440,
        memoria: sess.memoria || {},
        updated_at: nowIso,
      },
    },
  },
];`;

const workflow = {
  id: 'a8f7e6d5-c4b3-4210-9876-543210fedcba',
  name: 'GestRisk — WAHA → Gemini → Sessão',
  active: true,
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'gestrisk-whatsapp',
        responseMode: 'responseNode',
        options: {},
      },
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Webhook_WAHA',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: 'gestrisk-waha-gemini',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: prepararWaha },
      id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      name: 'Preparar_WAHA',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [208, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ ($env.LARAVEL_APP_URL || '').replace(/\\/$/, '') + '/api/v1/n8n/whatsapp/mensagens/' + encodeURIComponent(String($json.telefone || '').replace(/\\D/g, '')) }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Accept', value: 'application/json' },
            { name: 'X-Webhook-Secret', value: "={{ $env.WAHA_WEBHOOK_SECRET || '' }}" },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ mensagem: String($json.message || ''), tipo: 'entrada' }) }}",
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          timeout: 30000,
        },
      },
      id: 'f1a2b3c4-d5e6-4789-a012-345678901aaa',
      name: 'Laravel_log_entrada',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [432, 112],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      continueOnFail: true,
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: mesclarLaravel },
      id: '8464d689-7106-4375-8386-ee877f84fd6e',
      name: 'Mesclar_Laravel_gestante',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [400, -304],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'cond-pular-ia-laravel',
              leftValue: '={{ $json.pular_ia }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-pular-ia-laravel-01',
      name: 'IF_pular_ia_laravel',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [520, -160],
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: supabaseGet },
      id: 'b3c4d5e6-f7a8-9012-bcde-f23456789012',
      name: 'Supabase_GET_sessao',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [656, -320],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'cond-continuar-gemini',
              leftValue: '={{ $json.continuar_gemini }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'if-continuar-gemini-01',
      name: 'IF_continuar_gemini',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [820, -320],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ ($env.LARAVEL_APP_URL || '').replace(/\\/$/, '') + '/api/v1/n8n/whatsapp/rag/' + encodeURIComponent(String($('Mesclar_Laravel_gestante').first().json.telefone || '').replace(/\\D/g, '')) }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Accept', value: 'application/json' },
            { name: 'X-Webhook-Secret', value: "={{ $env.WAHA_WEBHOOK_SECRET || '' }}" },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ mensagem: String($('Mesclar_Laravel_gestante').first().json.message || ''), top_k: 6 }) }}",
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          timeout: 30000,
        },
      },
      id: 'laravel-rag-01',
      name: 'Laravel_RAG',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [960, -400],
      continueOnFail: true,
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 2000,
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: montarPrompt },
      id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
      name: 'Montar_prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1140, -400],
    },
    {
      parameters: {
        method: 'POST',
        url: "=https://generativelanguage.googleapis.com/v1beta/models/{{ $env.GEMINI_MODEL || 'gemini-flash-latest' }}:generateContent?key={{ $env.GEMINI_API_KEY }}",
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.geminiBody) }}',
        options: { timeout: 120000 },
      },
      id: 'd4e5f6a7-b8c9-0123-def0-234567890123',
      name: 'Gemini_API',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1320, -400],
      retryOnFail: true,
      maxTries: 5,
      waitBetweenTries: 5000,
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: montarResposta },
      id: 'e5f6a7b8-c9d0-1234-ef01-345678901234',
      name: 'Montar_resposta',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1500, -400],
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: respostaEncerramento },
      id: 'resp-encerrar-01',
      name: 'Resposta_encerramento',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1000, -160],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ ($env.LARAVEL_APP_URL || '').replace(/\\/$/, '') + '/api/v1/n8n/whatsapp/mensagens/' + encodeURIComponent(String($json.telefone || '').replace(/\\D/g, '')) }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Accept', value: 'application/json' },
            { name: 'X-Webhook-Secret', value: "={{ $env.WAHA_WEBHOOK_SECRET || '' }}" },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ mensagem: String($json.resposta_paciente || ''), tipo: 'saida' }) }}",
        options: {
          response: { response: { fullResponse: true, neverError: true } },
          timeout: 30000,
        },
      },
      id: 'f1a2b3c4-d5e6-4789-a012-34567890abbb',
      name: 'Laravel_log_saida',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1680, -280],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 65000,
      continueOnFail: true,
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ $env.SUPABASE_URL.replace(/\\/$/, '') + '/rest/v1/gestrisk_sessoes?on_conflict=chat_id' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
            { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Prefer', value: 'resolution=merge-duplicates,return=minimal' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify($('Montar_resposta').isExecuted ? $('Montar_resposta').first().json.sessao_body : $('Resposta_encerramento').first().json.sessao_body) }}",
        options: {},
      },
      id: 'f6a7b8c9-d0e1-2345-f012-456789012345',
      name: 'Supabase_save_sessao',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1860, -280],
      continueOnFail: true,
    },
    {
      parameters: {
        method: 'POST',
        url: '=http://waha:3000/api/sendText',
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ session: ($('Montar_resposta').isExecuted ? $('Montar_resposta').first().json.session : $('Resposta_encerramento').first().json.session), chatId: ($('Montar_resposta').isExecuted ? $('Montar_resposta').first().json.chatId : $('Resposta_encerramento').first().json.chatId), text: ($('Montar_resposta').isExecuted ? $('Montar_resposta').first().json.resposta_paciente : $('Resposta_encerramento').first().json.resposta_paciente) }) }}",
        options: {},
      },
      id: 'b8c9d0e1-f2a3-4567-1234-678901234567',
      name: 'WAHA_sendText',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2040, -280],
      continueOnFail: true,
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify({ ok: true }) }}',
        options: {},
      },
      id: 'c9d0e1f2-a3b4-5678-2345-789012345678',
      name: 'Respond_Webhook',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [2220, -280],
    },
  ],
  connections: {
    Webhook_WAHA: { main: [[{ node: 'Preparar_WAHA', type: 'main', index: 0 }]] },
    Preparar_WAHA: { main: [[{ node: 'Laravel_log_entrada', type: 'main', index: 0 }]] },
    Laravel_log_entrada: {
      main: [[{ node: 'Mesclar_Laravel_gestante', type: 'main', index: 0 }]],
    },
    Mesclar_Laravel_gestante: {
      main: [[{ node: 'IF_pular_ia_laravel', type: 'main', index: 0 }]],
    },
    IF_pular_ia_laravel: {
      main: [
        [{ node: 'Respond_Webhook', type: 'main', index: 0 }],
        [{ node: 'Supabase_GET_sessao', type: 'main', index: 0 }],
      ],
    },
    Supabase_GET_sessao: {
      main: [[{ node: 'IF_continuar_gemini', type: 'main', index: 0 }]],
    },
    IF_continuar_gemini: {
      main: [
        [{ node: 'Laravel_RAG', type: 'main', index: 0 }],
        [{ node: 'Resposta_encerramento', type: 'main', index: 0 }],
      ],
    },
    Laravel_RAG: { main: [[{ node: 'Montar_prompt', type: 'main', index: 0 }]] },
    Montar_prompt: { main: [[{ node: 'Gemini_API', type: 'main', index: 0 }]] },
    Gemini_API: { main: [[{ node: 'Montar_resposta', type: 'main', index: 0 }]] },
    Montar_resposta: { main: [[{ node: 'Laravel_log_saida', type: 'main', index: 0 }]] },
    Resposta_encerramento: {
      main: [[{ node: 'Laravel_log_saida', type: 'main', index: 0 }]],
    },
    Laravel_log_saida: {
      main: [[{ node: 'Supabase_save_sessao', type: 'main', index: 0 }]],
    },
    Supabase_save_sessao: {
      main: [[{ node: 'WAHA_sendText', type: 'main', index: 0 }]],
    },
    WAHA_sendText: { main: [[{ node: 'Respond_Webhook', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: 'v1', binaryMode: 'separate' },
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

const out = path.join(__dirname, '..', 'workflows', 'GestRisk-WAHA-Gemini-Supabase.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2), 'utf8');
console.log('Wrote', out);
