/**
 * Injeta jsCode atualizado no nó Preparar_WAHA (resolução LID + GET /contacts + GET /lids).
 * Uso: node scripts/patch-preparar-waha-telefone.js
 */
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', 'workflows', 'GestRisk-WAHA-Gemini-Supabase.json');

const jsCode = `const root = items[0].json;
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
  sd._gestriskSeenIds = sd._gestriskSeenIds || [];
  const seen = sd._gestriskSeenIds;
  if (seen.includes(mid)) {
    return [];
  }
  seen.push(mid);
  while (seen.length > 200) {
    seen.shift();
  }
}

const session = body.session || root.session || 'default';
const helpers = this.helpers;

function jidLocalPart(jid) {
  const s = String(jid || '');
  const i = s.indexOf('@');
  return i === -1 ? s : s.slice(0, i);
}

function toTelefoneDigits(jidOrDigits) {
  return jidLocalPart(jidOrDigits).replace(/\\D/g, '');
}

function toChatIdForWaha(jid) {
  if (!jid) return '';
  const s = String(jid);
  if (s.includes('@s.whatsapp.net')) {
    return jidLocalPart(s) + '@c.us';
  }
  return s;
}

function hasLid(j) {
  return j && String(j).includes('@lid');
}

/** JID com número real: grupos usam participant; DM usa from / remoteJid / remoteJidAlt (docs WAHA). */
function pickContactPhoneJid(p) {
  const key = p._data && p._data.key;
  const remote = key && key.remoteJid ? String(key.remoteJid) : '';
  const isGroup = remote.includes('@g.us');

  const alt = key && key.remoteJidAlt;
  if (alt && typeof alt === 'string' && !hasLid(alt)) {
    return alt.trim();
  }

  if (isGroup && key.participant && typeof key.participant === 'string') {
    const part = key.participant.trim();
    if (!hasLid(part)) return part;
  }

  const fr = String(p.from || '').trim();
  if (fr && !hasLid(fr)) {
    return fr;
  }

  const rj = key && key.remoteJid && typeof key.remoteJid === 'string' ? key.remoteJid.trim() : '';
  if (rj && !rj.includes('@g.us') && !hasLid(rj)) {
    return rj;
  }

  if (key && key.participant && typeof key.participant === 'string') {
    return key.participant.trim();
  }

  return fr || rj || '';
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
    return data && data.pn ? String(data.pn) : null;
  } catch (e) {
    return null;
  }
}

async function resolveContact(contactId) {
  if (!contactId) return null;
  try {
    return await wahaGet(
      '/api/contacts?contactId=' +
        encodeURIComponent(contactId) +
        '&session=' +
        encodeURIComponent(session),
    );
  } catch (e) {
    return null;
  }
}

function telefonePareceIncompleto(d) {
  if (!d) return true;
  if (d.length < 11) return true;
  return false;
}

/**
 * Formato esperado na API Laravel: só dígitos, E.164 BR, ex. 5511987266302 (55 + DDD + 9 + 8).
 * - WAHA pode devolver só DDD+número (11 dígitos) → prefixa 55.
 * - JID antigo às vezes vem 12 dígitos (55 + DDD + 8 sem o 9) → insere 9 após o DDD.
 */
function normalizeTelefoneBrParaApi(digits) {
  let d = String(digits || '').replace(/\\D/g, '');
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
  let phoneJid = pickContactPhoneJid(payload);
  let fromRaw = String(payload.from || '').trim();
  let chatId = toChatIdForWaha(phoneJid || fromRaw);
  let telefone = toTelefoneDigits(phoneJid || fromRaw);

  const key = payload._data && payload._data.key;
  const precisaResolver =
    hasLid(fromRaw) ||
    hasLid(phoneJid) ||
    (key && hasLid(key.participant)) ||
    (key && hasLid(key.remoteJid)) ||
    telefonePareceIncompleto(telefone);

  if (precisaResolver) {
    let pnJid = null;
    const tentarLids = [fromRaw, phoneJid, key && key.participant, key && key.remoteJid];
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
      let c = await resolveContact(fromRaw);
      if (!c || !(c.number || c.id)) c = await resolveContact(phoneJid);
      if (!c || !(c.number || c.id)) c = await resolveContact(key && key.participant);
      if (!c || !(c.number || c.id)) c = await resolveContact(key && key.remoteJid);

      if (c) {
        if (c.number) {
          telefone = String(c.number).replace(/\\D/g, '');
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

  const PHONE_TO_GESTANTE = {
    // exemplo: '5521987654321': 'GEST-001',
  };

  const DEFAULT_GESTANTE_ID = 'GEST-001';
  const gestante_id = PHONE_TO_GESTANTE[telefone] || DEFAULT_GESTANTE_ID;

  return [
    {
      json: {
        message,
        chatId,
        telefone,
        session,
        gestante_id,
      },
    },
  ];
})();`;

const w = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = w.nodes.find((n) => n.name === 'Preparar_WAHA');
if (!node) {
  console.error('Nó Preparar_WAHA não encontrado');
  process.exit(1);
}
node.parameters.jsCode = jsCode;
fs.writeFileSync(workflowPath, JSON.stringify(w, null, 2) + '\n');
console.log('OK:', workflowPath);
