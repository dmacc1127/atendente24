// Rotas de controle. Todas exigem o header Authorization: Bearer {ADMIN_TOKEN},
// menos /health.

import * as db from './db.js';
import { hoje, ontem, agora } from './tempo.js';
import { montarResumo, rotinas } from './fluxo.js';

export function json(dados, status = 200) {
  return new Response(JSON.stringify(dados, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function autorizado(req, env) {
  const esperado = (env.ADMIN_TOKEN || '').trim();
  if (!esperado) return false; // sem senha configurada, nada de controle remoto
  const h = req.headers.get('Authorization') || '';
  return h === `Bearer ${esperado}`;
}

export async function admin(req, env) {
  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, '') || '/';

  // Sem autenticacao: so diz que esta de pe
  if (rota === '/health') {
    return json({ ok: true, funcionario: 'atendente-24h', agora: agora() });
  }

  if (!autorizado(req, env)) {
    return json({ erro: 'nao autorizado' }, 401);
  }

  // POST /parar  ·  botao de panico
  if (rota === '/parar' && req.method === 'POST') {
    await db.gravarConfig(env, 'pausado', 'true');
    return json({ ok: true, pausado: true, aviso: 'recebe tudo, nao responde nada' });
  }

  // POST /voltar
  if (rota === '/voltar' && req.method === 'POST') {
    await db.gravarConfig(env, 'pausado', 'false');
    return json({ ok: true, pausado: false });
  }

  // GET /status
  if (rota === '/status') {
    const pausado = await db.estaPausado(env);
    const numeros = await db.numerosDoDia(env, hoje());
    const humanas = await db.emModoHumano(env);
    return json({ ligado: !pausado, hoje: numeros, esperando_voce: humanas.length, agora: agora() });
  }

  // GET /resumo?dia=YYYY-MM-DD
  if (rota === '/resumo') {
    const dia = url.searchParams.get('dia') || ontem();
    return json({ dia, texto: await montarResumo(env, dia) });
  }

  // GET /conversas
  if (rota === '/conversas') {
    const limite = Number(url.searchParams.get('limite') || 50);
    return json({ conversas: await db.listarConversas(env, Math.min(limite, 200)) });
  }

  // GET /conversa/:telefone
  if (rota.startsWith('/conversa/')) {
    const telefone = rota.split('/')[2];
    const conversa = await db.pegarConversa(env, telefone);
    if (!conversa) return json({ erro: 'conversa nao encontrada' }, 404);
    return json({ conversa, mensagens: await db.historico(env, telefone, 50) });
  }

  // POST /devolver/:telefone  ·  tira do modo humano
  if (rota.startsWith('/devolver/') && req.method === 'POST') {
    const telefone = rota.split('/')[2];
    const ok = await db.devolverParaIa(env, telefone);
    if (!ok) return json({ erro: 'conversa nao encontrada' }, 404);
    return json({ ok: true, telefone, modo: 'ia' });
  }

  // POST /cron  ·  roda as rotinas na mao, pra testar
  if (rota === '/cron' && req.method === 'POST') {
    return json({ ok: true, feito: await rotinas(env) });
  }

  return json({ erro: 'rota nao encontrada', rota }, 404);
}
