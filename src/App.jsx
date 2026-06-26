import { useState } from 'react';

function App() {
  // Estado do formulário
  const [form, setForm] = useState({ categoria: '', descricao: '' });
  const [processando, setProcessando] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const gerarECadastrar = async (e) => {
    e.preventDefault();
    setProcessando(true);
    setSkuGerado(null);

    // TODO: Aqui entrará a lógica de comunicação com a nossa API (/api/codigos e /api/cadastrar)
    
    // Simulação temporária para ver a interface a funcionar
    setTimeout(() => {
      setSkuGerado(`${form.categoria}0999`); 
      setProcessando(false);
    }, 1500);
  };

  return (
    <div style={{ backgroundColor: '#F8F6F0', minHeight: '100vh', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #E5E0D8' }}>
        
        <div style={{ marginBottom: '30px', borderBottom: '2px solid #F0ECE4', paddingBottom: '15px' }}>
          <h2 style={{ margin: 0, color: '#0F2041' }}>Gerador de SKU - TI</h2>
        </div>

        <form onSubmit={gerarECadastrar} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ fontWeight: 'bold', color: '#333' }}>Prefixo (Categoria)</label>
            <select name="categoria" value={form.categoria} onChange={handleChange} required style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '8px', border: '1px solid #ccc' }}>
              <option value="">Selecione a raiz do código...</option>
              <option value="300">300 - EXTERNO</option>
              <option value="400">400 - INTERNO</option>
              <option value="500">500 - CESTAS</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontWeight: 'bold', color: '#333' }}>Descrição Provisória / Final</label>
            <input type="text" name="descricao" value={form.descricao} onChange={handleChange} required placeholder="Ex: CÓDIGO EM STAND-BY" style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
          </div>
          
          <button type="submit" disabled={processando} style={{ backgroundColor: '#F2A900', color: '#0F2041', padding: '16px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', marginTop: '10px' }}>
            {processando ? 'A varrer o Omie...' : 'Descobrir Próximo SKU e Registar'}
          </button>
        </form>

        {skuGerado && (
          <div style={{ marginTop: '25px', padding: '20px', backgroundColor: '#0F2041', color: '#fff', borderRadius: '12px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 10px 0', color: '#F2A900' }}>Sucesso! Novo produto registado:</p>
            <h1 style={{ margin: 0, fontSize: '32px' }}>{skuGerado}</h1>
          </div>
        )}
        
      </div>
    </div>
  );
}

export default App;