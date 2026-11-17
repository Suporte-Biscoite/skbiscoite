import { useEffect, useRef, useState } from 'react';

const FAMILIAS = [
  ['1010', 'Envase / insumos (1010)'],
  ['200', 'Embalagem (200)'],
  ['300', 'Externo / revenda (300)'],
  ['400', 'Interno / produtos prontos (400)'],
  ['500', 'Kits (500)'],
];
const soNumeros = (v) => String(v ?? '').replace(/[^0-9]/g, '');
const formatar = (v) => { const n = soNumeros(v); return n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n; };

// NCM padrão por família + lista de produtos criados com o padrão, para revisar (conferir ou corrigir).
export default function NcmPainel({ api, exibirToast }) {
  const [dados, setDados] = useState(null);
  const [padrao, setPadrao] = useState({});
  const [edicao, setEdicao] = useState({}); // itemId -> NCM digitado
  const [ocupado, setOcupado] = useState('');
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const [versao, setVersao] = useState(0);
  useEffect(() => {
    api('/api/solicitacoes?ncm=1').then((d) => { if (vivo.current) { setDados(d); setPadrao(d.padrao); } }).catch((e) => exibirToast(e.message, 'erro'));
  }, [api, exibirToast, versao]);

  const post = async (corpo, mensagem) => {
    try {
      const r = await api('/api/solicitacoes', { metodo: 'POST', corpo });
      if (mensagem) exibirToast(mensagem);
      return r;
    } catch (e) { exibirToast(e.message, 'erro'); return null; }
  };
  const salvarPadrao = async () => {
    setOcupado('padrao');
    const r = await post({ acao: 'ncm-padrao', padrao }, 'NCM padrão salvo.');
    if (r) setPadrao(r);
    setOcupado('');
  };
  const revisar = async (item) => {
    setOcupado(`item${item.id}`);
    const digitado = soNumeros(edicao[item.id] ?? item.ncm);
    const r = await post({ acao: 'ncm-revisar', itemId: item.id, ncm: digitado }, digitado === soNumeros(item.ncm) ? 'NCM conferido.' : 'NCM corrigido no Omie.');
    if (r?.avisoNexaas) exibirToast(r.avisoNexaas);
    setOcupado('');
    if (r) setVersao((v) => v + 1);
  };

  if (!dados) return null;
  return (
    <>
      <section className="b-card cad-secao fade-in" aria-labelledby="ncm-revisar">
        <div className="cad-secao__topo">
          <h3 id="ncm-revisar" className="brand-font">NCM para revisar <span className="cad-contagem">{dados.revisar.length}</span></h3>
        </div>
        <p className="sol-meta">Produtos criados com o NCM padrão da família. Confira o NCM (de acordo com a nota ou o cadastro fiscal): se estiver certo, clique em Conferido; se não, digite o correto e salve. A correção atualiza o Omie; o Nexaas precisa ser ajustado lá.</p>
        {dados.revisar.length === 0 ? <p className="cad-vazio">Nada para revisar.</p> : (
          <ul className="cad-lista">
            {dados.revisar.map((i) => (
              <li key={i.id} className="cad-linha sol-item">
                <div className="cad-linha__corpo">
                  <strong>{i.codigo} - {i.descricao}</strong>
                  <span><a href={i.url} target="_blank" rel="noreferrer">{i.titulo} ↗</a></span>
                  <div className="sol-criacao">
                    <label>NCM <input className="b-input sol-ncm" inputMode="numeric" maxLength={10} value={edicao[i.id] ?? formatar(i.ncm)} aria-label={`NCM de ${i.codigo}`} onChange={(e) => setEdicao({ ...edicao, [i.id]: e.target.value })} /></label>
                  </div>
                </div>
                <div className="cad-linha__lado">
                  <button type="button" className="b-btn-outline cad-mini" onClick={() => revisar(i)} disabled={!!ocupado}>
                    {soNumeros(edicao[i.id] ?? i.ncm) === soNumeros(i.ncm) ? 'Conferido' : 'Corrigir e salvar'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="b-card cad-secao fade-in" aria-labelledby="ncm-padrao">
        <div className="cad-secao__topo">
          <h3 id="ncm-padrao" className="brand-font">NCM padrão por família</h3>
          <button type="button" className="b-btn-outline cad-mini" onClick={salvarPadrao} disabled={!!ocupado}>Salvar</button>
        </div>
        <p className="sol-meta">Usado quando a solicitação é aprovada sem NCM. Suprimentos (700) e Ativos (800) não têm padrão: o NCM vem da nota do fornecedor.</p>
        <div className="sol-criacao">
          {FAMILIAS.map(([prefixo, nome]) => (
            <label key={prefixo}>{nome} <input className="b-input sol-ncm" inputMode="numeric" maxLength={10} value={formatar(padrao[prefixo])} onChange={(e) => setPadrao({ ...padrao, [prefixo]: soNumeros(e.target.value) })} /></label>
          ))}
        </div>
      </section>
    </>
  );
}
