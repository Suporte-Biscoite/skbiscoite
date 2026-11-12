import { useEffect, useRef, useState } from 'react';
import './Cadastro.css';

const POR_CHAMADA = 10; // poucos códigos por vez: a barra anda e nenhuma chamada fica longa
const ROTULO = {
  pronto: ['Pronto para importar', 'espera'],
  criado: ['Criado no Nexaas', 'ok'],
  ja_no_nexaas: ['Já está no Nexaas', 'ok'],
  erro: ['Não importado', 'erro'],
};

// Aceita um código por linha (ou separados por vírgula / ponto e vírgula). Espaço faz parte do código.
const lerCodigos = (texto) => [...new Set(texto.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean))];

function destino(i) {
  if (i.entraNaLoja === undefined) return '';
  return `${i.entraNaLoja ? 'entra na loja (PDV)' : 'só estoque'}${i.categoriaNexaas ? ` · categoria ${i.categoriaNexaas}` : ''}`;
}

export default function Importar({ api, exibirToast }) {
  const [texto, setTexto] = useState('');
  const [itens, setItens] = useState(null); // null = ainda não conferiu
  const [fase, setFase] = useState('ocioso'); // ocioso | conferindo | importando | concluido
  const [feitos, setFeitos] = useState(0);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const emAndamento = fase === 'conferindo' || fase === 'importando';
  useEffect(() => {
    if (!emAndamento) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [emAndamento]);

  const codigos = lerCodigos(texto);

  // Manda os códigos em blocos e vai juntando as respostas na lista (progresso ao vivo).
  const processar = async (acao, lista, aoChegar) => {
    for (let i = 0; i < lista.length; i += POR_CHAMADA) {
      const bloco = lista.slice(i, i + POR_CHAMADA);
      try {
        const r = await api('/api/importar', { metodo: 'POST', corpo: { acao, codigos: bloco } });
        if (!vivo.current) return false;
        aoChegar(r.itens);
      } catch (err) {
        exibirToast(err.message, 'erro');
        return false;
      }
      if (vivo.current) setFeitos(Math.min(i + POR_CHAMADA, lista.length));
    }
    return true;
  };

  const conferir = async (e) => {
    e?.preventDefault();
    if (codigos.length === 0) return;
    setItens([]); setFeitos(0); setFase('conferindo');
    const acumulado = [];
    const ok = await processar('analisar', codigos, (novos) => { acumulado.push(...novos); setItens([...acumulado]); });
    if (!vivo.current) return;
    setFase('ocioso');
    if (!ok && acumulado.length === 0) setItens(null);
  };

  const importar = async () => {
    const prontos = itens.filter((i) => i.estado === 'pronto').map((i) => i.codigo);
    if (prontos.length === 0) return;
    setFeitos(0); setFase('importando');
    const ok = await processar('importar', prontos, (novos) => {
      setItens((lista) => lista.map((i) => novos.find((n) => n.codigo === i.codigo) || i));
    });
    if (!vivo.current) return;
    setFase('concluido');
    if (ok) exibirToast('Importação finalizada.');
  };

  const nova = () => { setTexto(''); setItens(null); setFase('ocioso'); setFeitos(0); };

  const contar = (estado) => itens?.filter((i) => i.estado === estado).length ?? 0;
  const prontos = contar('pronto');
  const total = fase === 'importando' ? itens.filter((i) => i.estado === 'pronto' || i.estado === 'criado').length : codigos.length;

  return (
    <div className="cad">
      <section className="b-card cad-secao fade-in">
        <h3 className="brand-font">Importar do Omie para o Nexaas</h3>
        <p className="cad-ajuda">
          Digite os códigos de produtos que já existem no Omie. O sistema confere se já estão no Nexaas e cadastra os que faltam.
          Só os grupos <strong>300</strong> e <strong>400</strong> entram no PDV da loja; todos os outros ficam só no estoque.
          Nada é alterado no Omie.
        </p>
        <form onSubmit={conferir}>
          <div className="b-input-group">
            <label htmlFor="imp-codigos">Códigos (um por linha)</label>
            <textarea id="imp-codigos" className="b-input cad-areatexto" rows={6} value={texto} disabled={emAndamento || fase === 'concluido'}
              onChange={(e) => { setTexto(e.target.value); if (itens) { setItens(null); setFase('ocioso'); } }}
              placeholder={'4000064\n3000010\n8000074'} spellCheck="false" autoComplete="off" />
          </div>
          <div className="cad-acoes">
            <button type="submit" className="b-btn" disabled={codigos.length === 0 || emAndamento || fase === 'concluido'}>
              {fase === 'conferindo' ? 'Conferindo…' : codigos.length > 1 ? `Conferir ${codigos.length} códigos` : 'Conferir código'}
            </button>
          </div>
        </form>
      </section>

      {itens && (
        <section className="b-card cad-secao fade-in" aria-labelledby="imp-titulo">
          <div className="cad-secao__topo">
            <h3 id="imp-titulo" className="brand-font">
              {fase === 'conferindo' ? 'Conferindo…' : fase === 'importando' ? 'Importando…' : fase === 'concluido' ? 'Importação concluída' : 'Resultado da conferência'}
            </h3>
            {fase === 'concluido' && <button type="button" className="b-btn-ghost" onClick={nova}>Nova importação</button>}
          </div>

          {emAndamento && (
            <>
              <div className="cad-barra" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitos} aria-label="Progresso">
                <span style={{ width: `${total ? (feitos / total) * 100 : 5}%` }} />
              </div>
              <p className="cad-progresso-texto" aria-live="polite">{feitos} de {total}</p>
            </>
          )}

          {!emAndamento && (
            <p className="cad-progresso-texto" aria-live="polite">
              {contar('criado') > 0 && `${contar('criado')} criado(s) · `}
              {prontos > 0 && `${prontos} pronto(s) · `}
              {contar('ja_no_nexaas')} já no Nexaas · {contar('erro')} com problema
            </p>
          )}

          <ul className="cad-lista">
            {itens.map((i) => {
              const [rotulo, tom] = ROTULO[i.estado];
              return (
                <li key={i.codigo} className={`cad-linha ${i.estado === 'erro' ? 'cad-linha--erro' : ''}`}>
                  <div className="cad-linha__corpo">
                    <strong><span className="cad-codigo">{i.codigo}</span> {i.descricao}</strong>
                    {destino(i) && <span>{destino(i)}</span>}
                    {i.aviso && <span>{i.aviso}</span>}
                    {(i.erros || []).map((p) => <em key={p} className="cad-linha__problema">{p}</em>)}
                  </div>
                  <div className="cad-linha__lado"><span className={`cad-chip cad-chip--${tom}`}>{rotulo}</span></div>
                </li>
              );
            })}
          </ul>

          {fase === 'ocioso' && (
            <div className="cad-rodape">
              <span>{prontos > 0 ? 'Confira a lista e confirme.' : 'Nada para importar neste momento.'}</span>
              <button type="button" className="b-btn" onClick={importar} disabled={prontos === 0}>
                Importar {prontos} produto{prontos === 1 ? '' : 's'} no Nexaas
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
