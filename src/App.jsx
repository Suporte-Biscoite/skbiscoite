import { useState } from 'react';

function App() {
  const [dadosGaps, setDadosGaps] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const processarCodigos = (codigosBrutos) => {
    const grupos = {};

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

    for (const prefixo in grupos) {
      const sufixos = grupos[prefixo].sort((a, b) => a - b);
      const gaps = [];

      if (sufixos.length > 0) {
        const minimo = sufixos[0];
        const maximo = sufixos[sufixos.length - 1];

        for (let i = minimo + 1; i < maximo; i++) {
          if (!sufixos.includes(i)) {
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

    resultadoFinal.sort((a, b) => a.prefixo.localeCompare(b.prefixo));
    setDadosGaps(resultadoFinal);
  };

  const buscarDoOmie = async () => {
    setCarregando(true);
    setErro(null);
    try {
      // O "?t=" cria uma URL única toda vez, forçando a Vercel a ignorar o cache
      const resposta = await fetch(`/api/codigos?t=${new Date().getTime()}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }); 
      
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
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      
      {/* Container Principal */}
      <div style={{ maxWidth: '900px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', padding: '40px' }}>
        
        {/* Cabeçalho */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #f0f0f0', paddingBottom: '24px', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Validador de SKUs - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Encontre rapidamente as numerações livres no Omie para cadastrar novos produtos.</p>
        </div>

        {/* Área do Botão */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <button 
            onClick={buscarDoOmie} 
            disabled={carregando}
            style={{
              padding: '14px 32px',
              backgroundColor: carregando ? '#bdc3c7' : '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: carregando ? 'wait' : 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              transition: 'background-color 0.2s',
              boxShadow: carregando ? 'none' : '0 4px 12px rgba(0, 112, 243, 0.3)'
            }}
          >
            {carregando ? '⏳ Sincronizando com Omie...' : '🔄 Sincronizar Códigos'}
          </button>
        </div>

        {/* Mensagem de Erro */}
        {erro && (
          <div style={{ backgroundColor: '#fee2e2', borderLeft: '4px solid #ef4444', color: '#b91c1c', padding: '16px', borderRadius: '4px', marginBottom: '24px' }}>
            <strong>Aviso:</strong> {erro}
          </div>
        )}

        {/* Resultados */}
        {!carregando && dadosGaps.length > 0 && (
          <div>
            <h2 style={{ color: '#34495e', fontSize: '20px', marginBottom: '20px' }}>Resultados da Análise:</h2>
            
            <div style={{ display: 'grid', gap: '20px' }}>
              {dadosGaps.map((grupo) => (
                <div key={grupo.prefixo} style={{ padding: '20px', border: '1px solid #e2e8f0', borderRadius: '10px', backgroundColor: '#f8fafc' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px' }}>
                      Prefixo: <span style={{ color: '#0070f3' }}>{grupo.prefixo}</span>
                    </h3>
                    <span style={{ fontSize: '14px', color: '#64748b', backgroundColor: '#e2e8f0', padding: '4px 10px', borderRadius: '20px' }}>
                      {grupo.totalEmUso} em uso
                    </span>
                  </div>
                  
                  {grupo.gapsDisponiveis.length > 0 ? (
                    <div>
                      <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#475569', fontWeight: '500' }}>SKUs Livres:</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {grupo.gapsDisponiveis.map(gap => (
                          <span key={gap} style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', padding: '6px 12px', borderRadius: '6px', fontSize: '15px', fontWeight: '600', letterSpacing: '0.5px' }}>
                            {gap}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: '#94a3b8', margin: 0, fontSize: '14px', fontStyle: 'italic' }}>Nenhum intervalo livre encontrado nesta sequência.</p>
                  )}

                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;