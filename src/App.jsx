import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Conexão com o Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);
  const [erroLogin, setErroLogin] = useState(null);

  // Estado do formulário
  const [form, setForm] = useState({ categoria: '', descricao: '' });
  const [processando, setProcessando] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);

  const processarLogin = async (session) => {
    try {
      if (!session?.user?.email) {
        setUsuarioLogado(null);
        return;
      }
      const email = session.user.email;
      
      // Trava de segurança corporativa
      if (!email.endsWith('@biscoite.com.br')) {
        await supabase.auth.signOut();
        setUsuarioLogado(null);
        setErroLogin("Acesso restrito à equipa técnica da Biscoitê.");
        return;
      }
      
      setUsuarioLogado(email);
      setErroLogin(null);
    } catch (err) {
      setErroLogin("Erro ao verificar as credenciais.");
    } finally {
      setCarregandoAuth(false);
    }
  };

  useEffect(() => {
    const checagemInicial = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      await processarLogin(session);
    };
    checagemInicial();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => processarLogin(session));
    return () => subscription.unsubscribe();
  }, []);

  const fazerLoginGoogle = async () => {
    setCarregandoAuth(true);
    setErroLogin(null);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  const fazerLogout = async () => {
    setCarregandoAuth(true);
    await supabase.auth.signOut();
  };

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const gerarECadastrar = async (e) => {
    e.preventDefault();
    setProcessando(true);
    setSkuGerado(null);

    // TODO: Aqui entrará a lógica de comunicação com a nossa API (/api/codigos e /api/cadastrar)
    
    // Simulação temporária
    setTimeout(() => {
      setSkuGerado(`${form.categoria}0999`); 
      setProcessando(false);
    }, 1500);
  };

  // ================= TELAS =================
  if (carregandoAuth) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#F8F6F0' }}>A carregar...</div>;
  }

  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F6F0' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', textAlign: 'center', border: '1px solid #E5E0D8', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <h2 style={{ color: '#0F2041', marginBottom: '20px' }}>Gerador de Códigos - TI</h2>
          {erroLogin && <p style={{ color: 'red', marginBottom: '15px', fontWeight: 'bold' }}>{erroLogin}</p>}
          <button onClick={fazerLoginGoogle} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '8px', fontWeight: 'bold' }}>
            Acesso Corporativo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#F8F6F0', minHeight: '100vh', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #E5E0D8' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #F0ECE4', paddingBottom: '15px' }}>
          <h2 style={{ margin: 0, color: '#0F2041' }}>Geração de SKU</h2>
          <button onClick={fazerLogout} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 'bold' }}>Sair</button>
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