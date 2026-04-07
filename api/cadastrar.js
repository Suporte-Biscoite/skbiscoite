import axios from 'axios';

export default async function handler(req, res) {
  // Garante que só aceitamos método POST (envio de dados)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) return res.status(500).json({ error: 'Credenciais ausentes na Vercel.' });

  // Pega os dados que o Front-end mandou
  const { codigo, descricao, unidade, preco } = req.body;

  try {
    const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: "IncluirProduto",
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param: [{
        codigo_produto_integracao: codigo, // O Omie exige um ID de integração, usamos o próprio SKU
        codigo: codigo,
        descricao: descricao,
        unidade: unidade,
        valor_unitario: parseFloat(preco) || 0 // Garante que o preço vá como número
      }]
    });

    // Se deu certo, devolve sucesso pro Front-end
    res.status(200).json({ sucesso: true, omie_id: response.data.codigo_produto });

  } catch (error) {
    console.error("Erro ao incluir no Omie:", error.response?.data || error.message);
    res.status(500).json({ error: "O Omie recusou o cadastro. Verifique os dados." });
  }
}