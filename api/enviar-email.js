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

    if (!RESEND_API_KEY) {
      console.error("ERRO CRÍTICO: RESEND_API_KEY não encontrada no servidor.");
      throw new Error("Chave de API do Resend ausente no servidor.");
    }

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
              <p style="font-size: 16px;">Uma nova senha forte e provisória foi gerada para o seu acesso corporativo.</p>
              
              <div style="background-color: #FFFFFF; padding: 20px; border: 1px dashed #C89B3C; text-align: center; margin: 30px 0; border-radius: 6px;">
                <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${senha}</span>
              </div>
              
              <p style="font-size: 14px;"><strong>Atenção:</strong> Por motivos de segurança, recomendamos que você altere esta senha no seu próximo login.</p>
              <hr style="border: none; border-top: 1px solid #EAE3D9; margin: 30px 0;" />
              <p style="font-size: 12px; color: #6D5C53; text-align: center;">Este é um e-mail automático do sistema de gestão de SKUs, não responda.</p>
            </div>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("ERRO DO RESEND:", errorData); 
      throw new Error(errorData.message || 'Falha ao disparar Resend');
    }

    return res.status(200).json({ success: true, message: 'E-mail disparado com sucesso.' });
  } catch (error) {
    console.error("ERRO GERAL NA ROTA:", error.message);
    return res.status(500).json({ error: 'Erro no servidor: ' + error.message });
  }
}