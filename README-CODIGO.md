# O código do Atendente 24h

Esta pasta é o seu atendente pronto. Você não escreve nada, só preenche e manda pro ar.

**Comece pelo `CONTEXTO.md` desta pasta.** É de lá que ele tira tudo que sabe. Campo vazio é
espaço pra ele inventar.

## Os 5 comandos, nesta ordem

Abra o terminal dentro desta pasta e rode um de cada vez:

```
npm install
npx wrangler login
npx wrangler d1 create atendente
npx wrangler d1 execute atendente --remote --file=./schema.sql
npx wrangler deploy
```

No terceiro comando o computador devolve um `database_id`. Copie e cole no `wrangler.toml`, onde
está escrito `PREENCHA-COM-O-ID...`, antes de seguir. E antes do deploy cadastre as senhas com
`npx wrangler secret put NOME`, uma por vez: os nomes estão todos no `.dev.vars.example`.

## O webhook e o botão de pânico

Depois do deploy o terminal mostra o seu endereço. O webhook é ele mais `/webhook`, e é isso que
você cola no painel do WhatsApp: `https://SEU-ENDERECO.workers.dev/webhook`

Salve o botão de pânico no bloco de notas do celular. Pra religar, troque `parar` por `voltar`:

```
curl -X POST https://SEU-ENDERECO.workers.dev/parar -H "Authorization: Bearer SUA-SENHA"
```

## Pra mudar qualquer coisa

Preço, endereço, horário: edite o `CONTEXTO.md`. O jeito dele falar: o `CEREBRO.md`.
Depois rode `npx wrangler deploy` aqui dentro. Trinta segundos e está valendo.
