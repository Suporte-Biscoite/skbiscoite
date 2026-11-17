import { useCallback, useEffect, useRef, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';
import NcmPainel from './NcmPainel.jsx';

const STATUS = {
  recebida: ['Recebida', 'espera'],
  aguardando_analise: ['Aguardando análise', 'andando'],
  aprovada: ['Aprovada', 'ok'],
  na_fila: ['Na fila', 'espera'],
  processando: ['Criando', 'andando'],
  concluida: ['Códigos gerados', 'ok'],
  finalizada_clickup: ['Finalizada no ClickUp', 'ok'],
  cancelada_clickup: ['Cancelada no ClickUp', 'erro'],
  recusada: ['Recusada', 'erro'],
  erro: ['Erro', 'erro'],
};
const SUGESTAO = { automatica: ['Pequena e limpa', 'ok'], analise: ['Precisa de análise', 'andando'] };
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const editavel = (s) => ['recebida', 'aguardando_analise'].includes(s.status);
// Pode preencher NCM/loja e criar: em análise, ou aprovada que ainda não foi para a fila (nada criado).
const podeCriarAgora = (s) => editavel(s) || (s.status === 'aprovada' && !s.lote_id);
const ICONE = { ok: '✓', andando: '…', erro: '!', pendente: '○', desligado: '–' };
const PREFIXOS_LOJA = ['300', '400']; // mesma regra do cadastro: só 300/400 entram na loja
// NCM mostrado: o digitado/salvo; se estiver vazio ou for só o padrão da família, a sugestão lida da nota tem preferência.
const ncmInicial = (i, ncmPadrao) => {
  const so = (v) => String(v ?? '').replace(/[^0-9]/g, '');
  const base = so(i.ncm);
  return i.ncm_sugerido && (!base || base === so(ncmPadrao)) ? i.ncm_sugerido : i.ncm || ncmPadrao || '';
};
const comPadroes = (lista, prefixo, ncmPadrao) => lista.map((i) => ({ ...i, ncm: ncmInicial(i, ncmPadrao), ncm_padrao_da_familia: ncmPadrao || null, entra_na_loja: i.entra_na_loja ?? PREFIXOS_LOJA.includes(String(prefixo)) }));

function Chip({ par }) {
  const [texto, tom] = par || ['—', 'espera'];
  return <span className={`cad-chip cad-chip--${tom}`}>{texto}</span>;
}

export default function Solicitacoes({ api, exibirToast }) {
  const [lista, setLista] = useState(null);
  const [config, setConfig] = useState(null);
  const [filtros, setFiltros] = useState({ status: '', sugestao: '', busca: '' });
  const [aberta, setAberta] = useState(null); // detalhe da solicitação aberta
  const [itens, setItens] = useState([]);
  const [faixa, setFaixa] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const carregar = useCallback(async () => {
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      const dados = await api(`/api/solicitacoes${q ? `?${q}` : ''}`);
      if (vivo.current) { setLista(dados); setErro(''); }
    } catch (e) { if (vivo.current) { setErro(e.message); setLista([]); } }
  }, [api, filtros]);
  useEffect(() => { const t = setTimeout(carregar, filtros.busca ? 350 : 0); return () => clearTimeout(t); }, [carregar, filtros.busca]);
  // Consulta o ClickUp ao abrir a tela e a cada 2 minutos (tarefas movidas para finalizado saem da fila sozinhas).
  useEffect(() => {
    let parou = false;
    const buscar = async () => {
      try {
        const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'conferir' } });
        if (!parou && vivo.current && (r.novas || r.atualizadas || r.encerradas)) carregar();
      } catch { /* o botão "Buscar no ClickUp" mostra o erro */ }
    };
    buscar();
    const t = setInterval(buscar, 120000);
    return () => { parou = true; clearInterval(t); };
  }, [api, carregar]);
  useEffect(() => { api('/api/solicitacoes?config=1').then((c) => vivo.current && setConfig(c)).catch(() => {}); }, [api]);

  const abrir = async (id) => {
    setOcupado('abrindo');
    try {
      const d = await api(`/api/solicitacoes?id=${id}`);
      setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); setFaixa(d.prefixo_codigo || ''); setRecusando(false); setMotivo('');
    } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(''); }
  };
  const fechar = () => { setAberta(null); carregar(); };

  const acao = async (nome, corpo, mensagem) => {
    setOcupado(nome);
    try {
      const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: nome, id: aberta?.id, ...corpo } });
      if (mensagem) exibirToast(mensagem);
      return r;
    } catch (e) { exibirToast(e.message, 'erro'); return null; } finally { setOcupado(''); }
  };

  const salvar = async () => {
    const d = await acao('editar', { itens, prefixoCodigo: faixa || undefined }, 'Itens salvos.');
    if (d) { setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); }
  };
  // Aprovar usa o que está na tela: se houve mudança, salva antes (assim o que foi aprovado é o que o time viu).
  const aprovar = async () => {
    const validos = itens.filter((i) => i.incluido !== false && i.descricao.trim());
    const sem = validos.filter((i) => String(i.ncm || '').replace(/\D/g, '').length !== 8).length;
    if (sem) { exibirToast(sem === 1 ? 'Falta o NCM (8 números) de 1 produto.' : 'Faltam os NCMs (8 números) de ' + sem + ' produtos.', 'erro'); return; }
    if (!window.confirm('Aprovar vai CRIAR ' + validos.length + ' produto(s) no Omie e no Nexaas e comentar os códigos na tarefa do ClickUp. Continuar?')) return;
    const salvo = await acao('editar', { itens, prefixoCodigo: faixa || undefined });
    if (!salvo) return;
    const d = await acao('aprovar', {}, 'Aprovada: criando os códigos.');
    if (d) { setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); }
  };
  const lerNota = async () => {
    const d = await acao('ler-nota', {});
    if (!d) return;
    setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia));
    const l = d.leitura || {};
    exibirToast(l.achados + ' de ' + l.total + ' NCM(s) encontrados na nota.' + (l.erroIA ? ' A IA não respondeu: ' + l.erroIA : ''), l.achados === l.total ? undefined : 'erro');
  };
  const tentarDeNovo = async (etapa) => {
    const d = await acao('tentar-de-novo', { etapa }, 'Tentando de novo.');
    if (d) { setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); }
  };
  const recusar = async () => {
    const d = await acao('recusar', { motivo }, 'Solicitação recusada.');
    if (d) { setAberta(d); setRecusando(false); }
  };
  const reanalisar = async () => {
    const d = await acao('reanalisar', {}, 'Tarefa lida de novo no ClickUp.');
    if (d) { setAberta(d); setItens(d.itens); setFaixa(d.prefixo_codigo || ''); }
  };
  const conferir = async () => {
    const r = await acao('conferir', {});
    if (r) { exibirToast(`${r.lidas} tarefa(s) lidas: ${r.novas} nova(s), ${r.atualizadas} atualizada(s), ${r.encerradas ?? 0} encerrada(s).`); carregar(); }
  };
  const mudarConfig = async (mudanca) => {
    try { setConfig({ ...config, ...(await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'config', ...mudanca } })) }); } catch (e) { exibirToast(e.message, 'erro'); }
  };

  // Enquanto estiver na fila / criando e sem erro, continua a criação de poucos em poucos segundos.
  const idAberta = aberta?.id;
  const emAndamento = !!aberta && ['na_fila', 'processando'].includes(aberta.status) && !(aberta.etapas || []).some((e) => e.estado === 'erro');
  useEffect(() => {
    if (!emAndamento) return undefined;
    let parou = false;
    const t = setTimeout(async () => {
      try {
        const d = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'avancar', id: idAberta } });
        if (!parou && vivo.current) { setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); }
      } catch (e) { if (!parou && vivo.current) exibirToast(e.message, 'erro'); }
    }, 1500);
    return () => { parou = true; clearTimeout(t); };
  }, [emAndamento, idAberta, aberta, api, exibirToast]);

  const mudarItem = (idx, mudanca) => setItens((l) => l.map((i, k) => (k === idx ? { ...i, ...mudanca } : i)));

  // ---------- Detalhe ----------
  if (aberta) {
    const podeEditar = editavel(aberta);
    const podeCriar = podeCriarAgora(aberta);
    const incluidos = itens.filter((i) => i.incluido !== false && i.descricao.trim()).length;
    return (
      <div className="cad sol">
        <section className="b-card cad-secao fade-in">
          <div className="cad-secao__topo">
            <button type="button" className="b-btn-ghost" onClick={fechar}>← Voltar</button>
            <div className="cad-linha__lado">
              <Chip par={STATUS[aberta.status]} /> <Chip par={SUGESTAO[aberta.sugestao]} />
            </div>
          </div>
          <h3 className="brand-font sol-titulo">{aberta.titulo}</h3>
          <p className="sol-meta">
            {aberta.solicitante && <>Solicitante: <strong>{aberta.solicitante}</strong> · </>}Recebida em {quando(aberta.recebido_em)} ·{' '}
            <a href={aberta.url} target="_blank" rel="noreferrer">Abrir no ClickUp ↗</a>
          </p>
          <dl className="cad-previa sol-previa">
            <div><dt>Família (campo)</dt><dd>{aberta.familia_campo || '—'}</dd></div>
            <div><dt>Faixa de código</dt><dd>{podeEditar ? <input className="b-input sol-faixa" inputMode="numeric" value={faixa} maxLength={4} onChange={(e) => setFaixa(e.target.value.replace(/\D/g, ''))} aria-label="Faixa de código" /> : aberta.prefixo_codigo || '—'}</dd></div>
            <div><dt>Tipo de identificação</dt><dd>{aberta.tipo_identificacao || '—'}</dd></div>
            <div><dt>Destino</dt><dd>{aberta.rota === 'importar' ? 'Importar do Omie' : 'Criar código novo'}</dd></div>
          </dl>
          {(aberta.motivos || []).length > 0 && (
            <div className="sol-motivos" role="note">
              <strong>Por que precisa de atenção</strong>
              <ul>{aberta.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {aberta.motivo_recusa && <div className="cad-erro" role="note">Recusada por {aberta.decidido_por}: {aberta.motivo_recusa}</div>}
        </section>

        <section className="b-card cad-secao fade-in" aria-labelledby="sol-itens">
          <div className="cad-secao__topo">
            <h3 id="sol-itens" className="brand-font">Produtos lidos <span className="cad-contagem">{incluidos}</span></h3>
            {podeEditar && <button type="button" className="b-btn-ghost" onClick={() => setItens((l) => [...l, { descricao: '', incluido: true, avisos: [], parecidos: [] }])}>+ Adicionar linha</button>}
          </div>
          {itens.length === 0 ? <p className="cad-vazio">Nenhum produto foi lido nesta tarefa.</p> : (
            <ul className="cad-lista">
              {itens.map((i, k) => (
                <li key={i.id ?? `n${k}`} className={`cad-linha sol-item ${(i.avisos || []).length ? 'cad-linha--erro' : ''}`}>
                  <div className="cad-linha__corpo">
                    {podeEditar ? (
                      <input className="b-input" value={i.descricao} maxLength={140} aria-label={`Nome do produto ${k + 1}`} onChange={(e) => mudarItem(k, { descricao: e.target.value.toUpperCase() })} />
                    ) : <strong>{i.descricao}</strong>}
                    {(i.avisos || []).map((a) => <em key={a} className="cad-linha__problema">{a}</em>)}
                    {i.codigo_gerado && <span>Código: <strong>{i.codigo_gerado}</strong></span>}
                    {podeCriar && (
                      <div className="sol-criacao">
                        <label>NCM <input className="b-input sol-ncm" inputMode="numeric" maxLength={10} value={i.ncm ?? ''} placeholder={i.ncm_padrao_da_familia ? undefined : 'da nota, 8 números'} aria-label={'NCM do produto ' + (k + 1)} onChange={(e) => mudarItem(k, { ncm: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                        {i.ncm_sugerido && <span className="sol-meta">Da nota: {i.ncm_fonte}</span>}
                        {!i.ncm_sugerido && i.ncm_fonte && <span className="sol-meta">Nota: {i.ncm_fonte}</span>}
                        {i.ncm_padrao_da_familia && String(i.ncm).replace(/[^0-9]/g, '') === i.ncm_padrao_da_familia && <span className="sol-meta">NCM padrão da família: será marcado para revisão.</span>}
                        <label className="sol-incluir"><input type="checkbox" checked={!!i.entra_na_loja} onChange={(e) => mudarItem(k, { entra_na_loja: e.target.checked })} /> Entra na loja (PDV)</label>
                      </div>
                    )}
                  </div>
                  {podeEditar && (
                    <div className="cad-linha__lado">
                      <label className="sol-incluir"><input type="checkbox" checked={i.incluido !== false} onChange={(e) => mudarItem(k, { incluido: e.target.checked })} /> Incluir</label>
                      <button type="button" className="cad-x" aria-label={`Remover ${i.descricao}`} onClick={() => setItens((l) => l.filter((_, x) => x !== k))}>×</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {podeCriar && (
            <>
              {recusando ? (
                <div className="sol-recusa fade-in">
                  <label htmlFor="sol-motivo">Motivo da recusa</label>
                  <textarea id="sol-motivo" className="b-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: separar por tipo de produto e reenviar" />
                  <div className="sol-botoes">
                    <button type="button" className="b-btn-ghost" onClick={() => setRecusando(false)}>Cancelar</button>
                    <button type="button" className="b-btn" onClick={recusar} disabled={!motivo.trim() || !!ocupado}>Confirmar recusa</button>
                  </div>
                </div>
              ) : (
                <div className="cad-rodape sol-botoes">
                  <span>Aprovar autoriza a criação deste pedido no Omie e no Nexaas (o código sai em sequência na família {faixa || aberta.prefixo_codigo}). O modo "Só analisar" e a pausa travam apenas a criação automática.</span>
                  <div className="sol-botoes">
                    <button type="button" className="b-btn-outline cad-mini" onClick={reanalisar} disabled={!!ocupado}>Ler de novo</button>
                    <button type="button" className="b-btn-outline cad-mini" onClick={salvar} disabled={!!ocupado}>Salvar edição</button>
                    <button type="button" className="b-btn-outline cad-mini" onClick={lerNota} disabled={!!ocupado} title="Lê o PDF da nota fiscal anexado na tarefa e sugere o NCM de cada produto">{ocupado === 'ler-nota' ? 'Lendo a nota…' : 'Ler NCM da nota (PDF)'}</button>
                    {podeEditar && <button type="button" className="b-btn-outline cad-mini" onClick={() => setRecusando(true)} disabled={!!ocupado}>Recusar</button>}
                    <button type="button" className="b-btn" onClick={aprovar} disabled={!!ocupado || incluidos === 0}>{ocupado === 'aprovar' || ocupado === 'editar' ? 'Criando…' : 'Aprovar e criar códigos'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {aberta.lote_id && (
          <section className="b-card cad-secao fade-in" aria-labelledby="sol-etapas">
            <h3 id="sol-etapas" className="brand-font">Andamento</h3>
            <ol className="sol-etapas">
              {(aberta.etapas || []).map((e) => (
                <li key={e.chave} className={'sol-etapa sol-etapa--' + e.estado}>
                  <span className="sol-etapa__icone" aria-hidden="true">{ICONE[e.estado]}</span>
                  <div className="sol-etapa__corpo">
                    <strong>{e.rotulo}</strong>
                    <span>{e.estado === 'ok' ? quando(e.quando) : e.estado === 'andando' ? 'Em andamento…' : e.estado === 'desligado' ? 'Desligado' : e.estado === 'erro' ? 'Falhou' : 'Aguardando'}</span>
                    {e.erro && <em className="cad-linha__problema">{e.erro}</em>}
                  </div>
                  {e.estado === 'erro' && <button type="button" className="b-btn-outline cad-mini" onClick={() => tentarDeNovo(e.chave)} disabled={!!ocupado}>Tentar de novo</button>}
                </li>
              ))}
            </ol>
            {(aberta.itens || []).some((i) => i.codigo_gerado) && <p className="sol-meta">Códigos: {aberta.itens.filter((i) => i.codigo_gerado).map((i) => i.codigo_gerado + ' - ' + i.descricao).join(' · ')}</p>}
          </section>
        )}

        {(aberta.historico || []).length > 0 && (
          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Histórico</h3>
            <ul className="sol-historico">
              {aberta.historico.map((h, k) => <li key={k}><strong>{h.acao}</strong> · {h.usuario} · {quando(h.em)}</li>)}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ---------- Lista ----------
  return (
    <div className="cad sol">
      <section className="b-card cad-secao fade-in">
        <div className="cad-secao__topo">
          <h3 className="brand-font">Solicitações do ClickUp</h3>
          <button type="button" className="b-btn-ghost" onClick={conferir} disabled={!!ocupado}>{ocupado === 'conferir' ? 'Buscando…' : 'Buscar no ClickUp'}</button>
        </div>
        {config && (
          <div className="sol-config">
            <span className="cad-chip cad-chip--andando" title="Nesta fase nenhum código é criado automaticamente">
              {config.modo === 'simulacao' ? 'Modo simulação' : 'Só analisar'}
            </span>
            <label className="cad-switch">
              <input type="checkbox" role="switch" checked={!!config.pausado} onChange={(e) => mudarConfig({ pausado: e.target.checked })} />
              <span className="cad-switch__trilho" aria-hidden="true" />
              Criação automática pausada
            </label>
            <label className="sol-modo">Modo
              <select className="b-input" value={config.modo} onChange={(e) => mudarConfig({ modo: e.target.value })}>
                <option value="analisar">Só analisar</option>
                <option value="simulacao">Simulação</option>
                <option value="automatico" disabled>Automático (Fase 2)</option>
              </select>
            </label>
          </div>
        )}
        {config && !config.clickupConfigurado && (
          <div className="cad-erro" role="note">O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN): o botão "Buscar no ClickUp" e "Ler de novo" ficam indisponíveis. Eventos do webhook também precisam dele para ler a tarefa.</div>
        )}
        <div className="sol-filtros">
          <input className="b-input" type="search" placeholder="Buscar por título ou solicitante" aria-label="Buscar" value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
          <select className="b-input" aria-label="Status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
            <option value="">Em aberto (sem as encerradas)</option>
            {Object.entries(STATUS).filter(([v]) => !['finalizada_clickup', 'cancelada_clickup', 'concluida'].includes(v)).map(([v, [t]]) => <option key={v} value={v}>{t}</option>)}
            <option value="encerradas">Encerradas (finalizadas / com códigos)</option>
          </select>
          <select className="b-input" aria-label="Sugestão" value={filtros.sugestao} onChange={(e) => setFiltros({ ...filtros, sugestao: e.target.value })}>
            <option value="">Qualquer leitura</option>
            <option value="automatica">Pequena e limpa</option>
            <option value="analise">Precisa de análise</option>
          </select>
        </div>
      </section>

      <section className="b-card cad-secao fade-in" aria-live="polite">
        {erro && <div className="cad-erro" role="alert">{erro}</div>}
        {lista === null ? (
          <div className="cad-esqueleto" aria-label="Carregando"><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /></div>
        ) : lista.length === 0 ? (
          <p className="cad-vazio">Nenhuma solicitação por aqui ainda. Quando alguém abrir uma tarefa no formulário de cadastro, ela aparece sozinha.</p>
        ) : (
          <ul className="cad-lista">
            {lista.map((s) => (
              <li key={s.id}>
                <button type="button" className="cad-linha sol-card" onClick={() => abrir(s.id)} disabled={ocupado === 'abrindo'}>
                  <div className="cad-linha__corpo">
                    <strong>{s.titulo}</strong>
                    <span>{[s.solicitante, `${s.itens} produto${Number(s.itens) === 1 ? '' : 's'}`, s.prefixo_codigo && `faixa ${s.prefixo_codigo}`, s.status_clickup && `ClickUp: ${s.status_clickup}`, quando(s.recebido_em), s.origem === 'teste' ? 'TESTE' : ''].filter(Boolean).join(' · ')}</span>
                    {s.sugestao === 'analise' && (s.motivos || [])[0] && <em className="cad-linha__problema">{s.motivos[0]}</em>}
                  </div>
                  <div className="cad-linha__lado"><Chip par={STATUS[s.status]} /> <Chip par={SUGESTAO[s.sugestao]} /></div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NcmPainel api={api} exibirToast={exibirToast} />
    </div>
  );
}
