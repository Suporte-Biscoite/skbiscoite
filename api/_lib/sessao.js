// api/_lib/sessao.js — sessão assinada (HMAC) entregue no login e conferida em cada chamada.
import crypto from 'node:crypto';
import { sql } from './db.js';

const DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET ausente no servidor.');
  return s;
}

function assinar(conteudo) {
  return crypto.createHmac('sha256', segredo()).update(conteudo).digest('base64url');
}

export function criarToken(usuarioId) {
  const conteudo = Buffer.from(JSON.stringify({ id: usuarioId, exp: Date.now() + DURACAO_MS })).toString('base64url');
  return `${conteudo}.${assinar(conteudo)}`;
}

function lerToken(token) {
  const [conteudo, assinatura] = String(token || '').split('.');
  if (!conteudo || !assinatura) return null;
  const esperada = Buffer.from(assinar(conteudo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;
  try {
    const dados = JSON.parse(Buffer.from(conteudo, 'base64url').toString());
    return dados.exp > Date.now() ? dados : null;
  } catch {
    return null;
  }
}

// Devolve o usuário logado (relido do banco, para valer na hora se ele foi inativado)
// ou responde 401/403 e devolve null.
export async function exigirUsuario(req, res, { somenteTI = false } = {}) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const dados = lerToken(token);
  if (!dados) {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    return null;
  }
  const [usuario] = await sql`SELECT id, nome, email, login, setor, ativo FROM usuarios WHERE id = ${dados.id}`;
  if (!usuario || usuario.ativo === false) {
    res.status(401).json({ error: 'Acesso inativo ou inexistente.' });
    return null;
  }
  if (somenteTI && String(usuario.setor || '').toUpperCase() !== 'TI') {
    res.status(403).json({ error: 'Apenas o setor TI pode fazer isso.' });
    return null;
  }
  return usuario;
}
