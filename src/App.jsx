import { useState } from 'react';

function App() {
  const [aba, setAba] = useState('individual'); // 'individual' ou 'massa'
  const [formData, setFormData] = useState({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });
  const [csvFile, setCsvFile] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [logs, setLogs] = useState([]);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  // Busca uma lista de N códigos disponíveis de uma vez só
  const buscarGapsEmLote = async (prefixoDesejado, quantidadeNecessaria) => {
    setStatusTexto("Varrendo catálogo para reservar SKUs...");
    let todosCodigos = [];
    let pagina = 1;
    let total = 1;

    // Busca a primeira página
    const res1 = await fetch(`/api/codigos?pagina=1&t=${new Date().getTime()}`);
    const data1 = await res1.json();
    todosCodigos = [...data1.codigos];
    total = data1.total_paginas;

    // Busca o resto em paralelo
    if (total > 1) {
      const paginas = [];
      for (let p = 2; p <= total; p++) paginas.push(p);
      const lotes = [];
      for (let i = 0; i < paginas.length; i += 3) {
        const promessas = paginas.slice(i, i + 3).map(p => fetch(`/api/codigos?pagina=${p}`).then(r => r.json()));
        const res = await Promise.all(promessas);
        res.forEach(d => todosCodigos.push(...d.codigos));
      }
    }

    // Lógica de achar múltiplos gaps
    const codsFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    const sufixos = codsFamilia.map(c => parseInt(c.substring(prefixoDesejado.length), 10)).sort((a, b) => a - b);
    
    const gapsEncontrados = [];
    let tentativa = 1;
    while (gapsEncontrados.length < quantidadeNecessaria) {
      if (!sufixos.includes(tentativa)) {
        const formatado = String(tentativa).padStart(Math.max(3, 7 - prefixoDesejado.length), '0');
        gapsEncontrados.push(`${prefixoDesejado}${formatado}`);
      }
      tentativa++;
    }
    return gapsEncontrados;
  };

  const processarCadastroMassa = async () => {
    if (!csvFile || !formData.prefixo) return alert("Selecione o arquivo e a categoria!");
    setCarregando(true);
    setLogs([]);

    const leitor = new FileReader();
    leitor.onload = async (e) => {
      const texto = e.target.result;
      const linhas = texto.split('\n').slice(1).filter(l => l.trim() !== ''); // Ignora cabeçalho
      
      try {
        const skusReservados = await buscarGapsEmLote(formData.prefixo, linhas.length);
        
        for (let i = 0; i < linhas.length; i++) {
          const [descricao, unidade, preco, ncm] = linhas[i].split(',');
          setStatusTexto(`Cadastrando ${i + 1} de ${linhas.length}: ${descricao}...`);
          
          const res = await fetch('/api/cadastrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              codigo: skusReservados[i], 
              descricao: descricao.trim(), 
              unidade: unidade.trim() || 'UN', 
              preco: preco.trim(), 
              ncm: ncm.trim() 
            })
          });

          const data = await res.json();
          setLogs(prev => [...prev, { sku: skusReservados[i], status: res.ok ? '✅ Sucesso' : '❌ Erro' }]);
        }
      } catch (err) { alert("Erro no processamento."); }
      setCarregando(false);
      setStatusTexto("Processo concluído!");
    };
    leitor.readAsText(csvFile);
  };

  // Reutiliza o buscarDoOmie que você já tem para o cadastro Individual...
  // (Código anterior de cadastrarProduto aqui...)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', backgroundColor: '#fff', borderRadius: '12px', padding: '30px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
          <button onClick={() => setAba('individual')} style={{ flex: 1, padding: '10px', cursor: 'pointer', backgroundColor: aba === 'individual' ? '#0070f3' : '#eee', color: aba === 'individual' ? '#fff' : '#333', border: 'none', borderRadius: '5px' }}>Individual</button>
          <button onClick={() => setAba('massa')} style={{ flex: 1, padding: '10px', cursor: 'pointer', backgroundColor: aba === 'massa' ? '#0070f3' : '#eee', color: aba === 'massa' ? '#fff' : '#333', border: 'none', borderRadius: '5px' }}>Em Massa (CSV)</button>
        </div>

        {aba === 'individual' ? (
          /* Seu formulário individual aqui (conforme o código anterior) */
          <div>Formulário Individual (Copie o código do post anterior aqui)</div>
        ) : (
          <div>
            <h3>Upload de Planilha (CSV)</h3>
            <p style={{ fontSize: '14px', color: '#666' }}>O arquivo deve conter: Descrição, Unidade, Preço, NCM</p>
            <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} style={{ marginBottom: '20px' }} />
            
            <select name="prefixo" value={formData.prefixo} onChange={handleChange} style={{ width: '100%', padding: '10px', marginBottom: '20px' }}>
              <option value="">Selecione a Família para TODOS...</option>
              <option value="300">EXTERNO</option>
              <option value="400">INTERNO</option>
              <option value="500">CESTAS</option>
              <option value="700">ENTRADA DE NOTAS</option>
            </select>

            <button onClick={processarCadastroMassa} disabled={carregando} style={{ width: '100%', padding: '15px', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>
              {carregando ? statusTexto : 'Iniciar Cadastro em Lote'}
            </button>

            <div style={{ marginTop: '20px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #eee', padding: '10px' }}>
              {logs.map((log, i) => (
                <div key={i} style={{ fontSize: '13px', padding: '5px 0', borderBottom: '1px solid #f9f9f9' }}>
                  {log.status} - SKU: {log.sku}
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