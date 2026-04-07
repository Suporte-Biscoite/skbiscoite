import { useState } from 'react';

function App() {
  const [dadosGaps, setDadosGaps] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // Função que recebe a lista crua de códigos e encontra os "buracos"
  const processarCodigos = (codigosBrutos) => {
    const grupos = {};

    // 1. Agrupar códigos pelos 4 primeiros dígitos (prefixo)
    codigosBrutos.forEach(codigo => {
      if (codigo.length === 7) {
        const prefixo = codigo.substring(0, 4);
        const sufixo = parseInt(codigo.substring(4, 7), 10);

        if (!grupos[prefixo]) {
          grupos[prefixo] = [];
        }
        grupos[prefixo].push(sufixo);
      }
    });

    const resultadoFinal = [];

    // 2. Encontrar os números faltando em cada grupo
    for (const prefixo in grupos) {
      // Ordena os finais do menor para o maior
      const sufixos = grupos[prefixo].sort((a, b) => a - b);
      const gaps = [];

      if (sufixos.length > 0) {
        const minimo = sufixos[0];
        const maximo = sufixos[sufixos.length - 1];

        // Varre do menor até o maior número procurando quem não está na lista
        for (let i = minimo + 1; i < maximo; i++) {
          if (!sufixos.includes(i)) {
            // Se achou um gap, formata com zeros à esquerda (ex: de 5 vira 005)
            const gapFormatado = String(i).padStart(3, '0');
            gaps.push(`${prefixo}${gapFormatado}`);
          }
        }
      }

      resultadoFinal.push({
        prefixo,
        totalEmUso: sufixos.length,
        gapsDisponiveis: gaps
      });
    }

    // Ordena a tela para o menor prefixo aparecer primeiro
    resultadoFinal.sort((a, b) => a.prefixo.localeCompare(b.prefixo));
    setDadosGaps(resultadoFinal);
  };

  const buscarDoOmie = async () => {
    setCarregando(true);
    setErro(null);
    try {
      // Bate no back-end da Vercel
      const resposta = await fetch('/api/codigos'); 
      
      if (!resposta.ok) {
        throw new Error(`Erro na resposta da API: ${resposta.status}`);
      }
      
      const codigos = await resposta.json();
      processarCodigos(codigos); 
    } catch (error) {
      console.error(error);
      setErro("Erro ao conectar com a API. Verifique se esperou 1 minuto desde a última busca.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Validador de SKUs</h1>
      <p>Clique no botão abaixo para buscar os códigos em uso no Omie e identificar numerações livres.</p>

      {/* Botão que controla a requisição */}
      <button 
        onClick={buscarDoOmie} 
        disabled={carregando}
        style={{
          padding: '12px 24px',
          backgroundColor: carregando ? '#ccc' : '#0070f3',
          color: carregando ? '#666' : 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: carregando ? 'not-allowed' : 'pointer',
          fontSize: '16px',
          fontWeight: 'bold'
        }}
      >
        {carregando ? 'Sincronizando com Omie...' : 'Sincronizar Códigos'}
      </button>

      {erro && (
        <div style={{ color: 'red', marginTop: '20px', padding: '10px', backgroundColor: '#ffe6e6', borderRadius: '5px' }}>
          <strong>Aviso:</strong> {erro}
        </div>
      )}

      {/* Tabela de Resultados */}
      {!carregando && dadosGaps.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <h2>Números Disponíveis (Gaps):</h2>
          {dadosGaps.map((grupo) => (
            <div key={grupo.prefixo} style={{ marginBottom: '20px', padding: '15px', border: '1px solid #eaeaea', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 10px 0' }}>
                Prefixo: {grupo.prefixo} <span style={{ fontSize: '14px', color: '#666', fontWeight: 'normal' }}>({grupo.totalEmUso} em uso)</span>
              </h3>
              
              {grupo.gapsDisponiveis.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {grupo.gapsDisponiveis.map(gap => (
                    <span key={gap} style={{ backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', padding: '4px 8px', borderRadius: '4px', fontSize: '14px' }}>
                      {gap}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>Nenhum gap disponível nesta sequência.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;