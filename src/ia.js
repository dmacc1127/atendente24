// Chamada da IA via OpenRouter.
// MODO DE TESTE: se a chave estiver vazia ou com a palavra "teste", nada sai daqui
// pra internet e a resposta e simulada. E o que permite testar de graca.

const PADRAO_MODELO = 'google/gemini-3-flash-preview';

export function modoTeste(env) {
  const k = (env.OPENROUTER_API_KEY || '').trim();
  return !k || k.toLowerCase() === 'teste';
}

export async function pensar(env, system, historico, opcoes = {}) {
  if (modoTeste(env)) return respostaSimulada(historico);

  const corpo = {
    model: opcoes.modelo || env.OPENROUTER_MODEL || PADRAO_MODELO,
    messages: [{ role: 'system', content: system }, ...historico],
    temperature: opcoes.temperatura ?? 0.7,
    response_format: { type: 'json_object' }
  };

  // Tenta duas vezes. Falhou as duas, quem chamou escala.
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(corpo)
      });

      if (r.status === 429) {
        // Pico de uso. Espera e tenta de novo uma vez.
        await new Promise(res => setTimeout(res, 2000));
        ultimoErro = new Error('IA 429: limite de requisicao');
        continue;
      }
      if (!r.ok) throw new Error(`IA ${r.status}: ${(await r.text()).slice(0, 300)}`);

      const j = await r.json();
      return extrairJson(j.choices?.[0]?.message?.content);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro || new Error('IA falhou');
}

// O modelo as vezes embrulha em ```json. Trate sempre.
export function extrairJson(texto) {
  if (!texto) throw new Error('IA devolveu vazio');
  const limpo = String(texto).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const m = limpo.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* cai fora */ }
    }
    throw new Error('IA devolveu JSON quebrado');
  }
}

// Resposta simulada do modo de teste. Reage a palavras-chave pra dar pra testar
// os caminhos de escalar, confirmar e pergunta vaga sem gastar um centavo.
function respostaSimulada(historico) {
  const ultima = [...historico].reverse().find(m => m.role === 'user')?.content || '';
  const t = ultima.toLowerCase();

  const pedeHumano = /(falar com (uma )?(pessoa|humano|atendente|vendedor|dono)|me passa pro|quero falar com algu)/i.test(t);
  const reclamacao = /(reembolso|nota fiscal|cobran|processo|procon|advogad)/i.test(t);
  const naoSabe = /\[naosabe\]/i.test(t);
  const precoVago = /^\s*(quanto custa|qual o pre[cç]o|quanto e|quanto fica)\s*\??\s*$/i.test(ultima.trim());
  const garantia = /(resolve mesmo|funciona mesmo|garant|isso resolve meu problema)/i.test(t);

  if (pedeHumano || reclamacao) {
    return {
      mensagens: ['[teste] beleza, vou chamar alguem do time aqui'],
      etapa: 'entender',
      dados: {},
      confirmou: false,
      escalar: true,
      motivo_escalar: pedeHumano ? 'Pediu para falar com uma pessoa' : 'Assunto de dinheiro ja pago ou juridico'
    };
  }
  if (naoSabe) {
    return {
      mensagens: [`[teste] esse eu confirmo com o time e ja te falo`],
      etapa: 'entender',
      dados: {},
      confirmou: true,
      escalar: false,
      motivo_escalar: null
    };
  }
  if (precoVago) {
    return {
      mensagens: ['[teste] custa de que? me diz o que voce precisa que eu te falo'],
      etapa: 'entender',
      dados: {},
      confirmou: false,
      escalar: false,
      motivo_escalar: null
    };
  }
  if (garantia) {
    return {
      mensagens: ['[teste] nao consigo garantir resultado, cada caso e um caso', '[teste] o melhor caminho e alguem do time olhar o seu. consegue quinta as 10h?'],
      etapa: 'levar',
      dados: {},
      confirmou: false,
      escalar: false,
      motivo_escalar: null
    };
  }

  return {
    mensagens: ['[teste] resposta simulada', '[teste] me conta um pouco mais do que voce precisa?'],
    etapa: 'entender',
    dados: { visto_no_teste: true },
    confirmou: false,
    escalar: false,
    motivo_escalar: null
  };
}
