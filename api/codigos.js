import axios from 'axios';

export default async function handler(req, res) {
  // A Vercel apenas aceita requisições GET para esta rota
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Agora as chaves vêm das Variáveis de Ambiente de forma segura
  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  // Proteção extra: se as chaves não estiverem configuradas, a API avisa
  if (!APP_KEY || !APP_SECRET) {
    return res.status(500).json({ error: 'Credenciais da API não estão configuradas nas variáveis de ambiente.' });
  }

  try {
    let pagina = 1;
    let totalPaginas = 1;
    let todosCodigos = [];

    // Busca todas as páginas do Omie
    while (pagina <= totalPaginas) {
      const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
        call: "ListarProdutos",
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        param: [{
          pagina: pagina,
          registros_por_pagina: 500,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N"
        }]
      });

      const data = response.data;
      totalPaginas = data.total_de_paginas;
      
      if (data.produto_servico_cadastro) {
         data.produto_servico_cadastro.forEach(prod => {
            const cod = String(prod.codigo_produto).trim();
            if (cod.length === 7 && /^\d+$/.test(cod)) {
               todosCodigos.push(cod);
            }
         });
      }
      pagina++;
    }

    const codigosUnicos = [...new Set(todosCodigos)];
    
    // LINHA NOVA: Ordem expressa para não fazer cache
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    
    // Retorna os dados com sucesso (Status 200)
    res.status(200).json(codigosUnicos);

  } catch (error) {
    console.error("Erro na API Omie:", error);
    res.status(500).json({ error: "Erro ao procurar dados do Omie" });
  }
}