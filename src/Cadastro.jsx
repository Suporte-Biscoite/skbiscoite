import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAMILIAS } from './lib/familias.js';
import { lerLinhasDaPlanilha } from './lib/skus.js';
import { montarModeloPlanilha } from './lib/modeloPlanilha.js';
import { validarItem, nomeFamiliaOmie, nomeCategoriaNexaas, cenarioLoja } from './lib/regras.js';
import './Cadastro.css';

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ncmBonito = (ncm) => (String(ncm).length === 8 ? `${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6)}` : ncm || '—');
let contador = 0;
const novoUid = () => `i${Date.now().toString(36)}${contador++}`;

const FORM_VAZIO = { familia: '400', descricao: '', ncm: '', entraNaLoja: '', sazonal: false, familiaSazonal: '' };

// ---------- Peças visuais ----------
const ROTULOS = {
  pendente: ['Na fila', 'cad-chip--espera'],
  criando: ['Criando…', 'cad-chip--andando'],
  ok: ['Criado', 'cad-chip--ok'],
  erro: ['Erro', 'cad-chip--erro'],
};
function Chip({ status, rotulo }) {
  const [texto, classe] = ROTULOS[status] || ROTULOS.pendente;
  return <span className={`cad-chip ${classe}`}>{rotulo || texto}</span>;
}

function Esqueleto({ linhas = 3 }) {
  return (
    <div className="cad-esqueleto" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => <div key={i} className="cad-esqueleto__linha" />)}
    </div>
  );
}

// Resume, em linguagem simples, o que será criado em cada sistema (antes de enviar).
function PreviaDestino({ item }) {
  if (!item.familia || item.entraNaLoja === null) return null;
  const cenario = cenarioLoja(item.entraNaLoja);
  return (
    <dl className="cad-previa" aria-label="Como o produto será criado">
      <div><dt>Omie · família</dt><dd>{nomeFamiliaOmie(item) || '—'}</dd></div>
      <div><dt>Nexaas · categoria</dt><dd>{nomeCategoriaNexaas(item) || '—'}</dd></div>
      <div><dt>Nexaas · canais</dt><dd>{cenario.todosOsCanais ? 'Todos os canais' : 'Apenas ESTOQUE'}</dd></div>
      <div><dt>Nexaas · visibilidade</dt><dd>{cenario.visibility === 'both' ? 'On-line e off-line' : 'Apenas off-line'}</dd></div>
    </dl>
  );
}

// ---------- Tela ----------
export default function Cadastro({ modo, api, exibirToast }) {
  const [familias, setFamilias] = useState({ carregando: true, erro: '', sazonais: [] });
  const [form, setForm] = useState(FORM_VAZIO);
  const [itens, setItens] = useState([]);
  const [erros, setErros] = useState({}); // uid -> [mensagens]
  const [validando, setValidando] = useState(false);
  const [sincronizacao, setSincronizacao] = useState(null); // { pagina, total } enquanto carrega o catálogo
  const [exec, setExec] = useState(null); // { loteId, itens, rodando, concluido }
  const [erroTela, setErroTela] = useState('');
  const [arrastando, setArrastando] = useState(false);
  const vivo = useRef(true);
  const versaoValidacao = useRef(0);

  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  // Avisa antes de fechar a aba se há trabalho em andamento ou lista ainda não enviada.
  const emAndamento = !!exec?.rodando || (!exec && itens.length > 0);
  useEffect(() => {
    if (!emAndamento) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [emAndamento]);

  const carregarFamilias = useCallback(async () => {
    setFamilias((f) => ({ ...f, carregando: true, erro: '' }));
    try {
      const dados = await api('/api/familias');
      if (vivo.current) setFamilias({ carregando: false, erro: '', sazonais: dados.sazonais || [] });
    } catch (err) {
      if (vivo.current) setFamilias({ carregando: false, erro: err.message, sazonais: [] });
    }
  }, [api]);
  useEffect(() => { carregarFamilias(); }, [carregarFamilias]);

  // O catálogo do Omie é carregado uma única vez (~1 min); depois só se atualiza o que mudou.
  const carregarCatalogo = useCallback(async () => {
    setSincronizacao({ pagina: 0, total: 0 });
    for (;;) {
      const r = await api('/api/sincronizar', { metodo: 'POST' });
      if (!vivo.current) return;
      setSincronizacao({ pagina: r.pagina, total: r.total_paginas });
      if (r.completo) break;
    }
    setSincronizacao(null);
  }, [api]);

  // Chama a API de lotes; se o catálogo ainda não foi carregado, carrega e tenta de novo.
  const chamarLotes = useCallback(async (corpo) => {
    try {
      return await api('/api/lotes', { metodo: 'POST', corpo });
    } catch (err) {
      if (!err.dados?.precisaSincronizar) throw err;
      await carregarCatalogo();
      return api('/api/lotes', { metodo: 'POST', corpo });
    }
  }, [api, carregarCatalogo]);

  const payload = useMemo(() => itens.map((i, idx) => ({
    linha: idx + 1, descricao: i.descricao, familia: i.familia, ncm: i.ncm, entraNaLoja: i.entraNaLoja,
    sazonal: i.sazonal ? 'Sim' : 'Não', familiaSazonal: i.familiaSazonal,
  })), [itens]);

  // Confere a lista no servidor (família, NCM, duplicidade...) sempre que ela muda.
  useEffect(() => {
    if (itens.length === 0) { setErros({}); return undefined; }
    const versao = ++versaoValidacao.current;
    setValidando(true);
    const espera = setTimeout(async () => {
      try {
        const r = await chamarLotes({ acao: 'validar', itens: payload });
        if (versao !== versaoValidacao.current || !vivo.current) return;
        setErros(Object.fromEntries(r.itens.map((x, idx) => [itens[idx].uid, x.erros])));
      } catch (err) {
        if (versao === versaoValidacao.current && vivo.current) setErroTela(err.message);
      } finally {
        if (versao === versaoValidacao.current && vivo.current) setValidando(false);
      }
    }, 400);
    return () => clearTimeout(espera);
  }, [itens, payload, chamarLotes]);

  const { item: previa, erros: errosForm } = useMemo(() => validarItem({
    ...form, sazonal: form.sazonal ? 'Sim' : 'Não',
  }), [form]);
  const errosCampo = errosForm.filter((e) => !/descri/i.test(e) || form.descricao);
  const formCompleto = errosForm.length === 0;

  const mudar = (campo) => (e) => {
    let valor = e.target.value;
    if (campo === 'descricao') valor = valor.toUpperCase();
    if (campo === 'ncm') valor = valor.replace(/\D/g, '').slice(0, 8);
    setForm((f) => ({ ...f, [campo]: valor }));
  };

  const adicionar = (e) => {
    e.preventDefault();
    if (!formCompleto) return;
    setItens((lista) => [...lista, { uid: novoUid(), ...form }]);
    // Mantém família, loja e sazonalidade para agilizar vários produtos seguidos.
    setForm((f) => ({ ...f, descricao: '', ncm: f.ncm }));
    setErroTela('');
    document.getElementById('cad-descricao')?.focus();
  };

  const remover = (uid) => setItens((lista) => lista.filter((i) => i.uid !== uid));

  const baixarModelo = async () => {
    const [{ default: ExcelJS }] = await Promise.all([import('exceljs')]);
    const buffer = await montarModeloPlanilha(ExcelJS).xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'Modelo_SKUs.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const lerPlanilha = async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois de corrigir
    return processarArquivo(arquivo);
  };

  const soltarPlanilha = (e) => {
    e.preventDefault();
    setArrastando(false);
    return processarArquivo(e.dataTransfer.files[0]);
  };

  const processarArquivo = async (arquivo) => {
    if (!arquivo) return;
    if (!/.xlsx?$/i.test(arquivo.name)) return exibirToast('Envie um arquivo .xlsx (use o modelo).', 'erro');
    try {
      const XLSX = await import('xlsx');
      const livro = XLSX.read(new Uint8Array(await arquivo.arrayBuffer()), { type: 'array' });
      const aba = livro.Sheets[livro.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });
      const primeiraLinha = aba['!ref'] ? XLSX.utils.decode_range(aba['!ref']).s.r + 1 : 1;
      const linhas = lerLinhasDaPlanilha(matriz, primeiraLinha);
      if (linhas.length === 0) return exibirToast('Nenhuma linha preenchida na planilha.', 'erro');
      setItens(linhas.map((l) => ({
        uid: novoUid(), linhaPlanilha: l.linha, familia: l.familia, descricao: l.descricao.toUpperCase(), ncm: l.ncm,
        entraNaLoja: l.entraNaLoja, sazonal: /^(s|sim|1|true)$/i.test(l.sazonal), familiaSazonal: l.familiaSazonal,
      })));
      setExec(null);
      exibirToast(`${linhas.length} linha(s) lidas. Confira a pré-visualização abaixo.`);
    } catch (err) {
      exibirToast(err.message, 'erro');
    }
  };

  // ---------- Execução (progresso em tempo real) ----------
  const executar = useCallback(async (loteId) => {
    setExec((x) => ({ ...(x || {}), loteId, rodando: true }));
    const atualizar = (s) => vivo.current && setExec((x) => ({ ...x, loteId, itens: s.itens, concluido: s.concluido, rodando: true }));
    // Acompanha de perto (a cada 1,5 s) enquanto o servidor trabalha em outra chamada.
    const acompanhar = setInterval(async () => {
      try { atualizar(await api(`/api/lotes?id=${loteId}`)); } catch { /* a próxima volta tenta de novo */ }
    }, 1500);
    try {
      let estado;
      do {
        estado = await chamarLotes({ acao: 'processar', id: loteId });
        atualizar(estado);
        if (!estado.concluido) await pausa(1000);
      } while (!estado.concluido && vivo.current);
    } catch (err) {
      exibirToast(err.message, 'erro');
    } finally {
      clearInterval(acompanhar);
      if (vivo.current) setExec((x) => ({ ...x, rodando: false }));
    }
  }, [api, chamarLotes, exibirToast]);

  const cadastrar = async () => {
    setErroTela('');
    try {
      const r = await chamarLotes({ acao: 'criar', itens: payload });
      if (!r.lote_id) {
        setErros(Object.fromEntries(r.bloqueados.map((b) => [itens[b.linha - 1].uid, b.erros])));
        return exibirToast('Nenhum produto pôde ser cadastrado. Corrija os itens em vermelho.', 'erro');
      }
      // Itens bloqueados ficam na lista para correção; os válidos seguem para a fila.
      const bloqueadas = new Set(r.bloqueados.map((b) => b.linha));
      setErros(Object.fromEntries(r.bloqueados.map((b) => [itens[b.linha - 1].uid, b.erros])));
      setItens((lista) => lista.filter((_, idx) => bloqueadas.has(idx + 1)));
      setExec({ loteId: r.lote_id, itens: [], rodando: true, concluido: false, bloqueados: r.bloqueados.length });
      executar(r.lote_id);
    } catch (err) {
      setErroTela(err.message);
    }
  };

  const tentarNovamente = async (itemId) => {
    try {
      await chamarLotes({ acao: 'tentar-novamente', id: exec.loteId, itemId });
      executar(exec.loteId);
    } catch (err) {
      exibirToast(err.message, 'erro');
    }
  };

  const copiarCodigos = async () => {
    const texto = exec.itens.filter((i) => i.codigo).map((i) => `${i.codigo}\t${i.descricao}`).join('\n');
    try { await navigator.clipboard.writeText(texto); exibirToast('Códigos copiados.'); } catch { exibirToast('Não consegui copiar.', 'erro'); }
  };

  const removerComProblema = () => setItens((lista) => lista.filter((i) => !(erros[i.uid] || []).length));

  const novoCadastro = () => { setExec(null); setErros({}); };

  const totalErros = itens.filter((i) => (erros[i.uid] || []).length > 0).length;
  const feitos = exec?.itens?.filter((i) => i.omie_status === 'erro' || (i.omie_status === 'ok' && ['ok', 'erro'].includes(i.nexaas_status))).length ?? 0;
  const totalExec = exec?.itens?.length ?? 0;
  const comErroExec = exec?.itens?.filter((i) => i.omie_status === 'erro' || i.nexaas_status === 'erro').length ?? 0;
  const bloqueadoPelaTela = !!exec?.rodando;

  // ---------- Render ----------
  return (
    <div className="cad">
      {sincronizacao && (
        <div className="b-card cad-aviso fade-in" role="status">
          <h3 className="brand-font">Preparando o catálogo do Omie</h3>
          <p>Primeira vez: estou guardando os códigos já existentes para os próximos cadastros ficarem rápidos. Isso acontece uma única vez.</p>
          <div className="cad-barra" aria-hidden="true"><span style={{ width: `${sincronizacao.total ? (sincronizacao.pagina / sincronizacao.total) * 100 : 4}%` }} /></div>
          <small>{sincronizacao.total ? `Página ${sincronizacao.pagina} de ${sincronizacao.total}` : 'Iniciando…'}</small>
        </div>
      )}

      {!exec && (
        <section className="b-card cad-secao fade-in">
          {modo === 'individual' ? (
            <>
              <h3 className="brand-font">Novo produto</h3>
              {familias.erro && (
                <div className="cad-erro" role="alert">
                  Não consegui carregar as famílias sazonais: {familias.erro}{' '}
                  <button type="button" className="cad-link" onClick={carregarFamilias}>Tentar de novo</button>
                </div>
              )}
              <form onSubmit={adicionar} className="cad-form" noValidate>
                <div className="b-input-group">
                  <label htmlFor="cad-familia">Família do produto</label>
                  <select id="cad-familia" className="b-input" value={form.familia} onChange={mudar('familia')}>
                    {FAMILIAS.map((f) => <option key={f.prefixo} value={f.prefixo}>{f.familia} ({f.prefixo})</option>)}
                  </select>
                </div>

                <div className="b-input-group cad-form__descricao">
                  <label htmlFor="cad-descricao">Descrição do produto</label>
                  <input id="cad-descricao" className="b-input" value={form.descricao} onChange={mudar('descricao')} placeholder="Ex: LATA MASCARPONE 200G" autoComplete="off" />
                </div>

                <div className="b-input-group">
                  <label htmlFor="cad-ncm">NCM (8 dígitos)</label>
                  <input id="cad-ncm" className="b-input" inputMode="numeric" value={form.ncm} onChange={mudar('ncm')} placeholder="19059020" autoComplete="off" />
                </div>

                <fieldset className="cad-grupo">
                  <legend>Entra na loja?</legend>
                  <div className="cad-segmentado" role="radiogroup">
                    {['Sim', 'Não'].map((op) => (
                      <label key={op} className={form.entraNaLoja === op ? 'ativo' : ''}>
                        <input type="radio" name="entra" value={op} checked={form.entraNaLoja === op} onChange={mudar('entraNaLoja')} />
                        {op}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="cad-grupo">
                  <label className="cad-switch">
                    <input type="checkbox" role="switch" checked={form.sazonal} onChange={(e) => setForm((f) => ({ ...f, sazonal: e.target.checked, familiaSazonal: '' }))} />
                    <span className="cad-switch__trilho" aria-hidden="true" />
                    Produto sazonal (Natal, Páscoa…)
                  </label>
                  {form.sazonal && (
                    <div className="b-input-group cad-sazonal fade-in">
                      <label htmlFor="cad-sazonal">Família sazonal</label>
                      {familias.carregando ? <Esqueleto linhas={1} /> : (
                        <select id="cad-sazonal" className="b-input" value={form.familiaSazonal} onChange={mudar('familiaSazonal')}>
                          <option value="">Selecione…</option>
                          {familias.sazonais.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <PreviaDestino item={previa} />

                {errosCampo.length > 0 && form.descricao && (
                  <ul className="cad-dicas" aria-live="polite">{errosCampo.map((e) => <li key={e}>{e}</li>)}</ul>
                )}

                <div className="cad-acoes">
                  <button type="submit" className="b-btn" disabled={!formCompleto}>Adicionar à lista</button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="cad-secao__topo">
                <h3 className="brand-font">Importar planilha</h3>
                <button type="button" className="b-btn-ghost" onClick={baixarModelo}>Baixar modelo</button>
              </div>
              <label className={`cad-soltar ${arrastando ? 'cad-soltar--sobre' : ''}`} onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={soltarPlanilha}>
                <input type="file" accept=".xlsx,.xls" onChange={lerPlanilha} />
                <strong>Escolha ou arraste a planilha preenchida (.xlsx)</strong>
                <span>Colunas: FAMILIA, DESCRICAO, NCM, ENTRA NA LOJA (Sim/Não) e, se for sazonal, SAZONAL (Sim) + FAMILIA SAZONAL.</span>
              </label>
            </>
          )}
        </section>
      )}

      {/* Lista / pré-visualização */}
      {!exec && (
        <section className="b-card cad-secao fade-in" aria-labelledby="cad-lista-titulo">
          <div className="cad-secao__topo">
            <h3 id="cad-lista-titulo" className="brand-font">Lista para cadastrar {itens.length > 0 && <span className="cad-contagem">{itens.length}</span>}</h3>
            {itens.length > 0 && <button type="button" className="b-btn-ghost" onClick={() => setItens([])}>Limpar</button>}
          </div>

          {erroTela && <div className="cad-erro" role="alert">{erroTela}</div>}

          {itens.length === 0 ? (
            <p className="cad-vazio">{modo === 'individual' ? 'Adicione um ou vários produtos. Eles são conferidos antes do envio.' : 'Nenhuma planilha carregada ainda.'}</p>
          ) : (
            <ul className="cad-lista">
              {itens.map((item, idx) => {
                const problemas = erros[item.uid] || [];
                const { item: it } = validarItem({ ...item, sazonal: item.sazonal ? 'Sim' : 'Não' });
                return (
                  <li key={item.uid} className={`cad-linha ${problemas.length ? 'cad-linha--erro' : ''}`} style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}>
                    <div className="cad-linha__corpo">
                      <strong>{it.descricao || item.descricao || '(sem descrição)'}</strong>
                      <span>{[it.familia ? nomeFamiliaOmie(it) : item.familia, `NCM ${ncmBonito(it.ncm)}`, it.entraNaLoja === null ? 'loja ?' : it.entraNaLoja ? 'entra na loja' : 'só estoque'].filter(Boolean).join(' · ')}</span>
                      {problemas.map((p) => <em key={p} className="cad-linha__problema">{p}</em>)}
                    </div>
                    <div className="cad-linha__lado">
                      {item.linhaPlanilha && <small>linha {item.linhaPlanilha}</small>}
                      {problemas.length === 0 && !validando && <span className="cad-ok" aria-label="Conferido">✓</span>}
                      <button type="button" className="cad-x" onClick={() => remover(item.uid)} aria-label={`Remover ${item.descricao}`}>×</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {itens.length > 0 && (
            <div className="cad-rodape">
              <span aria-live="polite">{validando ? 'Conferindo…' : totalErros ? `${totalErros} item(ns) com problema (não serão enviados)` : 'Tudo conferido.'}{!validando && totalErros > 0 && <> <button type="button" className="cad-link" onClick={removerComProblema}>Remover da lista</button></>}</span>
              <button type="button" className="b-btn" onClick={cadastrar} disabled={validando || itens.length === totalErros}>
                Cadastrar {itens.length - totalErros} produto{itens.length - totalErros === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Progresso */}
      {exec && (
        <section className="b-card cad-secao fade-in" aria-labelledby="cad-progresso-titulo">
          <div className="cad-secao__topo">
            <h3 id="cad-progresso-titulo" className="brand-font">{exec.rodando ? 'Cadastrando…' : comErroExec ? 'Concluído com pendências' : 'Tudo cadastrado ✓'}</h3>
            {!exec.rodando && <button type="button" className="b-btn-ghost" onClick={copiarCodigos}>Copiar códigos</button>}
          </div>
          <div className="cad-barra" role="progressbar" aria-valuemin={0} aria-valuemax={totalExec} aria-valuenow={feitos} aria-label="Progresso do cadastro">
            <span style={{ width: `${totalExec ? (feitos / totalExec) * 100 : 5}%` }} />
          </div>
          <p className="cad-progresso-texto" aria-live="polite">{feitos} de {totalExec || '…'} concluídos{comErroExec ? ` · ${comErroExec} com erro` : ''}</p>

          {totalExec === 0 ? <Esqueleto /> : (
            <ul className="cad-lista">
              {exec.itens.map((i) => (
                <li key={i.id} className="cad-linha cad-linha--exec">
                  <div className="cad-linha__corpo">
                    <strong>{i.codigo ? <span className="cad-codigo">{i.codigo}</span> : null} {i.descricao}</strong>
                    <span>{i.familia_omie} · {i.entra_na_loja ? 'entra na loja' : 'só estoque'}</span>
                    {i.omie_erro && <em className="cad-linha__problema">Omie: {i.omie_erro}</em>}
                    {i.nexaas_erro && <em className="cad-linha__problema">Nexaas: {i.nexaas_erro}</em>}
                  </div>
                  <div className="cad-linha__status">
                    <div><small>Omie</small><Chip status={i.omie_status} /></div>
                    <div><small>Nexaas</small>{i.omie_status === 'erro' ? <span className="cad-chip cad-chip--espera">—</span> : <Chip status={i.nexaas_status} />}</div>
                    {!bloqueadoPelaTela && i.omie_status === 'erro' && <button type="button" className="b-btn-outline cad-mini" onClick={() => tentarNovamente(i.id)}>Tentar novamente</button>}
                    {!bloqueadoPelaTela && i.omie_status === 'ok' && i.nexaas_status === 'erro' && <button type="button" className="b-btn-outline cad-mini" onClick={() => tentarNovamente(i.id)}>Tentar só o Nexaas</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!exec.rodando && (
            <div className="cad-rodape">
              <span>{exec.bloqueados ? `${exec.bloqueados} item(ns) ficaram de fora e continuam na lista para correção.` : ''}</span>
              <button type="button" className="b-btn" onClick={novoCadastro}>Novo cadastro</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
