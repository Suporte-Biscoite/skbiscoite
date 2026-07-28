import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// ================= CONEXÃO SUPABASE =================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ================= SISTEMA DE NOTIFICAÇÕES (TOAST & DIALOG) =================
  const [toast, setToast] = useState(null);
  const [dialogoConfirmacao, setDialogoConfirmacao] = useState(null); 

  const exibirToast = (mensagem, tipo = 'sucesso') => {
    setToast({ mensagem, tipo });
    setTimeout(() => setToast(null), 5000); 
  };

  const confirmarAcao = (titulo, mensagem, acao) => {
    setDialogoConfirmacao({ titulo, mensagem, onConfirm: acao });
  };

  // ================= ESTADOS DE USUÁRIOS E LOGIN =================
  const [usuarioLogado, setUsuarioLogado] = useState(null); 
  const [credenciais, setCredenciais] = useState({ email: '', senha: '' });
  const [erroLogin, setErroLogin] = useState('');
  const [sucessoLogin, setSucessoLogin] = useState(''); 
  const [carregandoLogin, setCarregandoLogin] = useState(false);

  const [telaLogin, setTelaLogin] = useState('login'); 
  const [emailRecuperacao, setEmailRecuperacao] = useState('');
  
  const [mostrarSenhaLogin, setMostrarSenhaLogin] = useState(false);
  const [mostrarSenhaForm, setMostrarSenhaForm] = useState(false);

  // ================= ESTADOS DO DASHBOARD DE USUÁRIOS =================
  const [usuariosCadastrados, setUsuariosCadastrados] = useState([]);
  const [abaGestao, setAbaGestao] = useState('lista'); 
  
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [carregandoModal, setCarregandoModal] = useState(false);

  const [formUsuario, setFormUsuario] = useState({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '', ativo: true });
  const [erroFormUser, setErroFormUser] = useState('');
  const [sucessoFormUser, setSucessoFormUser] = useState('');
  const [carregandoRegistro, setCarregandoRegistro] = useState(false);

  // ================= ESTADOS CORE =================
  const [modo, setModo] = useState('individual'); 
  const [formInd, setFormInd] = useState({ categoria: '200', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);

  const [historico, setHistorico] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // ================= ÍCONES SVG =================
  const IconeOlhoAberto = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
  );
  const IconeOlhoFechado = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
  );

  const obterIniciais = (nomeStr) => {
    if (!nomeStr) return 'U';
    const partes = nomeStr.trim().split(' ');
    if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
    return partes[0].substring(0, 2).toUpperCase();
  };

  // ================= LÓGICA DE USUÁRIOS =================
  const carregarUsuarios = async () => {
    const { data } = await supabase.from('usuarios').select('*').order('nome', { ascending: true });
    if (data) setUsuariosCadastrados(data);
  };

  useEffect(() => {
    if (modo === 'usuarios' && abaGestao === 'lista') carregarUsuarios();
  }, [modo, abaGestao]);

  const salvarEdicaoUsuario = async (e) => {
    e.preventDefault();
    setCarregandoModal(true);

    try {
      const { error } = await supabase.from('usuarios').update({
        nome: usuarioEditando.nome,
        email: usuarioEditando.email,
        login: usuarioEditando.login,
        setor: usuarioEditando.setor,
        ativo: usuarioEditando.ativo
      }).eq('id', usuarioEditando.id);
      
      if (error) throw error;
      
      exibirToast(`Dados de ${usuarioEditando.nome} atualizados.`, 'sucesso');
      setUsuarioEditando(null);
      carregarUsuarios();
    } catch (err) {
      exibirToast('Erro ao atualizar usuário.', 'erro');
    } finally {
      setCarregandoModal(false);
    }
  };

  // === CHAMADA DA NOVA API DE E-MAIL (MODAL) COM FALLBACK ===
  const solicitarNovaSenhaAleatoria = () => {
    confirmarAcao(
      'Gerar Nova Senha', 
      `Tem certeza que deseja redefinir o acesso de ${usuarioEditando.nome}?`,
      async () => {
        setCarregandoModal(true);
        const novaSenha = `Biscoite${Math.floor(1000 + Math.random() * 9000)}`;
        try {
          // 1. Atualiza no Supabase
          await supabase.from('usuarios').update({ senha: novaSenha }).eq('id', usuarioEditando.id);
          
          // 2. Dispara e-mail
          try {
            const res = await fetch('/api/enviar-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: usuarioEditando.email, nome: usuarioEditando.nome, senha: novaSenha })
            });

            if (!res.ok) throw new Error('Falha no envio de e-mail (Resend bloqueou ou sem chave)');

            exibirToast(`Senha gerada e enviada para ${usuarioEditando.email}.`, 'sucesso');
          } catch (emailErr) {
            console.error("Falha ao enviar e-mail via API:", emailErr);
            // FALLBACK: Mostra a senha na tela se o e-mail falhar
            exibirToast(`Senha de ${usuarioEditando.nome} alterada para: ${novaSenha}`, 'sucesso');
          }
        } catch (err) {
          exibirToast('Erro ao acessar o banco de dados. Tente novamente.', 'erro');
        } finally {
          setCarregandoModal(false);
          setUsuarioEditando(null);
        }
      }
    );
  };

  const registrarNovoUsuario = async (e) => {
    e.preventDefault();
    setErroFormUser(''); setSucessoFormUser(''); setCarregandoRegistro(true);

    if (formUsuario.senha !== formUsuario.confirmaSenha) {
      setCarregandoRegistro(false);
      return setErroFormUser('As senhas não coincidem!');
    }

    try {
      const { data: existente } = await supabase.from('usuarios').select('id').or(`email.eq.${formUsuario.email},login.eq.${formUsuario.login}`);
      if (existente && existente.length > 0) {
        setCarregandoRegistro(false);
        return setErroFormUser('Este e-mail ou login já está cadastrado.');
      }

      const { error } = await supabase.from('usuarios').insert([{
        nome: formUsuario.nome, login: formUsuario.login, senha: formUsuario.senha, email: formUsuario.email, setor: formUsuario.setor, ativo: true
      }]);
      if (error) throw error;

      setSucessoFormUser(`Colaborador cadastrado com sucesso!`);
      setFormUsuario({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '', ativo: true });
      setTimeout(() => { setAbaGestao('lista'); setSucessoFormUser(''); }, 1500); 
    } catch (error) {
      setErroFormUser('Erro ao criar usuário: ' + error.message);
    } finally {
      setCarregandoRegistro(false);
    }
  };

  // ================= LÓGICA DE LOGIN & RECUPERAÇÃO COM FALLBACK =================
  const handleRecuperarSenha = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      const { data: usuario } = await supabase.from('usuarios').select('id, nome, email').eq('email', emailRecuperacao).single();
      if (!usuario) {
        setErroLogin('E-mail não encontrado no sistema.');
        setCarregandoLogin(false);
        return;
      }
      
      const novaSenha = `Biscoite${Math.floor(1000 + Math.random() * 9000)}`;
      
      // 1. Atualiza no Supabase
      await supabase.from('usuarios').update({ senha: novaSenha }).eq('email', emailRecuperacao);

      // 2. Dispara e-mail
      try {
        const res = await fetch('/api/enviar-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: usuario.email, nome: usuario.nome, senha: novaSenha })
        });

        if (!res.ok) throw new Error('Falha no disparo do Resend');

        setTelaLogin('login');
        setSucessoLogin(`Nova senha gerada e enviada para sua caixa de entrada.`);
      } catch (emailErr) {
        console.error("Falha no e-mail:", emailErr);
        // FALLBACK: Mostra a senha na tela se o e-mail falhar
        setTelaLogin('login');
        setSucessoLogin(`Atenção: E-mail indisponível. Sua nova senha é: ${novaSenha}`);
      }

      setEmailRecuperacao('');
    } catch (err) {
      setErroLogin('Erro ao comunicar com o banco de dados Supabase.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      const { data } = await supabase.from('usuarios')
        .select('*')
        .or(`email.eq.${credenciais.email},login.eq.${credenciais.email}`)
        .eq('senha', credenciais.senha)
        .single();
      
      if (data) {
        if (data.ativo === false) {
          setErroLogin('Seu acesso está inativo. Contate o administrador.');
        } else {
          setUsuarioLogado(data);
          setCredenciais({ email: '', senha: '' });
        }
      } else {
        setErroLogin('Credenciais incorretas.');
      }
    } catch (err) {
      setErroLogin('Erro de comunicação. Verifique os dados.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  // ================= LÓGICA DE HISTÓRICO E OMIE =================
  const registrarHistorico = async (sku, descricao) => {
    if (!usuarioLogado) return;
    await supabase.from('historico_skus').insert([{ email_usuario: usuarioLogado.email, sku, descricao }]);
  };

  const carregarHistorico = async () => {
    setCarregandoHistorico(true);
    const { data } = await supabase.from('historico_skus').select('*').order('criado_em', { ascending: false }).limit(100); 
    if (data) setHistorico(data);
    setCarregandoHistorico(false);
  };

  useEffect(() => {
    if (modo === 'historico') carregarHistorico();
  }, [modo]);

  const solicitarLimpezaHistorico = () => {
    confirmarAcao(
      'Limpar Histórico da Nuvem',
      'Tem certeza que deseja apagar todos os registros de auditoria? Esta ação não pode ser desfeita.',
      async () => {
        await supabase.from('historico_skus').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        carregarHistorico();
        exibirToast('Histórico apagado com sucesso.', 'sucesso');
      }
    );
  };

  const buscarTodosCodigosOmie = async () => {
    const res1 = await fetch(`/api/codigos?pagina=1`);
    if (!res1.ok) throw new Error('Falha ao comunicar com Omie.');
    const data1 = await res1.json();
    let todosCodigos = [...data1.codigos];
    const totalPaginas = data1.total_paginas;

    if (totalPaginas > 1) {
      const promessas = [];
      for (let p = 2; p <= totalPaginas; p++) promessas.push(fetch(`/api/codigos?pagina=${p}`).then(r => r.json()));
      const resultados = await Promise.all(promessas);
      resultados.forEach(req => { if (req.codigos) todosCodigos = [...todosCodigos, ...req.codigos]; });
    }
    return todosCodigos;
  };

  const encontrarProximaVaga = (todosCodigos, prefixo) => {
    const prefixoStr = String(prefixo).trim(); 
    const numDigitosSequencia = 7 - prefixoStr.length; 
    const regex = new RegExp(`^${prefixoStr}\\d{${numDigitosSequencia}}$`);
    const descricoesStandBy = ['PRODUTO INDEFINIDO', 'PRODUTO INDENIDO', 'CÓDIGO EM STAND-BY'];

    const produtosDaCategoria = todosCodigos.filter(prod => {
      const cod = typeof prod === 'string' ? prod : prod.codigo;
      return cod && regex.test(String(cod).trim());
    });

    let proximaSequencia = 1; 
    while (true) {
      const codigoTestado = prefixoStr + proximaSequencia.toString().padStart(numDigitosSequencia, '0');
      const produtoExistente = produtosDaCategoria.find(prod => String(typeof prod === 'string' ? prod : prod.codigo).trim() === codigoTestado);

      if (!produtoExistente) return { codigo: codigoTestado, acao: 'IncluirProduto' };
      const desc = (produtoExistente.descricao || '').toUpperCase().trim();
      if (descricoesStandBy.includes(desc)) return { codigo: codigoTestado, acao: 'AlterarProduto' };
      proximaSequencia++;
    }
  };

  const cadastrarNoOmie = async (codigo, descricao, ncm, acao) => {
    const ncmFormatado = ncm && ncm.toString().trim() !== '' ? ncm.toString().trim() : '1905.90.20';
    const res = await fetch('/api/cadastrar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, descricao, unidade: "UN", preco: 0, ncm: ncmFormatado, acao })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no Omie.');
    return data;
  };

  const handleChangeInd = (e) => {
    let val = e.target.value.toUpperCase();
    if (e.target.name === 'ncm') val = val.replace(/\D/g, ''); 
    setFormInd({ ...formInd, [e.target.name]: val });
  };

  const gerarECadastrarIndividual = async (e) => {
    e.preventDefault();
    setProcInd(true); setSkuGerado(null); setErroInd(null);

    try {
      const descFormatada = formInd.descricao.trim();
      const todosCodigos = await buscarTodosCodigosOmie();
      if (todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descFormatada)) throw new Error(`Já existe um produto com este nome.`);

      const vaga = encontrarProximaVaga(todosCodigos, formInd.categoria);
      await cadastrarNoOmie(vaga.codigo, descFormatada, formInd.ncm, vaga.acao);
      
      setSkuGerado(vaga.codigo);
      await registrarHistorico(vaga.codigo, descFormatada); 
      setFormInd({ categoria: formInd.categoria, descricao: '', ncm: '' }); 
    } catch (err) { setErroInd(err.message); } finally { setProcInd(false); }
  };

  const baixarPlanilhaModelo = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Modelo SKU Biscoitê');
    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').value = 'Planilha de Importação de SKUs';
    worksheet.getCell('A1').font = { name: 'Arial', size: 16, color: { argb: 'FFFFFFFF' }, bold: true };
    worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B1E16' } };
    
    worksheet.mergeCells('A2:C2');
    worksheet.getCell('A2').value = 'Módulo: Gestão de Produtos Biscoitê';
    worksheet.getCell('A2').font = { name: 'Arial', size: 11, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B1E16' } };
    
    worksheet.addRow(['(obrigatório)\nPrefixo numérico\n(ex: 400)', '(obrigatório)\nNome em maiúsculas', '(opcional)\nNCM apenas números']).height = 60;
    worksheet.addRow(['CATEGORIA', 'DESCRICAO', 'NCM']).font = { bold: true };
    worksheet.addRow(['400', 'PRODUTO DE TESTE', '19059020']);
    worksheet.getColumn(1).width = 25; worksheet.getColumn(2).width = 50; worksheet.getColumn(3).width = 25;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Modelo_SKUs.xlsx'; anchor.click();
  };

  const lerArquivoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      setDadosPlanilha(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 3 }));
      setLogsMassa([]); 
    };
    reader.readAsArrayBuffer(file);
  };

  const processarEmMassa = async () => {
    if (dadosPlanilha.length === 0) return exibirToast("Envie uma planilha válida.", "erro");
    setProcMassa(true); setLogsMassa([]);

    try {
      const todosCodigos = await buscarTodosCodigosOmie();

      for (let i = 0; i < dadosPlanilha.length; i++) {
        const linha = dadosPlanilha[i];
        const catStr = String(linha.CATEGORIA || '').trim();
        const descStr = String(linha.DESCRICAO || '').toUpperCase().trim();
        const ncmStr = linha.NCM ? String(linha.NCM).replace(/\D/g, '').trim() : '';

        if (!catStr || !descStr) { setLogsMassa(prev => [...prev, { status: 'Erro', msg: `Linha ${i+1}: Faltam dados.` }]); continue; }
        if (todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descStr)) { setLogsMassa(prev => [...prev, { status: 'Erro', desc: descStr, msg: 'Já existe no Omie.' }]); continue; }

        const vaga = encontrarProximaVaga(todosCodigos, catStr);
        try {
          await cadastrarNoOmie(vaga.codigo, descStr, ncmStr, vaga.acao);
          if (vaga.acao === 'IncluirProduto') todosCodigos.push({ codigo: vaga.codigo, descricao: descStr });
          else { const p = todosCodigos.find(x => x.codigo === vaga.codigo); if (p) p.descricao = descStr; }
          
          setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: vaga.acao === 'AlterarProduto' ? 'Sucesso (Sobrescrito)' : 'Sucesso' }]);
          await registrarHistorico(vaga.codigo, descStr); 
        } catch (err) { setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: 'Erro', msg: err.message }]); }
      }
    } catch (err) { exibirToast("Erro crítico na importação.", "erro"); } finally { setProcMassa(false); setDadosPlanilha([]); }
  };

  // ================= TELA DE LOGIN =================
  if (!usuarioLogado) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="b-card" style={{ maxWidth: '420px', padding: '3rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h2 className="brand-font" style={{ color: 'var(--brand-gold)', fontSize: '2.5rem' }}>SKBiscoitê</h2>
            <p style={{ color: 'var(--text-mocha)', marginTop: '0.5rem' }}>Acesso Corporativo</p>
          </div>

          {erroLogin && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', textAlign: 'center', fontWeight: '500' }}>{erroLogin}</div>}
          {sucessoLogin && <div style={{ background: '#F0FDF4', color: '#7C9866', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', textAlign: 'center', fontWeight: '500' }}>{sucessoLogin}</div>}

          {telaLogin === 'login' ? (
            <form onSubmit={handleLogin} autoComplete="on">
              <div className="b-input-group">
                <label>Login ou E-mail</label>
                <input type="text" name="username" autoComplete="username" className="b-input" placeholder="nome@biscoite.com.br" value={credenciais.email} onChange={(e) => setCredenciais({...credenciais, email: e.target.value})} required />
              </div>
              <div className="b-input-group" style={{ position: 'relative' }}>
                <label>Senha</label>
                <input type={mostrarSenhaLogin ? "text" : "password"} name="password" autoComplete="current-password" className="b-input" placeholder="••••••••" value={credenciais.senha} onChange={(e) => setCredenciais({...credenciais, senha: e.target.value})} required style={{ paddingRight: '40px' }} />
                <button type="button" onClick={() => setMostrarSenhaLogin(!mostrarSenhaLogin)} style={{ position: 'absolute', right: '12px', top: '38px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mocha)' }}>
                  {mostrarSenhaLogin ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem', marginBottom: '2rem' }}>
                <span onClick={() => { setTelaLogin('recuperar'); setErroLogin(''); setSucessoLogin(''); }} style={{ fontSize: '0.85rem', color: 'var(--brand-gold)', cursor: 'pointer', fontWeight: '500' }}>Esqueci minha senha</span>
              </div>
              <button type="submit" className="b-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={carregandoLogin}>{carregandoLogin ? 'Autenticando...' : 'Acessar Sistema'}</button>
            </form>
          ) : (
            <form onSubmit={handleRecuperarSenha}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-mocha)', marginBottom: '1.5rem', textAlign: 'center' }}>Digite seu e-mail para gerar uma nova senha provisória.</p>
              <div className="b-input-group">
                <label>E-mail Corporativo</label>
                <input type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="nome@biscoite.com.br" className="b-input" required />
              </div>
              <button type="submit" className="b-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }} disabled={carregandoLogin}>{carregandoLogin ? 'Processando...' : 'Gerar Nova Senha'}</button>
              <button type="button" onClick={() => { setTelaLogin('login'); setErroLogin(''); }} className="b-btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>Voltar ao Login</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const ehTI = usuarioLogado?.setor?.toUpperCase() === 'TI';

  return (
    <div className="app-container">
      {toast && (
        <div className={`b-toast ${toast.tipo === 'sucesso' ? 'b-toast-sucesso' : 'b-toast-erro'}`}>
          {toast.tipo === 'sucesso' ? '✔️' : '⚠️'} {toast.mensagem}
        </div>
      )}

      {dialogoConfirmacao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(253, 251, 247, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="b-card" style={{ maxWidth: '420px', textAlign: 'center', padding: '2rem' }}>
            <h3 className="brand-font" style={{ marginBottom: '1rem', fontSize: '1.4rem' }}>{dialogoConfirmacao.titulo}</h3>
            <p style={{ color: 'var(--text-mocha)', marginBottom: '2rem', fontSize: '0.95rem' }}>{dialogoConfirmacao.mensagem}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button className="b-btn-ghost" onClick={() => setDialogoConfirmacao(null)}>Cancelar</button>
              <button className="b-btn" onClick={() => { dialogoConfirmacao.onConfirm(); setDialogoConfirmacao(null); }}>Confirmar Ação</button>
            </div>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div style={{ marginBottom: '1rem' }}>
          <h2 className="brand-font" style={{ color: 'var(--brand-gold)', fontSize: '2rem', margin: 0 }}>Biscoitê</h2>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-mocha)', fontWeight: 'bold' }}>SKU Management</span>
        </div>
        
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '2rem' }}>
          <button onClick={() => setModo('individual')} style={{ background: modo === 'individual' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'individual' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'individual' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
            Gerador Individual
          </button>
          
          <button onClick={() => setModo('massa')} style={{ background: modo === 'massa' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'massa' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'massa' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
            Importação em Massa
          </button>

          {ehTI && (
            <>
              <button onClick={() => setModo('usuarios')} style={{ background: modo === 'usuarios' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'usuarios' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'usuarios' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
                Gestão de Equipe
              </button>
              <button onClick={() => setModo('historico')} style={{ background: modo === 'historico' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'historico' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'historico' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
                Histórico & Auditoria
              </button>
            </>
          )}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-cream)', paddingTop: '1.5rem' }}>
          <button onClick={() => { setUsuarioLogado(null); setModo('individual'); }} className="b-btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            Encerrar Sessão
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div>
            <h1 className="brand-font">
              {modo === 'individual' && 'Novo SKU'}
              {modo === 'massa' && 'Processamento em Lote'}
              {modo === 'usuarios' && 'Gestão de Equipe'}
              {modo === 'historico' && 'Logs do Sistema'}
            </h1>
            <p>Conectado ao ambiente corporativo Omie ERP.</p>
          </div>
          
          <div className="user-profile-widget">
            <div className="user-info">
              <div className="user-name">{usuarioLogado.nome}</div>
              <div className="user-role">{usuarioLogado.setor}</div>
            </div>
            <div className="user-avatar">{obterIniciais(usuarioLogado.nome)}</div>
          </div>
        </header>

        {modo === 'individual' && (
          <div className="b-card fade-in">
            <h3 className="brand-font" style={{ marginBottom: '1.5rem', fontSize: '1.4rem' }}>Novo Produto (Individual)</h3>
            {erroInd && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{erroInd}</div>}

            <form onSubmit={gerarECadastrarIndividual}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '1.5rem' }}>
                <div className="b-input-group">
                  <label>Categoria (Prefixo)</label>
                  <select name="categoria" className="b-input" value={formInd.categoria} onChange={handleChangeInd} required>
                    <option value="">Selecione...</option>
                    <option value="200">200 - EMBALAGEM</option>
                    <option value="300">300 - EXTERNO</option>
                    <option value="400">400 - INTERNO</option>
                    <option value="500">500 - CESTAS</option>
                    <option value="1010">1010 - ENVASE</option>
                  </select>
                </div>
                
                <div className="b-input-group">
                  <label>Descrição do Produto</label>
                  <input type="text" name="descricao" className="b-input" placeholder="Ex: LATA MASCARPONE 200G" value={formInd.descricao} onChange={handleChangeInd} required />
                </div>

                <div className="b-input-group">
                  <label>NCM (Apenas Números)</label>
                  <input type="text" name="ncm" className="b-input" placeholder="19059020" value={formInd.ncm} onChange={handleChangeInd} />
                </div>
              </div>
              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={procInd} className="b-btn">{procInd ? 'Processando...' : 'Gerar e Sincronizar'}</button>
              </div>
            </form>

            {skuGerado && (
              <div style={{ marginTop: '2rem', padding: '2rem', background: 'var(--bg-vanilla)', border: '1px dashed var(--brand-gold)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-mocha)', fontWeight: 600 }}>CÓDIGO GERADO COM SUCESSO</span>
                <h1 style={{ color: 'var(--brand-gold)', fontSize: '2.5rem', marginTop: '0.5rem' }}>{skuGerado}</h1>
              </div>
            )}
          </div>
        )}

        {modo === 'massa' && (
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>Importação via Excel</h3>
              <button onClick={baixarPlanilhaModelo} className="b-btn-ghost">Baixar Planilha Modelo</button>
            </div>
            
            <div style={{ border: '2px dashed var(--border-cream)', padding: '3rem', textAlign: 'center', borderRadius: 'var(--radius-md)', marginBottom: '2rem', background: 'var(--bg-vanilla)' }}>
              <p style={{ fontWeight: '500', marginBottom: '1rem' }}>Anexe sua planilha .xlsx preenchida aqui</p>
              <label className="b-btn" style={{ cursor: 'pointer' }}>Selecionar Arquivo<input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} onChange={lerArquivoUpload} /></label>
            </div>

            {dadosPlanilha.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
                <button onClick={processarEmMassa} disabled={procMassa} className="b-btn">{procMassa ? `Processando ${dadosPlanilha.length} linhas...` : `Iniciar Importação (${dadosPlanilha.length} itens)`}</button>
              </div>
            )}

            {logsMassa.length > 0 && (
              <div className="b-input-group">
                <label>Console de Logs</label>
                <div style={{ background: 'var(--bg-vanilla)', border: '1px solid var(--border-cream)', padding: '1rem', borderRadius: 'var(--radius-sm)', minHeight: '150px', maxHeight: '250px', overflowY: 'auto', fontSize: '0.9rem' }}>
                  {logsMassa.map((log, i) => (
                    <div key={i} style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-cream)', color: log.status.includes('Sucesso') ? 'var(--success-pistachio)' : 'var(--danger-terracotta)', fontWeight: '500' }}>
                      <strong>{log.sku || 'Aviso'}</strong> - {log.desc || log.msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {modo === 'usuarios' && ehTI && (
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>{abaGestao === 'lista' ? 'Colaboradores' : 'Novo Colaborador'}</h3>
              {abaGestao === 'lista' ? (
                <button className="b-btn" onClick={() => setAbaGestao('criar')}>+ Adicionar Usuário</button>
              ) : (
                <button className="b-btn-ghost" onClick={() => setAbaGestao('lista')}>Voltar para Tabela</button>
              )}
            </div>

            {abaGestao === 'lista' ? (
              <div className="b-table-wrapper">
                <table className="b-table">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Login / Acesso</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosCadastrados.map(user => (
                      <tr key={user.id}>
                        <td style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--bg-vanilla)', border: '1px solid var(--border-cream)', color: 'var(--brand-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                            {obterIniciais(user.nome)}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600' }}>{user.nome}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-mocha)' }}>{user.email}</div>
                          </div>
                        </td>
                        <td>{user.login} <br/><span style={{fontSize: '0.75rem', color: 'var(--text-mocha)'}}>Setor: {user.setor}</span></td>
                        <td><span className={`b-badge ${user.ativo === false ? 'badge-inativo' : 'badge-ativo'}`}>{user.ativo === false ? 'INATIVO' : 'ATIVO'}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setUsuarioEditando({ ...user })} className="b-btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                            ✏️ Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <form onSubmit={registrarNovoUsuario} style={{ maxWidth: '600px', margin: '0 auto', background: 'var(--bg-vanilla)', padding: '2rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-cream)' }}>
                {erroFormUser && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{erroFormUser}</div>}
                {sucessoFormUser && <div style={{ background: '#F0FDF4', color: '#7C9866', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{sucessoFormUser}</div>}
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <div className="b-input-group"><label>Nome Completo</label><input type="text" name="nome" value={formUsuario.nome} onChange={(e) => setFormUsuario({...formUsuario, nome: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group"><label>E-mail Corporativo</label><input type="email" name="email" value={formUsuario.email} onChange={(e) => setFormUsuario({...formUsuario, email: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group"><label>Login</label><input type="text" name="login" value={formUsuario.login} onChange={(e) => setFormUsuario({...formUsuario, login: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group">
                    <label>Setor</label>
                    <select name="setor" value={formUsuario.setor} onChange={(e) => setFormUsuario({...formUsuario, setor: e.target.value})} className="b-input" required>
                      <option value="">Selecione...</option>
                      <option value="TI">TI</option>
                      <option value="Fabrica">Fábrica</option>
                      <option value="Produtos">Produtos</option>
                      <option value="Comercial">Comercial</option>
                    </select>
                  </div>
                  <div className="b-input-group" style={{ position: 'relative' }}>
                    <label>Senha</label>
                    <input type={mostrarSenhaForm ? "text" : "password"} name="senha" value={formUsuario.senha} onChange={(e) => setFormUsuario({...formUsuario, senha: e.target.value})} className="b-input" required />
                    <button type="button" onClick={() => setMostrarSenhaForm(!mostrarSenhaForm)} style={{ position: 'absolute', right: '12px', top: '33px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mocha)' }}>{mostrarSenhaForm ? <IconeOlhoFechado /> : <IconeOlhoAberto />}</button>
                  </div>
                  <div className="b-input-group" style={{ position: 'relative' }}>
                    <label>Confirmar Senha</label>
                    <input type={mostrarSenhaForm ? "text" : "password"} name="confirmaSenha" value={formUsuario.confirmaSenha} onChange={(e) => setFormUsuario({...formUsuario, confirmaSenha: e.target.value})} className="b-input" required />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" disabled={carregandoRegistro} className="b-btn">{carregandoRegistro ? 'Salvando...' : 'Cadastrar Colaborador'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {modo === 'historico' && ehTI && (
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>Auditoria Global (Supabase)</h3>
              <button onClick={solicitarLimpezaHistorico} className="b-btn-ghost" style={{ color: 'var(--danger-terracotta)' }}>Limpar Histórico</button>
            </div>
            
            <div className="b-table-wrapper">
              <table className="b-table">
                <thead>
                  <tr>
                    <th>SKU Gerado</th>
                    <th>Descrição Registrada</th>
                    <th>Usuário (Responsável)</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {carregandoHistorico ? <tr><td colSpan="4" style={{ textAlign: 'center' }}>Carregando dados...</td></tr> : 
                    historico.length === 0 ? <tr><td colSpan="4" style={{ textAlign: 'center' }}>Nenhum registro encontrado.</td></tr> :
                    historico.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontWeight: '600', color: 'var(--brand-gold)' }}>{log.sku}</td>
                      <td>{log.descricao}</td>
                      <td>{log.email_usuario}</td>
                      <td style={{ color: 'var(--text-mocha)', fontSize: '0.85rem' }}>{new Date(log.criado_em).toLocaleDateString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ================= MODAL DE EDIÇAO DE USUÁRIO ================= */}
      {usuarioEditando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(253, 251, 247, 0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="b-card" style={{ maxWidth: '540px', boxShadow: 'var(--shadow-float)' }}>
            <h3 className="brand-font" style={{ marginBottom: '0.5rem' }}>Perfil do Colaborador</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-mocha)', marginBottom: '1.5rem' }}>Edite os dados, bloqueie o acesso ou redefina a senha de <strong>{usuarioEditando.nome}</strong>.</p>
            
            <form onSubmit={salvarEdicaoUsuario}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="b-input-group">
                  <label>Nome</label>
                  <input type="text" className="b-input" value={usuarioEditando.nome} onChange={(e) => setUsuarioEditando({...usuarioEditando, nome: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>E-mail</label>
                  <input type="email" className="b-input" value={usuarioEditando.email} onChange={(e) => setUsuarioEditando({...usuarioEditando, email: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>Login</label>
                  <input type="text" className="b-input" value={usuarioEditando.login} onChange={(e) => setUsuarioEditando({...usuarioEditando, login: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>Setor</label>
                  <select className="b-input" value={usuarioEditando.setor} onChange={(e) => setUsuarioEditando({...usuarioEditando, setor: e.target.value})} required>
                    <option value="TI">TI</option>
                    <option value="Fabrica">Fábrica</option>
                    <option value="Produtos">Produtos</option>
                    <option value="Comercial">Comercial</option>
                  </select>
                </div>
                <div className="b-input-group">
                  <label>Status da Conta</label>
                  <select className="b-input" value={usuarioEditando.ativo !== false ? 'ativo' : 'inativo'} onChange={(e) => setUsuarioEditando({...usuarioEditando, ativo: e.target.value === 'ativo'})} required>
                    <option value="ativo">Ativo (Permitir Login)</option>
                    <option value="inativo">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              <div style={{ padding: '1.5rem', background: 'var(--bg-vanilla)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-cream)', marginBottom: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-mocha)', marginBottom: '0.8rem' }}>Precisa redefinir o acesso deste usuário?</p>
                <button type="button" onClick={solicitarNovaSenhaAleatoria} className="b-btn-ghost" style={{ color: 'var(--brand-gold)' }}>
                  🔑 Gerar Senha Aleatória e Enviar por E-mail
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" className="b-btn-ghost" onClick={() => setUsuarioEditando(null)}>Cancelar</button>
                <button type="submit" className="b-btn" disabled={carregandoModal}>{carregandoModal ? 'Salvando...' : 'Salvar Perfil'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;