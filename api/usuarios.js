// api/usuarios.js — gestão de equipe (somente setor TI).
//   GET                                            lista os usuários
//   POST  { nome, login, senha, email, setor }     cadastra e envia as credenciais por e-mail
//   POST  { acao: "nova-senha", id }               gera senha nova e envia por e-mail
//   PATCH { id, nome, email, login, setor, ativo } edita os dados
import { sql, usuarioPublico } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { gerarHash, gerarSenhaForte } from './_lib/senhas.js';
import { enviarCredenciais } from './_lib/email.js';

export default async function handler(req, res) {
  try {
    const admin = await exigirUsuario(req, res, { somenteTI: true });
    if (!admin) return;

    if (req.method === 'GET') {
      const usuarios = await sql`SELECT id, nome, email, login, setor, ativo FROM usuarios ORDER BY nome ASC`;
      return res.status(200).json(usuarios);
    }

    if (req.method === 'PATCH') {
      const { id, nome, email, login, setor, ativo } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Usuário não informado.' });
      const atualizados = await sql`
        UPDATE usuarios SET nome = ${nome}, email = ${email}, login = ${login}, setor = ${setor}, ativo = ${ativo !== false}
        WHERE id = ${id} RETURNING id`;
      if (atualizados.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.body?.acao === 'nova-senha') {
      const [usuario] = await sql`SELECT id, nome, email, login FROM usuarios WHERE id = ${req.body.id}`;
      if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });

      const novaSenha = gerarSenhaForte();
      await sql`UPDATE usuarios SET senha = ${await gerarHash(novaSenha)} WHERE id = ${usuario.id}`;
      try {
        await enviarCredenciais({ email: usuario.email, nome: usuario.nome, senha: novaSenha, login: usuario.login });
        return res.status(200).json({ emailEnviado: true });
      } catch (erroEmail) {
        console.error('Falha ao enviar nova senha:', erroEmail);
        // Só o TI chega aqui: devolve a senha para ele repassar ao colaborador.
        return res.status(200).json({ emailEnviado: false, senha: novaSenha });
      }
    }

    if (req.method === 'POST') {
      const { nome, login, senha, email, setor } = req.body || {};
      if (!nome || !login || !senha || !email || !setor) return res.status(400).json({ error: 'Preencha todos os campos.' });

      const existente = await sql`SELECT id FROM usuarios WHERE email = ${email} OR login = ${login} LIMIT 1`;
      if (existente.length > 0) return res.status(409).json({ error: 'Este e-mail ou login já está cadastrado.' });

      const [novo] = await sql`
        INSERT INTO usuarios (nome, login, senha, email, setor, ativo)
        VALUES (${nome}, ${login}, ${await gerarHash(senha)}, ${email}, ${setor}, true)
        RETURNING *`;

      let emailEnviado = true;
      try {
        await enviarCredenciais({ email, nome, senha, login });
      } catch (erroEmail) {
        console.error('Aviso: e-mail de boas-vindas não foi enviado.', erroEmail);
        emailEnviado = false;
      }
      return res.status(201).json({ usuario: usuarioPublico(novo), emailEnviado });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro na gestão de usuários:', error);
    return res.status(500).json({ error: 'Erro ao comunicar com o banco de dados.' });
  }
}
