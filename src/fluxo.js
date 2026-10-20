// O coracao do atendente: recebe a mensagem, agrupa a rajada, chama a IA,
// aplica as regras de negocio EM CODIGO e responde.

import CEREBRO from '../CEREBRO.md';
import CONTEXTO from '../CONTEXTO.md';

import { agora, hoje, ontem, hora } from './tempo.js';
import * as db from './db.js';
import { pensar } from './ia.js';
import { enviar, normalizar } from './whatsapp.js';

const ESPERA_RAJADA_MS = 8000;   // tempo de espera pra juntar mensagens seguidas
const MAX_CONFIRMACOES = 2;      // disse "vou confirmar" 2 vezes, escala

// Monta o prompt: o cerebro, o contexto, o estado e a hora.
export function montarSystem(conversa, extra = '') {
  return `${CEREBRO}

## CONTEXTO DA EMPRESA
${CONTEXTO}

## ESTADO DESTA CONVERSA
Agora: ${agora()} (horario local)
Hora do dia: ${hora()}h
Nome do cliente: ${conversa.nome || 'nao sei ainda'}
Etapa: ${conversa.etapa}
Ja descobri: ${conversa.dados || '{}'}
Vezes que voce ja disse que ia confirmar algo: ${conversa.confirmacoes || 0}
${extra}`;
}

// Envia as bolhas com intervalo humano e registra cada uma.
export async function responder(env, telefone, mensagens) {
  const bolhas = (mensagens || []).slice(0, 2).map(m => String(m || '').trim()).filter(Boolean);
  for (let i = 0; i < bolhas.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    await enviar(env, telefone, bolhas[i]);
    await db.salvarSaida(env, telefone, bolhas[i]);
  }
  return bolhas.length;
}

// Passa pro humano: marca, avisa o dono e para de responder.
export async function escalar(env, conversa, motivo) {
  await db.marcarHumano(env, conversa.telefone, motivo);

  const ultimas = await db.historico(env, conversa.telefone, 5);
  const linhas = ultimas.map(m => `${m.direcao === 'in' ? 'cliente' : 'atendente'}: ${m.texto}`).join('\n');
  const url = env.PUBLIC_URL || 'https://SEU-ENDERECO.workers.dev';
  const devolver = `curl -X POST ${url}/devolver/${conversa.telefone} -H "Authorization: Bearer SUA-SENHA"`;

  const aviso =
    `Atendimento precisa de voce\n\n` +
    `Nome: ${conversa.nome || 'Sem nome'}\n` +
    `Telefone: ${conversa.telefone}\n` +
    `Motivo: ${motivo}\n\n` +
    `Ultimas mensagens:\n${linhas || '(sem historico)'}\n\n` +
    `Para devolver pra IA depois:\n${devolver}`;

  if (env.TELEFONE_DONO) await enviar(env, env.TELEFONE_DONO, aviso);
  return aviso;
}

// Ponto de entrada do webhook.
export async function processarWebhook(env, body) {
  const msg = normalizar(body);
  if (!msg || !msg.telefone) return;

  // 2. eco: mensagem que a propria empresa mandou
  if (msg.daEmpresa) return;

  const conversa = await db.criarConversaSeNaoExiste(env, msg.telefone, msg.nome);

  // 5. nao e texto: pede por escrito e para
  if (msg.tipo && msg.tipo !== 'text') {
    // Registra pra nao ficar invisivel no historico
    await db.salvarEntrada(env, msg.telefone, `[${msg.tipo}]`, msg.idExterno);
    if (await db.estaPausado(env)) return;
    if (conversa.modo === 'humano') return;
    await responder(env, msg.telefone, ['recebi aqui, mas nao consigo ouvir/abrir. consegue me mandar por escrito?']);
    return;
  }

  // 1. dedup: id_externo que ja existe = reenvio do provedor
  const id = await db.salvarEntrada(env, msg.telefone, msg.texto, msg.idExterno);
  if (id === null) return;

  // 3. pausado: salvou, nao responde
  if (await db.estaPausado(env)) return;

  // 4. modo humano: salvou, nao responde
  if (conversa.modo === 'humano') return;

  await processarComRajada(env, msg.telefone, id);
}

// Agrupa mensagens em rajada.
// Salva, espera 8s, busca as nao respondidas. Se a mais nova chegou DEPOIS desta,
// para: a execucao dela responde por todas. Sem a espera, numa rajada de tres
// NENHUMA processaria e a conversa ficaria muda ate o cron.
export async function processarComRajada(env, telefone, meuId) {
  await new Promise(r => setTimeout(r, ESPERA_RAJADA_MS));
  await processarPendentes(env, telefone, meuId);
}

export async function processarPendentes(env, telefone, meuId = null) {
  const pendentes = await db.pendentesDoTelefone(env, telefone);
  if (!pendentes.length) return;

  const maiorId = Math.max(...pendentes.map(m => m.id));
  // Se chegou mensagem depois da minha, quem responde e a execucao dela.
  if (meuId !== null && maiorId > meuId) return;

  // Trava: so uma execucao processa. Se o UPDATE nao mudou nada, outra pegou antes.
  const peguei = await db.marcarRespondida(env, maiorId);
  if (!peguei) return;

  const outros = pendentes.filter(m => m.id !== maiorId).map(m => m.id);
  await db.marcarVariasRespondidas(env, outros);

  const conversa = await db.pegarConversa(env, telefone);
  if (!conversa || conversa.modo === 'humano') return;
  if (await db.estaPausado(env)) return;

  await gerarResposta(env, conversa, pendentes);
}

async function gerarResposta(env, conversa, pendentes) {
  const hist = await db.historico(env, conversa.telefone, 20);
  const mensagensIa = hist.map(m => ({
    role: m.direcao === 'in' ? 'user' : 'assistant',
    content: m.texto
  }));

  let resposta;
  try {
    resposta = await pensar(env, montarSystem(conversa), mensagensIa);
  } catch (e) {
    console.log(`IA falhou para ${conversa.telefone}: ${e.message}`);
    await escalar(env, conversa, 'A IA falhou duas vezes seguidas. Assuma a conversa.');
    return;
  }

  // ---- regras de negocio, em CODIGO ----

  // Merge do que ja sabia com o que descobriu agora. Nao confie no modelo pra manter.
  const dados = { ...seguroJson(conversa.dados, {}), ...(resposta.dados || {}) };

  let confirmacoes = conversa.confirmacoes || 0;
  const naoSoube = seguroJson(conversa.nao_soube, []);

  if (resposta.confirmou) {
    confirmacoes += 1;
    // Guarda o que ele nao soube responder. Isso vira a lista de tarefas do dono.
    const ultimaDoCliente = [...pendentes].reverse()[0]?.texto;
    if (ultimaDoCliente) naoSoube.push({ pergunta: ultimaDoCliente.slice(0, 200), em: agora() });
  }

  let escalarAgora = resposta.escalar === true;
  let motivo = resposta.motivo_escalar || 'A IA pediu ajuda';

  // O contador de "vou confirmar". Esta regra NAO mora no prompt.
  if (confirmacoes >= MAX_CONFIRMACOES && !escalarAgora) {
    escalarAgora = true;
    const perguntas = naoSoube.slice(-MAX_CONFIRMACOES).map(x => `"${x.pergunta}"`).join(' e ');
    motivo = `Duas perguntas sem resposta no contexto: ${perguntas}`;
  }

  await db.atualizarConversa(env, conversa.telefone, {
    etapa: resposta.etapa || conversa.etapa,
    dados: JSON.stringify(dados),
    confirmacoes,
    nao_soube: JSON.stringify(naoSoube.slice(-20))
  });

  await responder(env, conversa.telefone, resposta.mensagens);

  if (escalarAgora) {
    const atual = await db.pegarConversa(env, conversa.telefone);
    await escalar(env, atual, motivo);
  }
}

function seguroJson(texto, padrao) {
  try { return JSON.parse(texto || ''); } catch { return padrao; }
}

// ---------- rotinas do cron ----------

export async function rotinas(env) {
  const feito = { resgatadas: 0, resumo: false };

  // 1. varredura de resgate: mensagem que ficou sem resposta
  const telefones = await db.orfas(env, 2);
  for (const tel of telefones) {
    try {
      await processarPendentes(env, tel, null);
      feito.resgatadas += 1;
    } catch (e) {
      console.log(`resgate falhou para ${tel}: ${e.message}`);
    }
  }

  // 2. resumo diario as 8h, uma vez por dia
  if (hora() === 8) {
    const ultimo = await db.lerConfig(env, 'ultimo_resumo', '');
    if (ultimo !== hoje()) {
      await db.gravarConfig(env, 'ultimo_resumo', hoje());
      const texto = await montarResumo(env, ontem());
      if (env.TELEFONE_DONO) await enviar(env, env.TELEFONE_DONO, texto);
      feito.resumo = true;
    }
  }

  return feito;
}

export async function montarResumo(env, dia) {
  const d = dia || ontem();
  const n = await db.numerosDoDia(env, d);
  const conversas = await db.conversasDoDia(env, d);

  const linhas = conversas.slice(0, 30).map(c => {
    const quem = c.nome || c.telefone;
    const marca = c.modo === 'humano' ? ' (com voce)' : '';
    return `- ${quem}: ${c.etapa}${marca}`;
  });

  const naoSoube = [];
  for (const c of conversas) {
    for (const item of seguroJson(c.nao_soube, [])) {
      if (String(item.em || '').slice(0, 10) === d) naoSoube.push(item.pergunta);
    }
  }

  const escaladas = conversas.filter(c => c.motivo_escala);

  let texto = `Resumo de ${d}\n\n`;
  texto += `Conversas novas: ${n.conversas_novas}\n`;
  texto += `Mensagens recebidas: ${n.mensagens_recebidas}\n`;
  texto += `Passei pra voce: ${n.escaladas}\n`;
  texto += `Chegaram no proximo passo: ${n.chegaram_no_proximo_passo}\n`;

  if (escaladas.length) {
    texto += `\nPor que passei pra voce:\n` + escaladas.map(c => `- ${c.nome || c.telefone}: ${c.motivo_escala}`).join('\n') + '\n';
  }

  if (naoSoube.length) {
    texto += `\nO que eu nao soube responder (coloque a resposta no CONTEXTO.md):\n`;
    texto += [...new Set(naoSoube)].slice(0, 15).map(p => `- ${p}`).join('\n') + '\n';
  }

  if (linhas.length) texto += `\nAs conversas:\n${linhas.join('\n')}\n`;
  if (!conversas.length) texto += `\nNenhuma conversa nesse dia.\n`;

  return texto;
}
