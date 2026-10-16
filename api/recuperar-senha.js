// api/recuperar-senha.js — gera uma senha nova e envia para o e-mail cadastrado.
// A senha só é trocada se o e-mail sair, e ela nunca volta para o navegador.
import { sql } from './_lib/db.js';
import { gerarHash, gerarSenhaForte } from './_lib/senhas.js';
import { enviarCredenciais } from './_lib/email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Use POST.' });

  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });

  try {
    const [usuario] = await sql`SELECT id, nome, email, login FROM usuarios WHERE email = ${email} LIMIT 1`;
    if (!usuario) return res.status(404).json({ error: 'E-mail não encontrado no sistema.' });

    const novaSenha = gerarSenhaForte();
    try {
      await enviarCredenciais({ email: usuario.email, nome: usuario.nome, senha: novaSenha, login: usuario.login });
    } catch (erroEmail) {
      console.error('Falha ao enviar e-mail de recuperação:', erroEmail);
      return res.status(502).json({ error: 'Não foi possível enviar o e-mail agora. Sua senha não foi alterada; tente novamente ou contate o TI.' });
    }

    await sql`UPDATE usuarios SET senha = ${await gerarHash(novaSenha)} WHERE id = ${usuario.id}`;
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro na recuperação de senha:', error);
    return res.status(500).json({ error: 'Erro ao comunicar com o banco de dados.' });
  }
}
