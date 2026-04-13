import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Conexão com o Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ================= ESTADOS GERAIS E AUTENTICAÇÃO =================
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [perfilUsuario, setPerfilUsuario] = useState(null);
  const [erroLogin, setErroLogin] = useState(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);

  // ================= ESTADOS DO SISTEMA =================
  const [abaAtiva, setAbaAtiva] = useState('kanban'); // 'kanban' ou 'admin'
  const [listaUsuarios, setListaUsuarios] = useState([]);
  
  // Estados do Kanban
  const [cards, setCards] = useState([]);
  const [carregandoDados, setCarregandoDados] = useState(false);
  
  // Estados do Modal de Novo Produto
  const [modalAberto, setModalAberto] = useState(false);
  const [formProdutos, setFormProdutos] = useState({
    nomePdv: '', categoria: '', pesoLiquido: '', pesoBruto: ''
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
      
      if (perfilData?.status === 'aprovado') {
        carregarKanban();
        if (perfilData?.setor === 'TI') carregarListaUsuarios();
      }
    } catch (err) {
      console.error("Erro no processamento:", err); setErroLogin("Falha ao carregar suas permissões.");
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

  // ================= FUNÇÕES DO BANCO DE DADOS =================
  const carregarListaUsuarios = async () => {
    const { data } = await supabase.from('perfis').select('*').order('criado_em', { ascending: false });
    setListaUsuarios(data || []);
  };

  const atualizarPermissaoUsuario = async (id, novoStatus, novoSetor) => {
    await supabase.from('perfis').update({ status: novoStatus, setor: novoSetor }).eq('id', id);
    carregarListaUsuarios(); alert("Permissões atualizadas com sucesso!");
  };

  const carregarKanban = async () => {
    const { data } = await supabase.from('produtos_fluxo').select('*').order('criado_em', { ascending: false });
    setCards(data || []);
  };

  // ================= FUNÇÕES DO NOVO PRODUTO =================
  const handleFormChange = (e) => setFormProdutos({ ...formProdutos, [e.target.name]: e.target.value });

  const salvarNovoProduto = async (e) => {
    e.preventDefault();
    setCarregandoDados(true);
    try {
      const { error } = await supabase.from('produtos_fluxo').insert([{
        descricao: formProdutos.nomePdv,
        prefixo_categoria: formProdutos.categoria,
        peso_bruto: formProdutos.pesoBruto,
        peso_liquido: formProdutos.pesoLiquido,
        status_atual: '1_solicitado_produtos',
        criado_por: usuarioLogado
      }]);
      if (error) throw error;
      
      setModalAberto(false);
      setFormProdutos({ nomePdv: '', categoria: '', pesoLiquido: '', pesoBruto: '' });
      carregarKanban(); // Atualiza a tela na hora
    } catch (err) {
      alert("Erro ao criar produto."); console.error(err);
    } finally {
      setCarregandoDados(false);
    }
  };

  // ================= ESTRUTURA VISUAL DO KANBAN =================
  const colunas = [
    { id: '1_solicitado_produtos', titulo: '1. Produtos (Início)', cor: '#3b82f6' },
    { id: '2_aguardando_complementos', titulo: '2. Geração de SKU (TI)', cor: '#8b5cf6' },
    { id: '3_aguardando_fabrica', titulo: '3. Ficha Técnica (Fábrica)', cor: '#f59e0b' },
    { id: '4_aguardando_financeiro', titulo: '4. Fiscal & Custos', cor: '#10b981' },
    { id: '5_pronto_para_revisao', titulo: '5. Integrado no Omie', cor: '#64748b' }
  ];

  // ================= TELAS DE AUTENTICAÇÃO =================
  if (carregandoAuth) return (<div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><h2 style={{ color: '#64748b' }}>⏳ Carregando sistema Biscoitê...</h2></div>);

  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h1 style={{ color: '#0f172a', marginBottom: '10px' }}>📦 Biscoitê PLM</h1>
          <p style={{ color: '#64748b', marginBottom: '30px' }}>Acesso exclusivo corporativo.</p>
          {erroLogin && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', fontWeight: 'bold' }}>{erroLogin}</div>}
          <button onClick={fazerLoginGoogle} style={{ width: '100%', padding: '14px', backgroundColor: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google Logo" style={{ width: '20px', height: '20px' }} /> Entrar com Google
          </button>
        </div>
      </div>
    );
  }

  if (perfilUsuario?.status === 'pendente') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '50px', marginBottom: '10px' }}>☕</div>
          <h2 style={{ color: '#0f172a' }}>Na fila de aprovação!</h2>
          <p style={{ color: '#64748b' }}>Seu acesso foi registrado. Aguarde a TI liberar sua permissão no sistema.</p>
          <button onClick={fazerLogout} style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sair</button>
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL (O SISTEMA) =================
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: '"Segoe UI", sans-serif', display: 'flex', flexDirection: 'column' }}>
      
      {/* HEADER ESTILO CLICKUP */}
      <div style={{ backgroundColor: '#ffffff', padding: '15px 30px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h1 style={{ color: '#0f172a', margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📦</span> Biscoitê PLM
          </h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setAbaAtiva('kanban')} style={{ padding: '6px 12px', backgroundColor: abaAtiva === 'kanban' ? '#e0e7ff' : 'transparent', color: abaAtiva === 'kanban' ? '#4338ca' : '#64748b', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Fluxo Kanban</button>
            {perfilUsuario?.setor === 'TI' && (
              <button onClick={() => setAbaAtiva('admin')} style={{ padding: '6px 12px', backgroundColor: abaAtiva === 'admin' ? '#e0e7ff' : 'transparent', color: abaAtiva === 'admin' ? '#4338ca' : '#64748b', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Painel TI</button>
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {abaAtiva === 'kanban' && (
            <button onClick={() => setModalAberto(true)} style={{ backgroundColor: '#0f172a', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>+</span> Novo Produto
            </button>
          )}
          <div style={{ borderLeft: '1px solid #e2e8f0', height: '30px', margin: '0 10px' }}></div>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#475569' }}>{perfilUsuario?.setor}</span>
          <button onClick={fazerLogout} style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '12px' }}>Sair</button>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        
        {abaAtiva === 'admin' && perfilUsuario?.setor === 'TI' && (
          <div style={{ padding: '30px', overflowY: 'auto' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h2 style={{ marginTop: 0, color: '#0f172a' }}>Gestão de Acessos</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}><th style={{ padding: '12px' }}>E-mail</th><th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Setor</th></tr>
                </thead>
                <tbody>
                  {listaUsuarios.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px', fontWeight: '500' }}>{user.email}</td>
                      <td style={{ padding: '12px' }}><select value={user.status} onChange={(e) => atualizarPermissaoUsuario(user.id, e.target.value, user.setor)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: user.status === 'aprovado' ? '#dcfce7' : '#fef08a' }}><option value="pendente">Pendente</option><option value="aprovado">Aprovado</option></select></td>
                      <td style={{ padding: '12px' }}><select value={user.setor} onChange={(e) => atualizarPermissaoUsuario(user.id, user.status, e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}><option value="PRODUTOS">PRODUTOS</option><option value="FINANCEIRO">FINANCEIRO / SUPPLY</option><option value="TI">TI</option></select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {abaAtiva === 'kanban' && (
          <div style={{ padding: '30px', flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
            <div style={{ display: 'flex', gap: '20px', minWidth: '1200px', height: '100%' }}>
              
              {colunas.map(coluna => (
                <div key={coluna.id} style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', height: '100%' }}>
                  
                  <div style={{ padding: '15px', borderBottom: '3px solid', borderBottomColor: coluna.cor, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderTopLeftRadius: '8px', borderTopRightRadius: '8px' }}>
                    <span style={{ fontWeight: 'bold', color: '#334155', fontSize: '13px', textTransform: 'uppercase' }}>{coluna.titulo}</span>
                    <span style={{ backgroundColor: '#e2e8f0', color: '#475569', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                      {cards.filter(c => c.status_atual === coluna.id).length}
                    </span>
                  </div>

                  <div style={{ padding: '15px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {cards.filter(c => c.status_atual === coluna.id).map(card => (
                      <div key={card.id} style={{ backgroundColor: '#ffffff', padding: '15px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'transform 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8', marginBottom: '5px' }}>{new Date(card.criado_em).toLocaleDateString('pt-BR')}</div>
                        <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '10px', fontSize: '14px' }}>{card.descricao}</div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                            {card.prefixo_categoria}
                          </span>
                          <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            👤 {card.criado_por.split('@')[0]}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              ))}

            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL NOVO PRODUTO ================= */}
      {modalAberto && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', width: '100%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, color: '#0f172a' }}>Novo Cadastro de SKU</h2>
              <button onClick={() => setModalAberto(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}>✖</button>
            </div>
            
            <form onSubmit={salvarNovoProduto} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', color: '#475569', fontSize: '13px', marginBottom: '5px' }}>Nome Final (PDV) *</label>
                <input required type="text" name="nomePdv" value={formProdutos.nomePdv} onChange={handleFormChange} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', color: '#475569', fontSize: '13px', marginBottom: '5px' }}>Categoria *</label>
                <select required name="categoria" value={formProdutos.categoria} onChange={handleFormChange} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}>
                  <option value="">Selecione...</option><option value="300">EXTERNO</option><option value="400">INTERNO</option><option value="500">CESTAS</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: 'bold', color: '#475569', fontSize: '13px', marginBottom: '5px' }}>Peso Liq (Kg)</label>
                  <input type="number" step="0.001" name="pesoLiquido" value={formProdutos.pesoLiquido} onChange={handleFormChange} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: 'bold', color: '#475569', fontSize: '13px', marginBottom: '5px' }}>Peso Bruto (Kg)</label>
                  <input type="number" step="0.001" name="pesoBruto" value={formProdutos.pesoBruto} onChange={handleFormChange} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setModalAberto(false)} style={{ padding: '10px 15px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>Cancelar</button>
                <button type="submit" disabled={carregandoDados} style={{ padding: '10px 15px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>{carregandoDados ? 'Salvando...' : 'Salvar Card'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;