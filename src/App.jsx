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
  const [abaAtiva, setAbaAtiva] = useState('kanban'); 
  const [listaUsuarios, setListaUsuarios] = useState([]);
  
  // Estados do Kanban
  const [cards, setCards] = useState([]);
  const [carregandoDados, setCarregandoDados] = useState(false);
  
  // Estados do Modal
  const [modalAberto, setModalAberto] = useState(false);
  const [formProdutos, setFormProdutos] = useState({
    nomePdv: '', categoria: '', pesoLiquido: '', pesoBruto: ''
  });

  // ================= LÓGICA DE LOGIN =================
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
      carregarKanban(); 
    } catch (err) {
      alert("Erro ao criar produto."); console.error(err);
    } finally {
      setCarregandoDados(false);
    }
  };

  // ================= UTILITÁRIOS VISUAIS =================
  const calcularDias = (dataString) => {
    if (!dataString) return 0;
    const diff = new Date() - new Date(dataString);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const colunas = [
    { id: '1_solicitado_produtos', titulo: '1. Início (Produtos)', cor: '#2563eb', dono: 'PRODUTOS' },
    { id: '2_aguardando_complementos', titulo: '2. Gerar SKU (TI)', cor: '#7c3aed', dono: 'TI' },
    { id: '3_aguardando_fabrica', titulo: '3. Ficha Téc. (Fábrica)', cor: '#ea580c', dono: 'FABRICA' },
    { id: '4_aguardando_financeiro', titulo: '4. Fiscal & Custos', cor: '#059669', dono: 'FINANCEIRO' },
    { id: '5_pronto_para_revisao', titulo: '5. Finalizado (Omie)', cor: '#475569', dono: 'SISTEMA' }
  ];

  // ================= TELAS DE AUTENTICAÇÃO =================
  if (carregandoAuth) return (<div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><h2 style={{ color: '#64748b' }}>⏳ Conectando à Biscoitê...</h2></div>);

  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '420px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ width: '60px', height: '60px', backgroundColor: '#0f172a', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '28px', color: '#fff' }}>📦</div>
          <h1 style={{ color: '#0f172a', margin: '0 0 10px 0', fontSize: '24px' }}>Biscoitê PLM</h1>
          <p style={{ color: '#64748b', marginBottom: '30px', fontSize: '15px' }}>Gestão de Ciclo de Vida de Produtos</p>
          {erroLogin && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', fontWeight: 'bold' }}>{erroLogin}</div>}
          <button onClick={fazerLoginGoogle} style={{ width: '100%', padding: '14px', backgroundColor: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google" style={{ width: '20px' }} /> Acesso Corporativo
          </button>
        </div>
      </div>
    );
  }

  if (perfilUsuario?.status === 'pendente') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '500px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '50px', marginBottom: '10px' }}>🔐</div>
          <h2 style={{ color: '#0f172a' }}>Acesso em Análise</h2>
          <p style={{ color: '#64748b' }}>Seu registro foi recebido pela TI. Aguarde a liberação do seu perfil de acesso.</p>
          <button onClick={fazerLogout} style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Voltar</button>
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL (EXECUTIVE DASHBOARD) =================
  return (
    <div style={{ height: '100vh', backgroundColor: '#f8fafc', fontFamily: '"Inter", "Segoe UI", sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* TOP NAVIGATION */}
      <nav style={{ backgroundColor: '#0f172a', padding: '0 24px', height: '64px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#38bdf8' }}>✦</span> PLM Biscoitê
          </div>
          <div style={{ display: 'flex', gap: '5px' }}>
            <button onClick={() => setAbaAtiva('kanban')} style={{ padding: '8px 16px', backgroundColor: abaAtiva === 'kanban' ? '#1e293b' : 'transparent', color: abaAtiva === 'kanban' ? '#fff' : '#94a3b8', border: 'none', borderRadius: '6px', fontWeight: '500', cursor: 'pointer', transition: '0.2s' }}>Visão Geral (Kanban)</button>
            {perfilUsuario?.setor === 'TI' && (
              <button onClick={() => setAbaAtiva('admin')} style={{ padding: '8px 16px', backgroundColor: abaAtiva === 'admin' ? '#1e293b' : 'transparent', color: abaAtiva === 'admin' ? '#fff' : '#94a3b8', border: 'none', borderRadius: '6px', fontWeight: '500', cursor: 'pointer', transition: '0.2s' }}>Controle de Acessos</button>
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '14px', fontWeight: '600' }}>{usuarioLogado.split('@')[0]}</span>
            <span style={{ fontSize: '11px', color: '#94a3b8', backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: '4px', marginTop: '2px' }}>Setor: {perfilUsuario?.setor}</span>
          </div>
          <button onClick={fazerLogout} style={{ backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '6px 12px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}>Sair</button>
        </div>
      </nav>

      {/* CONTEÚDO */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {abaAtiva === 'kanban' && (
          <>
            {/* KPI DASHBOARD HEADER */}
            <div style={{ padding: '24px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ margin: '0 0 5px 0', color: '#0f172a', fontSize: '24px', fontWeight: '700' }}>Pipeline de Cadastro</h1>
                <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>Monitoramento de ciclo de vida e gargalos de SKU.</p>
              </div>
              
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 20px', display: 'flex', flexDirection: 'column', minWidth: '120px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Em Andamento</span>
                  <span style={{ fontSize: '24px', color: '#0f172a', fontWeight: 'bold' }}>{cards.filter(c => c.status_atual !== '5_pronto_para_revisao').length}</span>
                </div>
                <div style={{ backgroundColor: '#fff', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 20px', display: 'flex', flexDirection: 'column', minWidth: '120px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: '600', textTransform: 'uppercase' }}>Gargalos (&gt;3 dias)</span>
                  <span style={{ fontSize: '24px', color: '#dc2626', fontWeight: 'bold' }}>{cards.filter(c => calcularDias(c.criado_em) >= 3 && c.status_atual !== '5_pronto_para_revisao').length}</span>
                </div>
                <button onClick={() => setModalAberto(true)} style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0 24px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                  <span style={{ fontSize: '18px' }}>+</span> Nova Solicitação
                </button>
              </div>
            </div>

            {/* KANBAN BOARD */}
            <div style={{ padding: '24px 32px', flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
              <div style={{ display: 'flex', gap: '24px', minWidth: '1300px', height: '100%' }}>
                
                {colunas.map(coluna => {
                  const cardsDaColuna = cards.filter(c => c.status_atual === coluna.id);
                  
                  return (
                    <div key={coluna.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
                      
                      {/* HEADER DA COLUNA (Clean) */}
                      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: coluna.cor }}></div>
                          <span style={{ fontWeight: '700', color: '#1e293b', fontSize: '14px' }}>{coluna.titulo}</span>
                        </div>
                        <span style={{ backgroundColor: '#e2e8f0', color: '#475569', padding: '2px 8px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                          {cardsDaColuna.length}
                        </span>
                      </div>

                      {/* ÁREA DOS CARDS */}
                      <div style={{ backgroundColor: '#f1f5f9', borderRadius: '10px', padding: '12px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid #e2e8f0' }}>
                        {cardsDaColuna.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', marginTop: '20px', fontWeight: '500' }}>Nenhum item na fila</div>}
                        
                        {cardsDaColuna.map(card => {
                          const dias = calcularDias(card.criado_em);
                          const isAtrasado = dias >= 3 && coluna.id !== '5_pronto_para_revisao';
                          
                          return (
                            <div key={card.id} style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', border: `1px solid ${isAtrasado ? '#fca5a5' : '#e2e8f0'}`, borderLeft: `4px solid ${coluna.cor}`, cursor: 'pointer', transition: 'all 0.15s' }} onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'translateY(-1px)'; }} onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                <span style={{ backgroundColor: '#f8fafc', color: '#475569', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', border: '1px solid #e2e8f0' }}>
                                  CAT: {card.prefixo_categoria}
                                </span>
                                {/* INDICADOR DE GARGALO */}
                                <div style={{ fontSize: '11px', fontWeight: '600', color: isAtrasado ? '#dc2626' : '#64748b', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: isAtrasado ? '#fee2e2' : 'transparent', padding: isAtrasado ? '2px 6px' : '0', borderRadius: '4px' }}>
                                  {isAtrasado ? '⚠️' : '🕒'} {dias} {dias === 1 ? 'dia' : 'dias'}
                                </div>
                              </div>
                              
                              <div style={{ fontWeight: '700', color: '#0f172a', marginBottom: '12px', fontSize: '14px', lineHeight: '1.4' }}>
                                {card.descricao}
                              </div>
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>
                                  Resp: <strong style={{ color: '#334155' }}>{coluna.dono}</strong>
                                </div>
                                <div title={card.criado_por} style={{ width: '24px', height: '24px', backgroundColor: '#e2e8f0', color: '#475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold' }}>
                                  {card.criado_por.substring(0, 2).toUpperCase()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  );
                })}

              </div>
            </div>
          </>
        )}

        {/* ABA ADMIN */}
        {abaAtiva === 'admin' && perfilUsuario?.setor === 'TI' && (
          <div style={{ padding: '32px', overflowY: 'auto' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', maxWidth: '1000px', margin: '0 auto' }}>
              <h2 style={{ marginTop: 0, color: '#0f172a', fontSize: '20px' }}>Gestão de Acessos e Perfis</h2>
              <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '14px' }}>Gerencie quem pode visualizar e interagir com as etapas do PLM.</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}><th style={{ padding: '16px' }}>Colaborador (E-mail)</th><th style={{ padding: '16px' }}>Status de Acesso</th><th style={{ padding: '16px' }}>Setor Operacional</th></tr>
                </thead>
                <tbody>
                  {listaUsuarios.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '16px', fontWeight: '500', color: '#0f172a' }}>{user.email}</td>
                      <td style={{ padding: '16px' }}><select value={user.status} onChange={(e) => atualizarPermissaoUsuario(user.id, e.target.value, user.setor)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: user.status === 'aprovado' ? '#dcfce7' : '#fef08a', color: '#0f172a', fontWeight: '600', outline: 'none' }}><option value="pendente">Pendente ⏳</option><option value="aprovado">Aprovado ✅</option></select></td>
                      <td style={{ padding: '16px' }}><select value={user.setor} onChange={(e) => atualizarPermissaoUsuario(user.id, user.status, e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', color: '#0f172a', fontWeight: '500', outline: 'none' }}><option value="PRODUTOS">Time de Produtos</option><option value="FINANCEIRO">Financeiro / Supply</option><option value="TI">TI (Admin)</option><option value="FABRICA">Fábrica (P&D)</option></select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ================= MODAL NOVO PRODUTO ================= */}
      {modalAberto && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '500px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: '0 0 5px 0', color: '#0f172a', fontSize: '20px' }}>Solicitar Novo SKU</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>Preencha as informações iniciais para a TI gerar o código.</p>
              </div>
              <button onClick={() => setModalAberto(false)} style={{ background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', transition: '0.2s' }}>✖</button>
            </div>
            
            <form onSubmit={salvarNovoProduto} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', color: '#334155', fontSize: '13px', marginBottom: '6px' }}>Nome Final do Produto (PDV) *</label>
                <input required type="text" name="nomePdv" value={formProdutos.nomePdv} onChange={handleFormChange} placeholder="Ex: PANETONE TRUFADO 500G" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: '600', color: '#334155', fontSize: '13px', marginBottom: '6px' }}>Categoria (Prefixo) *</label>
                <select required name="categoria" value={formProdutos.categoria} onChange={handleFormChange} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px', backgroundColor: '#fff' }}>
                  <option value="">Selecione a categoria...</option><option value="300">300 - EXTERNO</option><option value="400">400 - INTERNO</option><option value="500">500 - CESTAS</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#334155', fontSize: '13px', marginBottom: '6px' }}>Peso Liq (Kg)</label>
                  <input type="number" step="0.001" name="pesoLiquido" value={formProdutos.pesoLiquido} onChange={handleFormChange} placeholder="0.500" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', color: '#334155', fontSize: '13px', marginBottom: '6px' }}>Peso Bruto (Kg)</label>
                  <input type="number" step="0.001" name="pesoBruto" value={formProdutos.pesoBruto} onChange={handleFormChange} placeholder="0.550" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', fontSize: '14px' }} />
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '24px' }}>
                <button type="button" onClick={() => setModalAberto(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#475569', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Cancelar</button>
                <button type="submit" disabled={carregandoDados} style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', backgroundColor: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>{carregandoDados ? 'Salvando...' : 'Criar Solicitação'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;