import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) return res.status(500).json({ error: 'Credenciais ausentes na Vercel.' });

  // Pegando a variável NCM nova
  const { codigo, descricao, unidade, preco, ncm } = req.body;

  try {
    const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: "IncluirProduto",
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param: [{
        codigo_produto_integracao: codigo, 
        codigo: codigo,
        descricao: descricao,
        unidade: unidade,
        valor_unitario: parseFloat(preco) || 0,
        ncm: ncm // <-- Enviando pro Omie
      }]
    });

    res.status(200).json({ sucesso: true, omie_id: response.data.codigo_produto });

  } catch (error) {
    // Melhoria para mostrar no front-end o erro exato que o Omie deu (como o do NCM)
    const msgErroOmie = error.response?.data?.faultstring || "O Omie recusou o cadastro.";
    console.error("Erro ao incluir no Omie:", msgErroOmie);
    res.status(500).json({ error: msgErroOmie });
  }
}