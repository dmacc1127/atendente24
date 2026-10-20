// Envio e normalizacao do WhatsApp. Dois provedores: YCloud e Z-API.
// MODO DE TESTE: chave vazia ou com a palavra "teste" e nada sai daqui, so loga.

export function modoTesteWhats(env) {
  const p = (env.WHATSAPP_PROVIDER || 'ycloud').toLowerCase();
  const chave = p === 'zapi' ? (env.ZAPI_TOKEN || '') : (env.YCLOUD_API_KEY || '');
  const k = chave.trim();
  return !k || k.toLowerCase() === 'teste';
}

// Telefone sempre 5511999999999: pais, DDD, numero. Sem +, sem espaco, sem traco.
export function normalizarTelefone(bruto) {
  if (!bruto) return '';
  let n = String(bruto).replace(/\D/g, '');
  if (n.length >= 10 && n.length <= 11) n = '55' + n; // veio sem o pais
  return n;
}

export async function enviar(env, telefone, texto) {
  const para = normalizarTelefone(telefone);
  if (!para || !texto) return { ok: false, motivo: 'sem destino ou sem texto' };

  if (modoTesteWhats(env)) {
    console.log(`[teste] enviaria para ${para}: ${texto}`);
    return { ok: true, teste: true };
  }

  const provedor = (env.WHATSAPP_PROVIDER || 'ycloud').toLowerCase();
  try {
    if (provedor === 'zapi') return await enviarZapi(env, para, texto);
    return await enviarYcloud(env, para, texto);
  } catch (e) {
    console.log(`erro ao enviar para ${para}: ${e.message}`);
    return { ok: false, motivo: e.message };
  }
}

async function enviarYcloud(env, para, texto) {
  const r = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
    method: 'POST',
    headers: { 'X-API-Key': env.YCLOUD_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: normalizarTelefone(env.YCLOUD_FROM),
      to: para,
      type: 'text',
      text: { body: texto }
    })
  });
  if (!r.ok) throw new Error(`YCloud ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { ok: true };
}

async function enviarZapi(env, para, texto) {
  const url = `https://api.z-api.io/instances/${env.ZAPI_INSTANCE}/token/${env.ZAPI_TOKEN}/send-text`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = env.ZAPI_CLIENT_TOKEN;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: para, message: texto })
  });
  if (!r.ok) throw new Error(`Z-API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { ok: true };
}

// Le o corpo do webhook dos dois provedores e devolve sempre o mesmo formato.
// Tambem aceita o formato simples { telefone, texto, id } pra facilitar o teste local.
export function normalizar(body) {
  if (!body || typeof body !== 'object') return null;

  // Formato simples de teste
  if (body.telefone && (body.texto !== undefined)) {
    return {
      telefone: normalizarTelefone(body.telefone),
      texto: String(body.texto || ''),
      idExterno: body.id || body.id_externo || null,
      nome: body.nome || null,
      daEmpresa: body.fromMe === true,
      tipo: body.tipo || 'text'
    };
  }

  // YCloud
  const y = body.whatsappInboundMessage;
  if (y) {
    const tipo = y.type || 'text';
    return {
      telefone: normalizarTelefone(y.from),
      texto: tipo === 'text' ? String(y.text?.body || '') : '',
      idExterno: y.id || null,
      nome: y.customerProfile?.name || y.profile?.name || null,
      daEmpresa: false,
      tipo
    };
  }

  // Z-API
  if (body.phone) {
    const tipo = body.text?.message !== undefined ? 'text'
      : (body.audio ? 'audio' : body.image ? 'image' : body.document ? 'document' : 'outro');
    return {
      telefone: normalizarTelefone(body.phone),
      texto: String(body.text?.message || ''),
      idExterno: body.messageId || null,
      nome: body.senderName || body.chatName || null,
      daEmpresa: body.fromMe === true,
      tipo
    };
  }

  return null;
}
