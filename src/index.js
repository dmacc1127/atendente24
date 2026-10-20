// Entrada do Worker: fetch (webhook + rotas) e scheduled (cron).

import { processarWebhook, rotinas } from './fluxo.js';
import { admin } from './admin.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // O webhook NAO exige auth: o provedor de WhatsApp nao manda Bearer.
    if (url.pathname === '/webhook') {
      if (req.method !== 'POST') return new Response('ok');
      const body = await req.json().catch(() => null);
      if (!body) return new Response('ok'); // corpo invalido: ignora em silencio

      // Responde 200 na hora e processa depois. Provedor que nao recebe 200 rapido reenvia.
      ctx.waitUntil(processarWebhook(env, body).catch(e => console.log(`webhook: ${e.message}`)));
      return new Response('ok');
    }

    return admin(req, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(rotinas(env).catch(e => console.log(`cron: ${e.message}`)));
  }
};
