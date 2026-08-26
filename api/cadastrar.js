import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) return res.status(500).json({ error: 'Credenciais ausentes na Vercel.' });

  const { codigo, descricao, preco, ncm, acao, familia } = req.body;
  const omieCall = acao || "IncluirProduto";

  try {
    const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: omieCall,
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param: [{
        codigo_produto_integracao: codigo, 
        codigo: codigo,
        descricao: descricao,
        unidade: "UN", // Forçando a Unidade padrão exigida
        descricao_familia: familia || "", // O segredo está aqui: enviamos o NOME da família
        valor_unitario: parseFloat(preco) || 0,
        ncm: ncm || ""
      }]
    });

    res.status(200).json({ sucesso: true, omie_id: response.data.codigo_produto });

  } catch (error) {
    const msgErroOmie = error.response?.data?.faultstring || "O Omie recusou a operação.";
    console.error("Erro no Omie:", msgErroOmie);
    res.status(500).json({ error: msgErroOmie });
  }
}