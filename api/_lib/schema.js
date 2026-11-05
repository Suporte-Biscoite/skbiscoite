// api/_lib/schema.js — cria as tabelas novas na primeira chamada (só CREATE ... IF NOT EXISTS:
// nunca mexe em usuarios nem historico_skus). Roda uma vez por instância da função.
import { sql as sqlPadrao } from './db.js';

let pronto = null;

export function garantirEsquema(sql = sqlPadrao) {
  pronto ??= (async () => {
    // Espelho dos produtos do Omie: evita baixar os ~7 mil produtos a cada cadastro.
    await sql`CREATE TABLE IF NOT EXISTS omie_produtos (
      codigo text PRIMARY KEY,
      descricao text NOT NULL DEFAULT '',
      descricao_norm text NOT NULL DEFAULT '',
      codigo_produto bigint,
      inativo boolean NOT NULL DEFAULT false,
      atualizado_em timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS omie_produtos_desc_idx ON omie_produtos (descricao_norm)`;

    await sql`CREATE TABLE IF NOT EXISTS omie_familias (
      codigo bigint PRIMARY KEY,
      cod_familia text,
      nome text NOT NULL,
      nome_norm text NOT NULL,
      inativa boolean NOT NULL DEFAULT false)`;

    // Estado simples chave/valor (progresso da sincronização, cache do Nexaas...).
    await sql`CREATE TABLE IF NOT EXISTS sync_meta (
      chave text PRIMARY KEY,
      valor jsonb NOT NULL DEFAULT '{}'::jsonb,
      atualizado_em timestamptz NOT NULL DEFAULT now())`;

    // Um registro por produto cadastrado: é a fila, o histórico e a auditoria ao mesmo tempo.
    await sql`CREATE TABLE IF NOT EXISTS cadastros (
      id bigserial PRIMARY KEY,
      lote_id uuid NOT NULL,
      linha integer,
      usuario_email text,
      descricao text NOT NULL,
      ncm text NOT NULL,
      entra_na_loja boolean NOT NULL,
      sazonal boolean NOT NULL DEFAULT false,
      familia_base text NOT NULL,
      familia_prefixo text NOT NULL,
      familia_omie text NOT NULL,
      categoria_nexaas text NOT NULL,
      codigo text,
      acao text,
      codigo_produto_omie bigint,
      omie_status text NOT NULL DEFAULT 'pendente',
      omie_erro text,
      omie_id bigint,
      nexaas_status text NOT NULL DEFAULT 'pendente',
      nexaas_erro text,
      nexaas_id bigint,
      iniciado_em timestamptz,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now())`;
    // O mesmo código nunca pode ser reservado por dois cadastros (isso evita duplicar entre usuários).
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS cadastros_codigo_uni ON cadastros (codigo) WHERE codigo IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS cadastros_lote_idx ON cadastros (lote_id)`;
  })().catch((erro) => {
    pronto = null; // tenta de novo na próxima chamada
    throw erro;
  });
  return pronto;
}
