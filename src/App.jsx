import { useState } from 'react';

function App() {
  const [prefixo, setPrefixo] = useState('');
  const [proximoCodigo, setProximoCodigo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);

  const descobrirProximoCodigo = (todosCodigos, prefixoDesejado) => {
    // Filtra apenas os códigos que começam com o prefixo escolhido
    const codigosDaFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    
    // Extrai só o final numérico
    const sufixos = codigosDaFamilia
      .map(c => c.substring(prefixoDesejado.length))
      .filter(s => /^\d+$/.test(s)) // Garante que o final é só número
      .map(s => parseInt(s, 10))
      .sort((a, b) => a - b);

    let proximoNumeroLivre = 1; // Começa testando o 001
    
    for (let i = 0; i < sufixos.length; i++) {
      if (sufixos[i] === proximoNumeroLivre) {
        proximoNumeroLivre++; // Esse já existe, vamos testar o próximo
      } else if (sufixos[i] > proximoNumeroLivre) {
        break; // Achamos um buraco (gap)
      }
    }

    // Formata o final com zeros à esquerda
    const tamanhoIdealSufixo = Math.max(3, 7 - prefixoDesejado.length);
    const numeroFormatado = String(proximoNumeroLivre).padStart(tamanhoIdealSufixo, '0');
    
    setProximoCodigo(`${prefixoDesejado}${numeroFormatado}`);
  };

  const buscarDoOmie = async () => {
    if (!prefixo) {
      setErro("Por favor, selecione uma categoria primeiro.");
      return;
    }

    setCarregando(true);
    setErro(null);
    setProximoCodigo(null);
    let todosCodigosAcomulados = [];

    try {
      // 1. Busca apenas a PRIMEIRA página para descobrir o total de páginas que existem
      setStatusTexto("Iniciando varredura rápida...");
      const res1 = await fetch(`/api/codigos?pagina=1&t=${new Date().getTime()}`);
      if (!res1.ok) throw new Error("Erro na comunicação com a API");
      
      const data1 = await res1.json();
      todosCodigosAcomulados = [...data1.codigos];
      const totalPaginas = data1.total_paginas;

      // 2. Se tiver mais páginas, baixa o resto em LOTES PARALELOS (Muito mais rápido!)
      if (totalPaginas > 1) {
        setStatusTexto(`Baixando dados em paralelo (1/${totalPaginas})...`);
        
        // Cria uma lista com as páginas que faltam (ex: [2, 3, 4, 5])
        const paginasPendentes = [];
        for (let p = 2; p <= totalPaginas; p++) paginasPendentes.push(p);

        // O Omie permite até 4 conexões simultâneas. Usamos 3 por segurança contra bloqueios.
        const tamanhoLote = 3; 
        
        for (let i = 0; i < paginasPendentes.length; i += tamanhoLote) {
          // Pega 3 páginas da fila
          const lote = paginasPendentes.slice(i, i + tamanhoLote);
          
          // Dispara as 3 requisições para a Vercel EXATAMENTE AO MESMO TEMPO
          const promessas = lote.map(p => 
            fetch(`/api/codigos?pagina=${p}&t=${new Date().getTime()}`).then(res => res.json())
          );
          
          // O Promise.all espera as 3 terminarem juntas
          const resultadosLote = await Promise.all(promessas);
          
          // Junta os códigos novos com os que já tínhamos
          resultadosLote.forEach(res => {
            todosCodigosAcomulados = [...todosCodigosAcomulados, ...res.codigos];
          });
          
          // Atualiza o texto na tela para o usuário não achar que travou
          const progresso = Math.min(i + tamanhoLote + 1, totalPaginas);
          setStatusTexto(`Baixando dados em paralelo (${progresso}/${totalPaginas})...`);
        }
      }

      setStatusTexto("Calculando o próximo número livre...");
      descobrirProximoCodigo(todosCodigosAcomulados, prefixo);

    } catch (error) {
      console.error(error);
      setErro("Falha na busca. O servidor pode estar ocupado. Tente novamente.");
    } finally {
      setCarregando(false);
      setStatusTexto('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: '"Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Gerador de SKUs - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Selecione a categoria do produto para obter o próximo código livre na sequência.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <label style={{ fontWeight: '600', color: '#34495e' }}>Categoria do Produto:</label>
          
          {/* Nova lista de seleção (Dropdown) */}
          <select 
            value={prefixo} 
            onChange={(e) => setPrefixo(e.target.value)}
            disabled={carregando}
            style={{ 
              padding: '12px', 
              fontSize: '18px', 
              borderRadius: '8px', 
              border: '1px solid #cbd5e1',
              backgroundColor: '#fff',
              cursor: carregando ? 'not-allowed' : 'pointer'
            }}
          >
            <option value="">Selecione uma categoria...</option>
            <option value="300">EXTERNO</option>
            <option value="400">INTERNO</option>
            <option value="500">CESTAS</option>
            <option value="700">ENTRADA DE NOTAS</option>
          </select>
          
          <button 
            onClick={buscarDoOmie} 
            disabled={carregando}
            style={{
              padding: '16px', 
              backgroundColor: carregando ? '#bdc3c7' : '#0070f3',
              color: 'white', 
              border: 'none', 
              borderRadius: '8px', 
              cursor: carregando ? 'wait' : 'pointer',
              fontSize: '18px', 
              fontWeight: 'bold',
              transition: 'background-color 0.2s'
            }}
          >
            {carregando ? '⏳ Sincronizando...' : 'Gerar Próximo Código'}
          </button>
        </div>

        {carregando && (
          <p style={{ textAlign: 'center', color: '#e67e22', fontWeight: 'bold' }}>{statusTexto}</p>
        )}

        {erro && (
          <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '4px' }}>
            <strong>Aviso:</strong> {erro}
          </div>
        )}

        {proximoCodigo && (
          <div style={{ marginTop: '24px', padding: '24px', backgroundColor: '#f0fdf4', border: '2px solid #22c55e', borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 8px 0', color: '#166534', fontSize: '16px' }}>O código perfeito para você usar agora é:</p>
            <h2 style={{ margin: 0, color: '#15803d', fontSize: '36px', letterSpacing: '2px' }}>{proximoCodigo}</h2>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;