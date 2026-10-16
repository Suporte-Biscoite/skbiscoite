// api/_lib/db.js — conexão com o banco Neon (Postgres).
// Pastas e arquivos que começam com "_" dentro de /api não viram rotas na Vercel.
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('ERRO CRÍTICO: DATABASE_URL não encontrada no servidor.');
}

export const sql = neon(process.env.DATABASE_URL || '');

// Campos do usuário que podem sair do servidor (nunca a senha).
export const CAMPOS_PUBLICOS_USUARIO = ['id', 'nome', 'email', 'login', 'setor', 'ativo'];

export function usuarioPublico(usuario) {
  return Object.fromEntries(CAMPOS_PUBLICOS_USUARIO.map((campo) => [campo, usuario[campo]]));
}
