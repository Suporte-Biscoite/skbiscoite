// api/login.js — confere login/e-mail e senha e devolve o usuário com o token de sessão.
import { sql, usuarioPublico } from './_lib/db.js';
import { conferirSenha } from './_lib/senhas.js';
import { criarToken } from './_lib/sessao.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  const identificador = String(req.body?.usuario || '').trim();
  const senha = String(req.body?.senha || '');
  if (!identificador || !senha) return res.status(400).json({ error: 'Informe login e senha.' });

  try {
    const candidatos = await sql`SELECT * FROM usuarios WHERE email = ${identificador} OR login = ${identificador}`;
    let usuario = null;
    for (const candidato of candidatos) {
      if (await conferirSenha(senha, candidato.senha)) { usuario = candidato; break; }
    }

    if (!usuario) return res.status(401).json({ error: 'Credenciais incorretas.' });
    if (usuario.ativo === false) return res.status(403).json({ error: 'Seu acesso está inativo. Contate o administrador.' });

    return res.status(200).json({ usuario: usuarioPublico(usuario), token: criarToken(usuario.id) });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({ error: 'Erro de comunicação com o banco de dados.' });
  }
}
