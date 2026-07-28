// api/enviar-email.js

export default async function handler(req, res) {
  // Garantir que a requisição seja apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  const { email, nome, senha } = req.body;

  if (!email || !nome || !senha) {
    return res.status(400).json({ error: 'E-mail, nome e senha são obrigatórios.' });
  }

  try {
    // Chave de acesso que configuraremos na Vercel
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // Disparo para a API do Resend sem precisar de bibliotecas pesadas
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Biscoitê Sistema <onboarding@resend.dev>', // E-mail padrão de teste do Resend
        to: [email],
        subject: 'Redefinição de Acesso - Gestão de SKUs',
        html: `
          <div style="font-family: Arial, sans-serif; color: #2B1E16; max-width: 600px; margin: 0 auto; border: 1px solid #EAE3D9; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #0F172A; padding: 20px; text-align: center;">
              <h2 style="color: #C89B3C; margin: 0; font-size: 24px;">Biscoitê</h2>
            </div>
            <div style="padding: 30px; background-color: #FDFBF7;">
              <p style="font-size: 16px;">Olá, <strong>${nome}</strong>.</p>
              <p style="font-size: 16px;">Uma nova senha provisória foi gerada para o seu acesso corporativo no sistema de SKUs e Pessoas.</p>
              
              <div style="background-color: #FFFFFF; padding: 20px; border: 1px dashed #C89B3C; text-align: center; margin: 30px 0; border-radius: 6px;">
                <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${senha}</span>
              </div>
              
              <p style="font-size: 14px;">Recomendamos que você anote esta senha em um local seguro. Caso não tenha solicitado esta alteração, contate a TI.</p>
              <hr style="border: none; border-top: 1px solid #EAE3D9; margin: 30px 0;" />
              <p style="font-size: 12px; color: #6D5C53; text-align: center;">Este é um e-mail automático, por favor, não responda.</p>
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