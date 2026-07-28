// api/enviar-email.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  // Agora recebemos também o "login"
  const { email, nome, senha, login } = req.body;

  if (!email || !nome || !senha) {
    return res.status(400).json({ error: 'E-mail, nome e senha são obrigatórios.' });
  }

  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      console.error("ERRO CRÍTICO: RESEND_API_KEY não encontrada no servidor.");
      throw new Error("Chave de API do Resend ausente no servidor.");
    }

    // Se o login for passado no cadastro, mostramos ele. Se não, mostramos o e-mail como login de acesso.
    const loginExibicao = login || email;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'SKBiscoitê Sistema <sistema@biscolab.tech>', 
        to: [email],
        subject: 'Credenciais de Acesso - SKBiscoitê',
        html: `
          <div style="font-family: 'DM Sans', Arial, sans-serif; color: #2B1E16; max-width: 600px; margin: 0 auto; border: 1px solid #EAE3D9; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #2B1E16; padding: 20px; text-align: center;">
              <h2 style="color: #C89B3C; margin: 0; font-size: 24px; font-family: 'Playfair Display', serif;">SKBiscoitê</h2>
            </div>
            <div style="padding: 30px; background-color: #FDFBF7;">
              <p style="font-size: 16px;">Olá, <strong>${nome}</strong>.</p>
              <p style="font-size: 16px;">Suas credenciais de acesso corporativo foram geradas/atualizadas com sucesso. Seguem os dados para acesso:</p>
              
              <div style="background-color: #FFFFFF; padding: 25px; border: 1px dashed #C89B3C; margin: 30px 0; border-radius: 6px; text-align: center;">
                <p style="margin: 0 0 15px 0; font-size: 16px; color: #6D5C53;"><strong>Login:</strong> <span style="color: #2B1E16;">${loginExibicao}</span></p>
                <p style="margin: 0; font-size: 16px; color: #6D5C53;"><strong>Senha provisória:</strong> <br/><br/><span style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #2B1E16;">${senha}</span></p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://skbiscoite.biscolab.tech" style="background-color: #C89B3C; color: #2B1E16; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">Acessar Plataforma</a>
              </div>

              <p style="font-size: 14px; text-align: center;"><strong>Atenção:</strong> Por motivos de segurança, recomendamos que você altere esta senha no seu próximo login.</p>
              <hr style="border: none; border-top: 1px solid #EAE3D9; margin: 30px 0;" />
              <p style="font-size: 12px; color: #6D5C53; text-align: center;">Este é um e-mail automático do sistema de gestão de SKUs, não responda.</p>
            </div>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Falha ao disparar Resend');
    }

    return res.status(200).json({ success: true, message: 'E-mail disparado com sucesso.' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro no servidor: ' + error.message });
  }
}