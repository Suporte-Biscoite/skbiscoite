import { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

// Conexão com o Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ================= ESTADOS DO SISTEMA =================
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [perfilUsuario, setPerfilUsuario] = useState(null);
  const [erroLogin, setErroLogin] = useState(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);

  // Painel Master (TI)
  const [listaUsuarios, setListaUsuarios] = useState([]);

  // Estados do Sistema Kanban
  const [aba, setAba] = useState('produtos'); 
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  // NOVO: Estado do Formulário do Time de Produtos
  const [formProdutos, setFormProdutos] = useState({
    nomeInterno: '',
    nomePdv: '',
    categoria: '', // 300, 400, etc.
    tipoProduto: 'Fábrica', // Loja ou Fábrica
    pesoLiquido: '',
    pesoBruto: '',
    altura: '',
    largura: '',
    profundidade: '',
    shelfLife: '',
    origem: 'Nacional'
  });

  // ================= LÓGICA DE LOGIN (BLINDADA) =================
  const processarLogin = async (session) => {
    try {
      if (!session?.user?.email) {
        setUsuarioLogado(null); setPerfilUsuario(null); return; 
      }
      const email = session.user.email;
      if (!email.endsWith('@biscoite.com.br')) {
        await supabase.auth.signOut();
        setUsuarioLogado(null); setPerfilUsuario(null);
        setErroLogin("Acesso restrito! Use o e-mail corporativo da Biscoitê."); return;
      }
      setUsuarioLogado(email); setErroLogin(null);

      let { data: perfilData, error: erroBusca } = await supabase.from('perfis').select('*').eq('email', email).maybeSingle();
      if (erroBusca) throw erroBusca;

      if (!perfilData) {
        const { data: novoPerfil, error: erroInsert } = await supabase.from('perfis').insert([{ email: email, setor: 'PRODUTOS', status: 'pendente' }]).select().single();
        if (erroInsert) throw erroInsert;
        perfilData = novoPerfil;
      }

      setPerfilUsuario(perfilData);
      
      if (perfilData?.status === 'aprovado' && perfilData?.setor === 'TI') {
        carregarListaUsuarios();
      }
    } catch (err) {
      console.error("Erro no processamento:", err); setErroLogin("Falha ao carregar suas permissões. Tente novamente.");
    } finally {
      setCarregandoAuth(false);
    }
  };

  useEffect(() => {
    const checagemInicial = async () => {
      try { const { data: { session } } = await supabase.auth.getSession(); await processarLogin(session); } 
      catch (e) { setCarregandoAuth(false); }
    };
    checagemInicial();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { processarLogin(session); });
    return () => subscription.unsubscribe();
  }, []);

  const fazerLoginGoogle = async () => {
    setErroLogin(null); setCarregandoAuth(true);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };
  const fazerLogout = async () => { setCarregandoAuth(true); await supabase.auth.signOut(); };

  // ================= PAINEL MASTER (TI) =================
  const carregarListaUsuarios = async () => {
    const { data } = await supabase.from('perfis').select('*').order('criado_em', { ascending: false });
    setListaUsuarios(data || []);
  };

  const atualizarPermissaoUsuario = async (id, novoStatus, novoSetor) => {
    await supabase.from('perfis').update({ status: novoStatus, setor: novoSetor }).eq('id', id);
    carregarListaUsuarios(); alert("Permissões atualizadas com sucesso!");
  };

  // ================= FUNÇÕES DO KANBAN (TIME DE PRODUTOS) =================
  const handleFormProdutosChange = (e) => {
    setFormProdutos({ ...formProdutos, [e.target.name]: e.target.value });
  };

  const enviarSolicitacaoProduto = async (e) => {
    e.preventDefault();
    setCarregando(true); setErro(null); setSucesso(null);

    try {
      // Cria a "Casca" do produto no nosso banco de dados (Ainda não vai pro Omie)
      const { error } = await supabase.from('produtos_fluxo').insert([{
        descricao: formProdutos.nomePdv, // O nome final vai pro Omie
        prefixo_categoria: formProdutos.categoria,
        peso_bruto: formProdutos.pesoBruto,
        peso_liquido: formProdutos.pesoLiquido,
        status_atual: '1_solicitado_produtos', // Status Inicial
        criado_por: usuarioLogado
      }]);

      if (error) throw error;

      setSucesso(`Solicitação do produto "${formProdutos.nomePdv}" enviada para a TI com sucesso!`);
      
      // Limpa o formulário
      setFormProdutos({ nomeInterno: '', nomePdv: '', categoria: '', tipoProduto: 'Fábrica', pesoLiquido: '', pesoBruto: '', altura: '', largura: '', profundidade: '', shelfLife: '', origem: 'Nacional' });
    } catch (err) {
      console.error(err);
      setErro("Erro ao salvar solicitação. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  };


  // ================= TELAS =================
  if (carregandoAuth) return (<div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><div style={{ textAlign: 'center', color: '#64748b' }}><div style={{ fontSize: '40px', marginBottom: '15px' }}>⏳</div><h2>Carregando sistema Biscoitê...</h2></div></div>);

  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h1 style={{ color: '#2c3e50', marginBottom: '10px' }}>📦 Sistema PLM - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', marginBottom: '30px' }}>Acesso exclusivo corporativo.</p>
          {erroLogin && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', fontWeight: 'bold' }}>{erroLogin}</div>}
          <button onClick={fazerLoginGoogle} style={{ width: '100%', padding: '14px', backgroundColor: '#ffffff', color: '#3f3f3f', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google Logo" style={{ width: '20px', height: '20px' }} /> Entrar com Google Biscoitê
          </button>
        </div>
      </div>
    );
  }

  if (perfilUsuario?.status === 'pendente') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '500px', textAlign: 'center' }}><div style={{ fontSize: '50px', marginBottom: '20px' }}>☕</div><h2 style={{ color: '#2c3e50', margin: '0 0 10px 0' }}>Cadastro Recebido!</h2><p style={{ color: '#64748b', fontSize: '16px', lineHeight: '1.6' }}>Olá, <strong>{usuarioLogado}</strong>. Você está na fila de aprovação.<br/><br/>Aguarde a TI liberar o seu acesso.</p><button onClick={fazerLogout} style={{ marginTop: '30px', padding: '10px 20px', backgroundColor: '#e2e8f0', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sair e tentar depois</button></div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '20px', fontFamily: '"Segoe UI", sans-serif' }}>
      
      <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', backgroundColor: '#fff', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}><span style={{ fontWeight: 'bold', color: '#334155', fontSize: '18px' }}>👤 {usuarioLogado}</span><span style={{ backgroundColor: '#e0e7ff', color: '#4338ca', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>Setor: {perfilUsuario?.setor}</span></div>
        <button onClick={fazerLogout} style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sair</button>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', borderBottom: '2px solid #f1f5f9', paddingBottom: '15px' }}>
          <button onClick={() => setAba('produtos')} style={{ flex: 1, padding: '12px', cursor: 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'produtos' ? '#0f172a' : '#f8fafc', color: aba === 'produtos' ? '#fff' : '#64748b' }}>
            📝 Nova Solicitação (Produtos)
          </button>
          
          {perfilUsuario?.setor === 'TI' && (
            <button onClick={() => setAba('admin')} style={{ flex: 1, padding: '12px', cursor: 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'admin' ? '#8b5cf6' : '#f8fafc', color: aba === 'admin' ? '#fff' : '#64748b' }}>
              🛡️ Gestão TI
            </button>
          )}
        </div>

        {erro && <div style={{ marginBottom: '24px', backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}><strong>Erro:</strong> {erro}</div>}
        {sucesso && <div style={{ marginBottom: '24px', backgroundColor: '#f0fdf4', color: '#15803d', border: '2px solid #22c55e', padding: '16px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>✅ {sucesso}</div>}

        {/* --- ABA: NOVA SOLICITAÇÃO (TIME DE PRODUTOS) --- */}
        {aba === 'produtos' && (
          <form onSubmit={enviarSolicitacaoProduto} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#334155', borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>1. Identificação do Produto</h3>
              
              <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Nome Final PDV (Vai pro Omie) *</label>
                  <input required type="text" name="nomePdv" value={formProdutos.nomePdv} onChange={handleFormProdutosChange} placeholder="Ex: BISCOITO ESTRELA 200G" disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Nome Interno</label>
                  <input type="text" name="nomeInterno" value={formProdutos.nomeInterno} onChange={handleFormProdutosChange} placeholder="Ex: Biscoito Estrela Pacote" disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '20px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Família / Categoria *</label>
                  <select required name="categoria" value={formProdutos.categoria} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}>
                    <option value="">Selecione...</option>
                    <option value="300">EXTERNO</option>
                    <option value="400">INTERNO</option>
                    <option value="500">CESTAS</option>
                    <option value="700">NOTAS</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Tipo</label>
                  <select name="tipoProduto" value={formProdutos.tipoProduto} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}>
                    <option value="Fábrica">Fábrica</option>
                    <option value="Loja">Loja</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Origem</label>
                  <select name="origem" value={formProdutos.origem} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}>
                    <option value="Nacional">Nacional</option>
                    <option value="Importado">Importado</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#334155', borderBottom: '1px solid #cbd5e1', paddingBottom: '10px' }}>2. Dimensões e Logística</h3>
              
              <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Peso Líq. (Kg)</label>
                  <input type="number" step="0.001" name="pesoLiquido" value={formProdutos.pesoLiquido} onChange={handleFormProdutosChange} placeholder="0.200" disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Peso Bruto (Kg)</label>
                  <input type="number" step="0.001" name="pesoBruto" value={formProdutos.pesoBruto} onChange={handleFormProdutosChange} placeholder="0.250" disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Shelf Life (Dias)</label>
                  <input type="number" name="shelfLife" value={formProdutos.shelfLife} onChange={handleFormProdutosChange} placeholder="90" disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Altura (cm)</label>
                  <input type="number" step="0.1" name="altura" value={formProdutos.altura} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Largura (cm)</label>
                  <input type="number" step="0.1" name="largura" value={formProdutos.largura} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#475569', marginBottom: '8px', fontSize: '14px' }}>Profund. (cm)</label>
                  <input type="number" step="0.1" name="profundidade" value={formProdutos.profundidade} onChange={handleFormProdutosChange} disabled={carregando} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </div>
              </div>
            </div>

            <button type="submit" disabled={carregando} style={{ padding: '16px', backgroundColor: carregando ? '#94a3b8' : '#0f172a', color: 'white', border: 'none', borderRadius: '8px', cursor: carregando ? 'wait' : 'pointer', fontSize: '18px', fontWeight: 'bold' }}>
              {carregando ? '⏳ Salvando e notificando TI...' : '🚀 Enviar para Geração de Código (TI)'}
            </button>
          </form>
        )}

        {/* --- PAINEL MASTER DA TI (Mantido) --- */}
        {aba === 'admin' && perfilUsuario?.setor === 'TI' && (
          <div>
            <h2 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>Gestão de Usuários</h2>
            <p style={{ color: '#64748b', marginBottom: '30px' }}>Aprove novos acessos e defina em qual setor cada usuário trabalha.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}><th style={{ padding: '15px' }}>E-mail</th><th style={{ padding: '15px' }}>Status</th><th style={{ padding: '15px' }}>Setor</th></tr>
              </thead>
              <tbody>
                {listaUsuarios.map(user => (
                  <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '15px', fontWeight: '500' }}>{user.email}</td>
                    <td style={{ padding: '15px' }}>
                      <select value={user.status} onChange={(e) => atualizarPermissaoUsuario(user.id, e.target.value, user.setor)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: user.status === 'aprovado' ? '#dcfce7' : '#fef08a', fontWeight: 'bold' }}>
                        <option value="pendente">Pendente ⏳</option><option value="aprovado">Aprovado ✅</option>
                      </select>
                    </td>
                    <td style={{ padding: '15px' }}>
                      <select value={user.setor} onChange={(e) => atualizarPermissaoUsuario(user.id, user.status, e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                        <option value="PRODUTOS">PRODUTOS (Solicitações)</option><option value="FINANCEIRO">FINANCEIRO / SUPPLY</option><option value="TI">TI (Aprovações Master)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;