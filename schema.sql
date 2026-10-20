-- Banco do Atendente 24h. Roda uma vez.
--   local:     npx wrangler d1 execute atendente --local  --file=./schema.sql
--   producao:  npx wrangler d1 execute atendente --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS conversas (
  telefone      TEXT PRIMARY KEY,
  nome          TEXT,
  etapa         TEXT DEFAULT 'abrir',
  modo          TEXT DEFAULT 'ia',          -- ia | humano
  dados         TEXT DEFAULT '{}',          -- JSON do que ja descobriu
  confirmacoes  INTEGER DEFAULT 0,          -- quantas vezes disse "vou confirmar"
  nao_soube     TEXT DEFAULT '[]',          -- JSON: o que ele nao soube responder
  escalada_em   TEXT,
  motivo_escala TEXT,
  criada_em     TEXT,
  ultima_em     TEXT
);

CREATE TABLE IF NOT EXISTS mensagens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telefone    TEXT NOT NULL,
  direcao     TEXT NOT NULL,                -- in | out
  texto       TEXT NOT NULL,
  id_externo  TEXT,
  respondida  INTEGER DEFAULT 0,
  criada_em   TEXT
);

-- Indice unico parcial: e ele que impede responder a mesma mensagem duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS idx_externo
  ON mensagens(id_externo) WHERE id_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pendentes
  ON mensagens(respondida, direcao, criada_em);
CREATE INDEX IF NOT EXISTS idx_msg_tel
  ON mensagens(telefone, criada_em);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
INSERT OR IGNORE INTO config VALUES ('pausado', 'false');
INSERT OR IGNORE INTO config VALUES ('ultimo_resumo', '');
