import { useCallback, useEffect, useRef, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';
import NcmPainel from './NcmPainel.jsx';

const STATUS = {
  recebida: ['Recebida', 'espera'],
  aguardando_analise: ['Para revisar', 'andando'],
  aprovada: ['Aprovada', 'ok'],
  na_fila: ['Na fila para criar', 'espera'],
  processando: ['Criando códigos', 'andando'],
  concluida: ['Códigos criados', 'ok'],
  finalizada_clickup: ['Finalizada no ClickUp', 'ok'],
  cancelada_clickup: ['Cancelada no ClickUp', 'erro'],
  recusada: ['Recusada', 'erro'],
  erro: ['Erro', 'erro'],
};
const SUGESTAO = { automatica: ['Sem alertas', 'ok'], analise: ['Precisa de atenção', 'andando'] };
const ehAlteracao = (s) => s?.rota === 'alteracao';
// Em "Outras tarefas" o vocabulário é outro: não há código a criar, só um pedido para tratar.
const parDoStatus = (s) => {
  if (ehAlteracao(s) && ['aguardando_analise', 'recebida'].includes(s.status)) return ['Para tratar', 'andando'];
  if (ehAlteracao(s) && s.status === 'recusada') return ['Dispensada', 'espera'];
  return STATUS[s.status];
};
const parDaLeitura = (s) => (ehAlteracao(s) ? null : SUGESTAO[s.sugestao]);
// Passos que o time acompanha: 1 revisar -> 2 aprovar -> 3 criar -> 4 avisar no ClickUp.
const PASSOS = ['Revisar o pedido', 'Aprovar', 'Criar os códigos', 'Avisar no ClickUp'];
const passoAtual = (s) => {
  if (['aguardando_analise', 'recebida'].includes(s.status)) return 0;
  if (['aprovada', 'na_fila'].includes(s.status)) return 1;
  if (s.status === 'processando') return 2;
  if (['concluida', 'finalizada_clickup'].includes(s.status)) return 4;
  return -1;
};
const proximoPasso = (s) => {
  if (ehAlteracao(s)) {
    if (['aguardando_analise', 'recebida'].includes(s.status)) return 'Este pedido é uma alteração, não um produto novo. Por enquanto resolva direto no ClickUp; depois use "Dispensar" para tirá-lo da lista. Esta área ainda será desenvolvida.';
    return '';
  }
  switch (s.status) {
    case 'aguardando_analise': case 'recebida':
      return s.sugestao === 'automatica' ? 'Confira os nomes e o NCM e clique em "Aprovar e criar códigos".' : 'Leia os avisos abaixo, corrija o que for preciso e aprove — ou recuse se o pedido estiver errado.';
    case 'aprovada': case 'na_fila': return 'Aprovada. O sistema está criando os códigos (pode levar alguns minutos).';
    case 'processando': return 'Criando os códigos no Omie e no Nexaas. Não precisa fazer nada.';
    case 'concluida': return 'Pronto: os códigos foram criados e avisados na tarefa do ClickUp.';
    case 'recusada': return 'Esta solicitação foi recusada e não gerou códigos.';
    default: return '';
  }
};
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const editavel = (s) => ['recebida', 'aguardando_analise'].includes(s.status);
// Pode preencher NCM/loja e criar: em análise, ou aprovada que ainda não foi para a fila (nada criado).
const podeCriarAgora = (s) => editavel(s) || (s.status === 'aprovada' && !s.lote_id);
const ICONE = { ok: '✓', andando: '…', erro: '!', pendente: '○', desligado: '–' };
const NOMES_FAMILIA = { 200: 'EMBALAGEM (200)', 300: 'EXTERNO (300)', 400: 'INTERNO (400)', 500: 'KITS (500)', 700: 'SUPRIMENTOS (700)', 800: 'ATIVO (800)', 1010: 'ENVASE E MATÉRIA-PRIMA (1010)' };
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

function Passos({ s }) {
  if (ehAlteracao(s)) return null;
  const atual = passoAtual(s);
  if (atual < 0) return null;
  return (
    <ol className="sol-passos" aria-label="Etapas da solicitação">
      {PASSOS.map((p, k) => (
        <li key={p} className={'sol-passo' + (k < atual ? ' sol-passo--feito' : k === atual ? ' sol-passo--atual' : '')} aria-current={k === atual ? 'step' : undefined}>
          <span className="sol-passo__num" aria-hidden="true">{k < atual ? '✓' : k + 1}</span>
          <span>{p}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Solicitacoes({ api, exibirToast, aoAbrirAjuda }) {
  const [lista, setLista] = useState(null);
  const [config, setConfig] = useState(null);
  const [filtros, setFiltros] = useState({ status: '', sugestao: '', busca: '', tipo: 'cadastro' });
  const [contagem, setContagem] = useState({ cadastro: 0, tarefas: 0 });
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
      api('/api/solicitacoes?contagem=1').then((c) => vivo.current && setContagem(c)).catch(() => {});
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
  const conferirFamiliaIA = async () => {
    const salvo = await acao('editar', { itens, prefixoCodigo: faixa || undefined });
    if (!salvo) return;
    const d = await acao('conferir-familia', {}, 'A IA conferiu a família dos produtos.');
    if (d) { setAberta(d); setItens(comPadroes(d.itens, d.prefixo_codigo, d.ncmPadraoDaFamilia)); }
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
    if (mudanca.modo === 'automatico' && !window.confirm('Modo AUTOMÁTICO: pedidos pequenos e sem alerta, aprovados pela IA, serão CRIADOS sozinhos no Omie e no Nexaas e comentados no ClickUp. Os demais continuam para análise. Ligar?')) return;
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
    const alteracao = ehAlteracao(aberta);
    const podeCriar = podeCriarAgora(aberta) && !alteracao;
    const dica = proximoPasso(aberta);
    const incluidos = itens.filter((i) => i.incluido !== false && i.descricao.trim()).length;
    return (
      <div className="cad sol">
        <section className="b-card cad-secao fade-in">
          <div className="cad-secao__topo">
            <button type="button" className="b-btn-ghost" onClick={fechar}>← Voltar</button>
            <div className="cad-linha__lado">
              <Chip par={parDoStatus(aberta)} /> {parDaLeitura(aberta) && <Chip par={parDaLeitura(aberta)} />}
            </div>
          </div>
          <Passos s={aberta} />
          {dica && <p className="sol-dica" role="note"><strong>O que fazer agora:</strong> {dica}</p>}
          <h3 className="brand-font sol-titulo">{aberta.titulo}</h3>
          <p className="sol-meta">
            {aberta.solicitante && <>Solicitante: <strong>{aberta.solicitante}</strong> · </>}Recebida em {quando(aberta.recebido_em)} ·{' '}
            <a href={aberta.url} target="_blank" rel="noreferrer">Abrir no ClickUp ↗</a>
          </p>
          <dl className="cad-previa sol-previa">
            <div><dt>Família escolhida no formulário</dt><dd>{aberta.familia_campo || '—'}</dd></div>
            <div><dt>Código da família</dt><dd>{podeEditar ? <input className="b-input sol-faixa" inputMode="numeric" value={faixa} maxLength={4} onChange={(e) => setFaixa(e.target.value.replace(/\D/g, ''))} aria-label="Faixa de código" /> : aberta.prefixo_codigo || '—'}</dd></div>
            <div><dt>Tipo de identificação</dt><dd>{aberta.tipo_identificacao || '—'}</dd></div>
            <div><dt>Tipo do pedido</dt><dd>{alteracao ? 'Alteração (não cria código)' : aberta.rota === 'importar' ? 'Produto já existe: usar "Importar do Omie"' : 'Produto novo (cria código)'}</dd></div>
          </dl>
          {aberta.auto_motivo && <div className="sol-motivos" role="note"><strong>Criação automática</strong><ul><li>{aberta.auto_motivo}</li></ul></div>}
          {podeCriar && (aberta.ia_familia?.itens || []).some((x) => x.diverge) && (() => {
            const div = aberta.ia_familia.itens.filter((x) => x.diverge);
            const sugeridas = [...new Set(div.map((x) => x.prefixo))];
            return (
              <div className="sol-motivos sol-ia" role="note">
                <strong>A IA estranhou a família deste pedido</strong>
                <ul>{div.map((x) => <li key={x.descricao}><strong>{x.descricao}</strong> parece ser {NOMES_FAMILIA[x.prefixo] || x.prefixo}{x.motivo ? ': ' + x.motivo : ''}</li>)}</ul>
                {sugeridas.length === 1 && String(faixa) !== sugeridas[0] && (
                  <button type="button" className="b-btn-outline cad-mini" onClick={() => { setFaixa(sugeridas[0]); exibirToast('Família trocada para ' + sugeridas[0] + '. Ela vale ao aprovar.'); }}>Usar família {NOMES_FAMILIA[sugeridas[0]] || sugeridas[0]}</button>
                )}
              </div>
            );
          })()}
          {(aberta.motivos || []).length > 0 && (
            <div className="sol-motivos" role="note">
              <strong>{alteracao ? 'Sobre este pedido' : 'Atenção: o que o sistema encontrou'}</strong>
              <ul>{aberta.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {aberta.motivo_recusa && <div className="cad-erro" role="note">Recusada por {aberta.decidido_por}: {aberta.motivo_recusa}</div>}
        </section>

        <section className="b-card cad-secao fade-in" aria-labelledby="sol-itens">
          <div className="cad-secao__topo">
            <h3 id="sol-itens" className="brand-font">{alteracao ? 'Linhas do pedido' : 'Produtos lidos'} <span className="cad-contagem">{incluidos}</span></h3>
            {podeEditar && <button type="button" className="b-btn-ghost" onClick={() => setItens((l) => [...l, { descricao: '', incluido: true, avisos: [], parecidos: [] }])}>+ Adicionar linha</button>}
          </div>
          {itens.length === 0 ? <p className="cad-vazio">{alteracao ? 'Nenhuma linha foi lida. Veja o texto completo no ClickUp.' : 'Nenhum produto foi lido nesta tarefa. Use "+ Adicionar linha" para digitar o nome.'}</p> : (
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

          {alteracao && podeEditar && (
            <div className="cad-rodape sol-botoes">
              <span>Esta área ainda está em desenvolvimento: o sistema só separa e mostra estes pedidos. Resolva no ClickUp e depois dispense aqui.</span>
              <div className="sol-botoes">
                <a className="b-btn-outline cad-mini" href={aberta.url} target="_blank" rel="noreferrer">Abrir no ClickUp ↗</a>
                <button type="button" className="b-btn" disabled={!!ocupado} onClick={async () => {
                  if (!window.confirm('Dispensar tira este pedido da lista. Ele não cria nenhum código. Continuar?')) return;
                  const d = await acao('recusar', { motivo: 'Alteração tratada fora do sistema (área ainda em desenvolvimento).' }, 'Pedido dispensado.');
                  if (d) setAberta(d);
                }}>Dispensar</button>
              </div>
            </div>
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
                    <button type="button" className="b-btn-outline cad-mini" onClick={conferirFamiliaIA} disabled={!!ocupado} title="A IA confere se cada produto combina com a família escolhida (ex.: um móvel não é suprimento)">{ocupado === 'conferir-familia' ? 'A IA está conferindo…' : 'Conferir família com a IA'}</button>
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
  const naTarefas = filtros.tipo === 'tarefas';
  const trocarTipo = (tipo) => { setLista(null); setFiltros({ status: '', sugestao: '', busca: '', tipo }); };
  const modoTexto = config ? (config.modo === 'simulacao' ? 'Simulação' : config.modo === 'automatico' ? (config.pausado ? 'Automático pausado' : 'Automático ligado') : 'Desligada') : '';
  return (
    <div className="cad sol">
      <section className="b-card cad-secao fade-in">
        <div className="cad-secao__topo">
          <div>
            <h3 className="brand-font">Pedidos que chegam do ClickUp</h3>
            <p className="sol-meta sol-meta--sem-margem">O sistema lê os pedidos do formulário. Você revisa e aprova; ao aprovar, ele cria os códigos e avisa na tarefa.{aoAbrirAjuda && <> <button type="button" className="sol-link" onClick={aoAbrirAjuda}>Como funciona?</button></>}</p>
          </div>
          <button type="button" className="b-btn-outline cad-mini" onClick={conferir} disabled={!!ocupado} title="Os pedidos novos já chegam sozinhos. Use se achar que falta algum.">{ocupado === 'conferir' ? 'Buscando…' : 'Atualizar agora'}</button>
        </div>
        <div className="sol-abas" role="tablist" aria-label="Tipo de pedido">
          <button type="button" role="tab" aria-selected={!naTarefas} className={'sol-aba' + (!naTarefas ? ' sol-aba--ativa' : '')} onClick={() => trocarTipo('cadastro')}>Produtos novos <span className="cad-contagem">{contagem.cadastro}</span></button>
          <button type="button" role="tab" aria-selected={naTarefas} className={'sol-aba' + (naTarefas ? ' sol-aba--ativa' : '')} onClick={() => trocarTipo('tarefas')}>Outras tarefas <span className="cad-contagem">{contagem.tarefas}</span></button>
        </div>
        <p className="sol-meta sol-meta--sem-margem">{naTarefas ? 'Pedidos de alteração de nome, ativar ou inativar códigos. Não criam código novo. Esta área ainda será desenvolvida.' : 'Pedidos para criar código de produto novo.'}</p>
        {config && !naTarefas && (
          <details className="sol-auto">
            <summary>Criação automática: <strong>{modoTexto}</strong></summary>
            <div className="sol-config">
              <label className="sol-modo">Modo
                <select className="b-input" value={config.modo} onChange={(e) => mudarConfig({ modo: e.target.value })}>
                  <option value="analisar">Desligada: eu aprovo cada pedido</option>
                  <option value="simulacao">Simulação: só mostra o que seria criado</option>
                  <option value="automatico">Automática: cria sozinho os pedidos simples e sem alerta</option>
                </select>
              </label>
              <label className="cad-switch">
                <input type="checkbox" role="switch" checked={!!config.pausado} onChange={(e) => mudarConfig({ pausado: e.target.checked })} />
                <span className="cad-switch__trilho" aria-hidden="true" />
                Pausar a criação automática
              </label>
            </div>
            <p className="sol-meta sol-meta--sem-margem">Aprovar manualmente sempre funciona, em qualquer modo. Este controle só vale para a criação feita sozinha pelo sistema.</p>
          </details>
        )}
        {config && !config.clickupConfigurado && (
          <div className="cad-erro" role="note">O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN): o botão "Buscar no ClickUp" e "Ler de novo" ficam indisponíveis. Eventos do webhook também precisam dele para ler a tarefa.</div>
        )}
        <div className="sol-filtros">
          <input className="b-input" type="search" placeholder="Buscar por título ou nome de quem pediu" aria-label="Buscar" value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
          <select className="b-input" aria-label="Status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
            <option value="">Em aberto</option>
            {Object.entries(STATUS).filter(([v]) => !['finalizada_clickup', 'cancelada_clickup', 'concluida'].includes(v)).map(([v, [t]]) => <option key={v} value={v}>{t}</option>)}
            <option value="encerradas">Já resolvidas (códigos criados / finalizadas)</option>
          </select>
          {!naTarefas && (
            <select className="b-input" aria-label="Alertas" value={filtros.sugestao} onChange={(e) => setFiltros({ ...filtros, sugestao: e.target.value })}>
              <option value="">Com ou sem alertas</option>
              <option value="automatica">Só sem alertas</option>
              <option value="analise">Só com alertas</option>
            </select>
          )}
        </div>
      </section>

      <section className="b-card cad-secao fade-in" aria-live="polite">
        {erro && <div className="cad-erro" role="alert">{erro}</div>}
        {lista === null ? (
          <div className="cad-esqueleto" aria-label="Carregando"><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /></div>
        ) : lista.length === 0 ? (
          <p className="cad-vazio">{naTarefas ? 'Nenhum pedido de alteração em aberto.' : 'Nenhum pedido para revisar. Quando alguém abrir uma tarefa no formulário de cadastro, ela aparece aqui sozinha.'}</p>
        ) : (
          <ul className="cad-lista">
            {lista.map((s) => (
              <li key={s.id}>
                <button type="button" className="cad-linha sol-card" onClick={() => abrir(s.id)} disabled={ocupado === 'abrindo'}>
                  <div className="cad-linha__corpo">
                    <strong>{s.titulo}</strong>
                    <span>{[s.solicitante, `${s.itens} ${naTarefas ? 'linha' : 'produto'}${Number(s.itens) === 1 ? '' : 's'}`, !naTarefas && s.prefixo_codigo && `família ${s.prefixo_codigo}`, s.status_clickup && `ClickUp: ${s.status_clickup}`, quando(s.recebido_em), s.origem === 'teste' ? 'TESTE' : ''].filter(Boolean).join(' · ')}</span>
                    {s.sugestao === 'analise' && !naTarefas && (s.motivos || [])[0] && <em className="cad-linha__problema">{s.motivos[0]}</em>}
                    {s.auto_motivo && <em className="cad-linha__problema">Criação automática não fez: {s.auto_motivo}</em>}
                  </div>
                  <div className="cad-linha__lado"><Chip par={parDoStatus(s)} /> {parDaLeitura(s) && <Chip par={parDaLeitura(s)} />}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!naTarefas && <NcmPainel api={api} exibirToast={exibirToast} />}
    </div>
  );
}
