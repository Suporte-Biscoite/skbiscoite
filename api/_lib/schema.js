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

    // ---- Solicitações vindas do ClickUp (Fase 1: só análise) ----
    await sql`CREATE TABLE IF NOT EXISTS solicitacoes (
      id bigserial PRIMARY KEY,
      clickup_task_id text NOT NULL UNIQUE,
      titulo text NOT NULL,
      url text,
      status text NOT NULL DEFAULT 'recebida',
      sugestao text,
      rota text NOT NULL DEFAULT 'criar',
      motivos jsonb NOT NULL DEFAULT '[]'::jsonb,
      familia_campo text,
      tipo_identificacao text,
      solicitante text,
      faixa text,
      familia_prefixo text,
      prefixo_codigo text,
      status_clickup text,
      atualizado_clickup bigint,
      hash_conteudo text,
      origem text NOT NULL DEFAULT 'clickup',
      editado boolean NOT NULL DEFAULT false,
      decidido_por text,
      decidido_em timestamptz,
      motivo_recusa text,
      erro text,
      recebido_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS comentado_em timestamptz`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS encerrada_em timestamptz`;
    // Criação a partir da aprovação: fila (lote), etapas e erros de cada etapa.
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS lote_id uuid`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS auto_hash text`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS auto_motivo text`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS auto_avaliada_em timestamptz`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS ia_familia jsonb`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS ia_comentado_hash text`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS usar_codigo text`;
    await sql`ALTER TABLE cadastros ADD COLUMN IF NOT EXISTS nexaas_origem text`
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS na_fila_em timestamptz`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS codigos_em timestamptz`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS comentario_erro text`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS status_atualizado_em timestamptz`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS status_erro text`
    await sql`CREATE INDEX IF NOT EXISTS solicitacoes_status_idx ON solicitacoes (status, recebido_em DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS solicitacao_itens (
      id bigserial PRIMARY KEY,
      solicitacao_id bigint NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
      ordem integer NOT NULL,
      linha integer,
      original text,
      descricao text NOT NULL,
      avisos jsonb NOT NULL DEFAULT '[]'::jsonb,
      parecidos jsonb NOT NULL DEFAULT '[]'::jsonb,
      codigo_existente text,
      incluido boolean NOT NULL DEFAULT true,
      codigo_gerado text,
      cadastro_id bigint,
      status text NOT NULL DEFAULT 'lido')`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm text`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS entra_na_loja boolean`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm_padrao boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm_sugerido text`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm_fonte text`;
    await sql`ALTER TABLE solicitacoes ADD COLUMN IF NOT EXISTS nota_info jsonb`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm_revisado_em timestamptz`;
    await sql`ALTER TABLE solicitacao_itens ADD COLUMN IF NOT EXISTS ncm_revisado_por text`
    await sql`CREATE INDEX IF NOT EXISTS solicitacao_itens_sol_idx ON solicitacao_itens (solicitacao_id, ordem)`;
    // Cada evento do webhook entra uma vez só: a chave única é o que impede reprocessar o mesmo evento.
    await sql`CREATE TABLE IF NOT EXISTS clickup_eventos (
      id bigserial PRIMARY KEY,
      chave text NOT NULL UNIQUE,
      task_id text,
      evento text,
      resultado text,
      recebido_em timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS solicitacoes_log (
      id bigserial PRIMARY KEY,
      solicitacao_id bigint REFERENCES solicitacoes(id) ON DELETE CASCADE,
      usuario text,
      acao text NOT NULL,
      detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
      em timestamptz NOT NULL DEFAULT now())`;

  })().catch((erro) => {
    pronto = null; // tenta de novo na próxima chamada
    throw erro;
  });
  return pronto;
}
