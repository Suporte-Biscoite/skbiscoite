// api/_lib/senhas.js — geração e hash de senhas (bcrypt).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export const gerarHash = (senha) => bcrypt.hash(senha, 10);

export async function conferirSenha(senha, hash) {
  if (!hash || !String(hash).startsWith('$2')) return false;
  return bcrypt.compare(senha, hash);
}

export function gerarSenhaForte(tamanho = 12) {
  const grupos = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%&*?'];
  const todos = grupos.join('');
  const sortear = (texto) => texto[crypto.randomInt(texto.length)];

  const caracteres = grupos.map(sortear);
  while (caracteres.length < tamanho) caracteres.push(sortear(todos));
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}
