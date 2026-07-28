// api/enviar-email.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  const { email, nome, senha } = req.body;

  if (!email || !nome || !senha) {
    return res.status(400).json({ error: 'E-mail, nome e senha são obrigatórios.' });
  }

  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // Se a chave não existir no servidor, já trava e avisa no log
    if (!RESEND_API_KEY) {
      console.error("ERRO CRÍTICO: RESEND_API_KEY não foi encontrada na Vercel.");
      throw new Error("Chave de API do Resend ausente no servidor.");
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        // Usando o domínio oficial que você verificou
        from: 'Sistema Biscoitê <sistema@biscolab.tech>', 
        to: [email],
        subject: 'Redefinição de Acesso - Gestão de Pessoas',
        html: `
          <div style="font-family: Arial, sans-serif; color: #2B1E16; max-width: 600px; margin: 0 auto; border: 1px solid #EAE3D9; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #0F172A; padding: 20px; text-align: center;">
              <h2 style="color: #C89B3C; margin: 0; font-size: 24px;">Biscoitê</h2>
            </div>
            <div style="padding: 30px; background-color: #FDFBF7;">
              <p style="font-size: 16px;">Olá, <strong>${nome}</strong>.</p>
              <p style="font-size: 16px;">Uma nova senha provisória foi gerada para o seu acesso corporativo.</p>
              
              <div style="background-color: #FFFFFF; padding: 20px; border: 1px dashed #C89B3C; text-align: center; margin: 30px 0; border-radius: 6px;">
                <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${senha}</span>
              </div>
              
              <p style="font-size: 14px;">Recomendamos que anote esta senha. Caso não tenha solicitado esta alteração, contate a TI.</p>
            </div>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      // Escreve o erro exato do Resend no log da Vercel
      console.error("ERRO DO RESEND:", errorData); 
      throw new Error(errorData.message || 'Falha ao disparar Resend');
    }

    return res.status(200).json({ success: true, message: 'E-mail disparado com sucesso.' });
  } catch (error) {
    console.error("ERRO GERAL NA ROTA:", error.message);
    return res.status(500).json({ error: 'Erro no servidor: ' + error.message });
  }
}