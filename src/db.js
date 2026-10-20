// Todas as queries. Nada de estado em variavel: o Worker e sem memoria.
import { agora, hoje, ontem, agoraMenos } from './tempo.js';

// ---------- config ----------

export async function lerConfig(env, chave, padrao = null) {
  const r = await env.DB.prepare('SELECT valor FROM config WHERE chave = ?').bind(chave).first();
  return r ? r.valor : padrao;
}

export async function gravarConfig(env, chave, valor) {
  await env.DB.prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  ).bind(chave, String(valor)).run();
}

export async function estaPausado(env) {
  return (await lerConfig(env, 'pausado', 'false')) === 'true';
}

// ---------- conversas ----------

export async function pegarConversa(env, telefone) {
  return await env.DB.prepare('SELECT * FROM conversas WHERE telefone = ?').bind(telefone).first();
}

export async function criarConversaSeNaoExiste(env, telefone, nome) {
  const t = agora();
  await env.DB.prepare(
    `INSERT INTO conversas (telefone, nome, etapa, modo, dados, confirmacoes, nao_soube, criada_em, ultima_em)
     VALUES (?, ?, 'abrir', 'ia', '{}', 0, '[]', ?, ?)
     ON CONFLICT(telefone) DO UPDATE SET
       ultima_em = excluded.ultima_em,
       nome = COALESCE(conversas.nome, excluded.nome)`
  ).bind(telefone, nome || null, t, t).run();
  return await pegarConversa(env, telefone);
}

export async function atualizarConversa(env, telefone, campos) {
  const permitidos = ['nome', 'etapa', 'modo', 'dados', 'confirmacoes', 'nao_soube', 'escalada_em', 'motivo_escala'];
  const chaves = Object.keys(campos).filter(k => permitidos.includes(k));
  if (!chaves.length) return;
  const set = chaves.map(k => `${k} = ?`).join(', ');
  const valores = chaves.map(k => campos[k]);
  await env.DB.prepare(`UPDATE conversas SET ${set}, ultima_em = ? WHERE telefone = ?`)
    .bind(...valores, agora(), telefone).run();
}

export async function marcarHumano(env, telefone, motivo) {
  await env.DB.prepare(
    `UPDATE conversas SET modo = 'humano', escalada_em = ?, motivo_escala = ?, ultima_em = ? WHERE telefone = ?`
  ).bind(agora(), motivo || null, agora(), telefone).run();
}

export async function devolverParaIa(env, telefone) {
  const r = await env.DB.prepare(
    `UPDATE conversas SET modo = 'ia', escalada_em = NULL, motivo_escala = NULL, ultima_em = ? WHERE telefone = ?`
  ).bind(agora(), telefone).run();
  return r.meta.changes > 0;
}

export async function listarConversas(env, limite = 50) {
  const r = await env.DB.prepare(
    'SELECT telefone, nome, etapa, modo, confirmacoes, criada_em, ultima_em FROM conversas ORDER BY ultima_em DESC LIMIT ?'
  ).bind(limite).all();
  return r.results || [];
}

// ---------- mensagens ----------

// Salva a mensagem que chegou. Devolve null se o id_externo ja existia (reenvio do provedor).
export async function salvarEntrada(env, telefone, texto, idExterno) {
  try {
    const r = await env.DB.prepare(
      `INSERT INTO mensagens (telefone, direcao, texto, id_externo, respondida, criada_em)
       VALUES (?, 'in', ?, ?, 0, ?)`
    ).bind(telefone, texto, idExterno || null, agora()).run();
    return r.meta.last_row_id;
  } catch (e) {
    // Violou o indice unico = ja processamos essa mensagem
    if (String(e).includes('UNIQUE')) return null;
    throw e;
  }
}

export async function salvarSaida(env, telefone, texto) {
  await env.DB.prepare(
    `INSERT INTO mensagens (telefone, direcao, texto, respondida, criada_em) VALUES (?, 'out', ?, 1, ?)`
  ).bind(telefone, texto, agora()).run();
}

export async function pendentesDoTelefone(env, telefone) {
  const r = await env.DB.prepare(
    `SELECT * FROM mensagens WHERE telefone = ? AND direcao = 'in' AND respondida = 0 ORDER BY id ASC`
  ).bind(telefone).all();
  return r.results || [];
}

// Marca como respondida so se ainda estiver 0. Se outra execucao pegou antes,
// meta.changes vem 0 e quem chamou deve parar.
export async function marcarRespondida(env, id) {
  const r = await env.DB.prepare(
    'UPDATE mensagens SET respondida = 1 WHERE id = ? AND respondida = 0'
  ).bind(id).run();
  return r.meta.changes > 0;
}

export async function marcarVariasRespondidas(env, ids) {
  if (!ids.length) return;
  const marcas = ids.map(() => '?').join(',');
  await env.DB.prepare(`UPDATE mensagens SET respondida = 1 WHERE id IN (${marcas})`).bind(...ids).run();
}

export async function historico(env, telefone, limite = 20) {
  const r = await env.DB.prepare(
    `SELECT direcao, texto, criada_em FROM mensagens WHERE telefone = ? ORDER BY id DESC LIMIT ?`
  ).bind(telefone, limite).all();
  return (r.results || []).reverse();
}

// Varredura de resgate do cron: mensagens que ficaram sem resposta.
// O parametro vem de agoraMenos(), nunca de datetime('now'): o banco grava local.
export async function orfas(env, minutosAtras = 2) {
  const limite = agoraMenos(minutosAtras / 60);
  const r = await env.DB.prepare(
    `SELECT DISTINCT m.telefone FROM mensagens m
     JOIN conversas c ON c.telefone = m.telefone
     WHERE m.respondida = 0 AND m.direcao = 'in' AND m.criada_em < ?
       AND c.modo = 'ia'
     LIMIT 20`
  ).bind(limite).all();
  return (r.results || []).map(x => x.telefone);
}

// ---------- numeros ----------

export async function numerosDoDia(env, dia) {
  const d = dia || hoje();
  const conversas = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM conversas WHERE substr(criada_em, 1, 10) = ?`
  ).bind(d).first();
  const entrada = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mensagens WHERE direcao = 'in' AND substr(criada_em, 1, 10) = ?`
  ).bind(d).first();
  const saida = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mensagens WHERE direcao = 'out' AND substr(criada_em, 1, 10) = ?`
  ).bind(d).first();
  const escaladas = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM conversas WHERE substr(escalada_em, 1, 10) = ?`
  ).bind(d).first();
  const noLevar = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM conversas WHERE etapa IN ('levar','fechar') AND substr(ultima_em, 1, 10) = ?`
  ).bind(d).first();
  return {
    dia: d,
    conversas_novas: conversas?.n || 0,
    mensagens_recebidas: entrada?.n || 0,
    mensagens_enviadas: saida?.n || 0,
    escaladas: escaladas?.n || 0,
    chegaram_no_proximo_passo: noLevar?.n || 0
  };
}

export async function conversasDoDia(env, dia) {
  const d = dia || ontem();
  const r = await env.DB.prepare(
    `SELECT telefone, nome, etapa, modo, motivo_escala, nao_soube
     FROM conversas WHERE substr(ultima_em, 1, 10) = ? ORDER BY ultima_em ASC`
  ).bind(d).all();
  return r.results || [];
}

export async function emModoHumano(env) {
  const r = await env.DB.prepare(
    `SELECT telefone, nome, motivo_escala, escalada_em FROM conversas WHERE modo = 'humano' ORDER BY escalada_em ASC`
  ).all();
  return r.results || [];
}
