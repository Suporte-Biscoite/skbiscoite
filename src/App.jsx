import { useState } from 'react';

function App() {
  const [prefixo, setPrefixo] = useState('');
  const [proximoCodigo, setProximoCodigo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);

  const descobrirProximoCodigo = (todosCodigos, prefixoDesejado) => {
    // Filtra apenas os códigos que começam com o que o usuário digitou
    const codigosDaFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    
    // Extrai só o final numérico (ex: se digitou 400 e achou 400015, tira o 15)
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
        break; // Opa, achamos um buraco (gap)!
      }
    }

    // Formata com zeros (se o código padrão da Biscoitê é de 7 digitos, ele preenche com os zeros necessários)
    const tamanhoIdealSufixo = Math.max(3, 7 - prefixoDesejado.length);
    const numeroFormatado = String(proximoNumeroLivre).padStart(tamanhoIdealSufixo, '0');
    
    setProximoCodigo(`${prefixoDesejado}${numeroFormatado}`);
  };

  const buscarDoOmie = async () => {
    if (!prefixo.trim()) {
      setErro("Por favor, digite um prefixo primeiro.");
      return;
    }

    setCarregando(true);
    setErro(null);
    setProximoCodigo(null);
    let paginaAtual = 1;
    let totalPaginas = 1;
    let todosCodigosAcomulados = [];

    try {
      // Loop no Front-end: Pede uma página por vez pra Vercel não travar!
      while (paginaAtual <= totalPaginas) {
        setStatusTexto(`Lendo página ${paginaAtual} de ${totalPaginas === 1 ? '...' : totalPaginas} no Omie...`);
        
        const resposta = await fetch(`/api/codigos?pagina=${paginaAtual}&t=${new Date().getTime()}`);
        if (!resposta.ok) throw new Error("Erro na comunicação");
        
        const data = await resposta.json();
        todosCodigosAcomulados = [...todosCodigosAcomulados, ...data.codigos];
        totalPaginas = data.total_paginas;
        paginaAtual++;
      }

      setStatusTexto("Processando códigos...");
      descobrirProximoCodigo(todosCodigosAcomulados, prefixo.trim());

    } catch (error) {
      console.error(error);
      setErro("Falha na busca. Espere alguns segundos e tente novamente.");
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
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Digite a família do produto para obter o próximo código livre na sequência.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <label style={{ fontWeight: '600', color: '#34495e' }}>Prefixo Desejado (ex: 300, 400, 1234):</label>
          <input 
            type="text" 
            value={prefixo} 
            onChange={(e) => setPrefixo(e.target.value)}
            placeholder="Digite os números iniciais..."
            disabled={carregando}
            style={{ padding: '12px', fontSize: '18px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
          />
          
          <button 
            onClick={buscarDoOmie} 
            disabled={carregando}
            style={{
              padding: '16px', backgroundColor: carregando ? '#bdc3c7' : '#0070f3',
              color: 'white', border: 'none', borderRadius: '8px', cursor: carregando ? 'wait' : 'pointer',
              fontSize: '18px', fontWeight: 'bold'
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