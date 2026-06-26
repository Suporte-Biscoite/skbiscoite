import { useState } from 'react';
import * as XLSX from 'xlsx';

function App() {
  const [modo, setModo] = useState('individual'); 
  
  // ================= ESTADOS DO INDIVIDUAL =================
  const [formInd, setFormInd] = useState({ categoria: '', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  // ================= ESTADOS DO EM MASSA =================
  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);

  // ================= FUNÇÕES AUXILIARES OTIMIZADAS =================
  
  const buscarTodosCodigosOmie = async () => {
    const res1 = await fetch(`/api/codigos?pagina=1`);
    if (!res1.ok) throw new Error('Falha ao comunicar com a API do Omie.');
    
    const data1 = await res1.json();
    let todosCodigos = [...data1.codigos];
    const totalPaginas = data1.total_paginas;

    if (totalPaginas > 1) {
      const promessas = [];
      for (let p = 2; p <= totalPaginas; p++) {
        promessas.push(fetch(`/api/codigos?pagina=${p}`).then(r => r.json()));
      }
      const resultados = await Promise.all(promessas);
      resultados.forEach(req => {
        if (req.codigos) todosCodigos = [...todosCodigos, ...req.codigos];
      });
    }
    return todosCodigos;
  };

  const calcularProximoSku = (todosCodigos, prefixo) => {
    const prefixoStr = String(prefixo).trim(); 
    const regex = new RegExp(`^${prefixoStr}\\d{4}$`);
    
    const sequenciasDaCategoria = todosCodigos
      .filter(prod => {
        const cod = typeof prod === 'string' ? prod : prod.codigo;
        return cod && regex.test(String(cod).trim());
      })
      .map(prod => {
        const cod = typeof prod === 'string' ? prod : prod.codigo;
        return parseInt(String(cod).trim().slice(prefixoStr.length), 10);
      });

    sequenciasDaCategoria.sort((a, b) => a - b);
    let proximaSequencia = 1; 

    for (let num of sequenciasDaCategoria) {
      if (num === proximaSequencia) {
        proximaSequencia++;
      } else if (num > proximaSequencia) {
        break;
      }
    }

    return prefixoStr + proximaSequencia.toString().padStart(4, '0');
  };

  const cadastrarNoOmie = async (codigo, descricao, ncm, acao) => {
    const ncmFormatado = ncm && ncm.toString().trim() !== '' ? ncm.toString().trim() : '1905.90.20';

    const res = await fetch('/api/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo: codigo,
        descricao: descricao, 
        unidade: "UN",
        preco: 0,
        ncm: ncmFormatado,
        acao: acao // 'IncluirProduto' ou 'AlterarProduto'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'O Omie recusou o cadastro.');
    return data;
  };

  // Nomes coringas que o sistema pode sobrescrever no Omie
  const descricoesStandBy = ['PRODUTO INDEFINIDO', 'PRODUTO INDENIDO', 'CÓDIGO EM STAND-BY'];

  // ================= LÓGICA DO MODO INDIVIDUAL =================
  const handleChangeInd = (e) => setFormInd({ ...formInd, [e.target.name]: e.target.value });

  const gerarECadastrarIndividual = async (e) => {
    e.preventDefault();
    setProcInd(true);
    setSkuGerado(null);
    setErroInd(null);

    try {
      const descFormatada = formInd.descricao.toUpperCase().trim();
      const todosCodigos = await buscarTodosCodigosOmie();
      
      const produtoExistente = todosCodigos.find(prod => {
        const desc = prod.descricao || '';
        return desc.toUpperCase().trim() === descFormatada;
      });

      if (produtoExistente) {
        throw new Error(`Já existe um produto com o nome "${descFormatada}".`);
      }

      // Procura primeiro por um código "INDEFINIDO" ou "INDENIDO"
      const produtoStandBy = todosCodigos.find(prod => {
        const desc = (prod.descricao || '').toUpperCase().trim();
        const cod = (prod.codigo || '').trim();
        return cod.startsWith(formInd.categoria) && descricoesStandBy.includes(desc);
      });

      let novoSKU;
      let acaoOmie;

      if (produtoStandBy) {
        novoSKU = produtoStandBy.codigo.trim();
        acaoOmie = "AlterarProduto"; // Reaproveita o código
      } else {
        novoSKU = calcularProximoSku(todosCodigos, formInd.categoria);
        acaoOmie = "IncluirProduto"; // Usa o próximo buraco disponível
      }

      await cadastrarNoOmie(novoSKU, descFormatada, formInd.ncm, acaoOmie);
      setSkuGerado(novoSKU);
      setFormInd({ categoria: '', descricao: '', ncm: '' }); 
    } catch (err) {
      setErroInd(err.message);
    } finally {
      setProcInd(false);
    }
  };

  // ================= LÓGICA DO MODO EM MASSA =================
  const baixarPlanilhaModelo = () => {
    const dadosModelo = [{
      CATEGORIA: "400",
      DESCRICAO: "PRODUTO DE TESTE EM STAND-BY",
      NCM: "1905.90.20"
    }];
    
    const ws = XLSX.utils.json_to_sheet(dadosModelo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo SKU");
    XLSX.writeFile(wb, "Modelo_Criacao_SKUs.xlsx");
  };

  const lerArquivoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(worksheet);
      setDadosPlanilha(json);
      setLogsMassa([]); 
    };
    reader.readAsArrayBuffer(file);
  };

  const processarEmMassa = async () => {
    if (dadosPlanilha.length === 0) return alert("Por favor, envie uma planilha válida.");
    setProcMassa(true);
    setLogsMassa([]);

    try {
      const todosCodigos = await buscarTodosCodigosOmie();

      for (let i = 0; i < dadosPlanilha.length; i++) {
        const linha = dadosPlanilha[i];
        const catStr = String(linha.CATEGORIA || '').trim();
        const descStr = String(linha.DESCRICAO || '').toUpperCase().trim();
        const ncmStr = linha.NCM ? String(linha.NCM).trim() : '';

        if (!catStr || !descStr) {
          setLogsMassa(prev => [...prev, { status: 'Erro', msg: `Linha ${i+1}: Categoria e Descrição são obrigatórios.` }]);
          continue;
        }

        const produtoExistente = todosCodigos.find(prod => {
           const desc = prod.descricao || '';
           return desc.toUpperCase().trim() === descStr;
        });

        if (produtoExistente) {
          setLogsMassa(prev => [...prev, { status: 'Erro', desc: descStr, msg: `Bloqueado. Já existe no Omie.` }]);
          continue;
        }

        const produtoStandBy = todosCodigos.find(prod => {
          const desc = (prod.descricao || '').toUpperCase().trim();
          const cod = (prod.codigo || '').trim();
          return cod.startsWith(catStr) && descricoesStandBy.includes(desc);
        });

        let novoSKU;
        let acaoOmie;

        if (produtoStandBy) {
          novoSKU = produtoStandBy.codigo.trim();
          acaoOmie = "AlterarProduto";
          // Atualiza a memória para evitar que o próximo item da planilha pegue o mesmo stand-by
          produtoStandBy.descricao = descStr; 
        } else {
          novoSKU = calcularProximoSku(todosCodigos, catStr);
          acaoOmie = "IncluirProduto";
          // Ocupa o buraco na memória
          todosCodigos.push({ codigo: novoSKU, descricao: descStr }); 
        }

        try {
          await cadastrarNoOmie(novoSKU, descStr, ncmStr, acaoOmie);
          const statusTxt = acaoOmie === 'AlterarProduto' ? 'Sucesso (Sobrescrito)' : 'Sucesso';
          setLogsMassa(prev => [...prev, { sku: novoSKU, desc: descStr, status: statusTxt }]);
        } catch (err) {
          setLogsMassa(prev => [...prev, { sku: novoSKU, desc: descStr, status: 'Erro', msg: err.message }]);
        }
      }
    } catch (err) {
      alert("Erro crítico ao varrer o Omie: " + err.message);
    } finally {
      setProcMassa(false);
      setDadosPlanilha([]); 
    }
  };

  // ================= RENDERIZAÇÃO =================
  return (
    <div style={{ backgroundColor: '#F8F6F0', minHeight: '100vh', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #E5E0D8' }}>
        
        <div style={{ marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#0F2041' }}>Gerador de SKU - TI</h2>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setModo('individual')} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', border: 'none', backgroundColor: modo === 'individual' ? '#0F2041' : '#E5E0D8', color: modo === 'individual' ? '#fff' : '#0F2041' }}>
              Individual
            </button>
            <button onClick={() => setModo('massa')} style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', border: 'none', backgroundColor: modo === 'massa' ? '#0F2041' : '#E5E0D8', color: modo === 'massa' ? '#fff' : '#0F2041' }}>
              Em Massa (Planilha)
            </button>
          </div>
        </div>

        {modo === 'individual' && (
          <div>
            {erroInd && <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontWeight: 'bold' }}>Erro: {erroInd}</div>}

            <form onSubmit={gerarECadastrarIndividual} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ fontWeight: 'bold', color: '#333' }}>Prefixo (Categoria) *</label>
                <select name="categoria" value={formInd.categoria} onChange={handleChangeInd} required style={{ width: '100%', padding: '12px', marginTop: '5px', borderRadius: '8px', border: '1px solid #ccc' }}>
                  <option value="">Selecione a raiz do código...</option>
                  <option value="300">300 - EXTERNO</option>
                  <option value="400">400 - INTERNO</option>
                  <option value="500">500 - CESTAS</option>
                </select>
              </div>
              
              <div>
                <label style={{ fontWeight: 'bold', color: '#333' }}>Descrição Provisória / Final *</label>
                <input type="text" name="descricao" value={formInd.descricao} onChange={handleChangeInd} required placeholder="Será convertido para MAIÚSCULAS" style={{ width: '100%', padding: '12px', marginTop: '5px', borderRadius: '8px', border: '1px solid #ccc', textTransform: 'uppercase' }} />
              </div>

              <div>
                <label style={{ fontWeight: 'bold', color: '#333' }}>NCM</label>
                <input type="text" name="ncm" value={formInd.ncm} onChange={handleChangeInd} placeholder="Deixe em branco para auto-preencher com 1905.90.20" style={{ width: '100%', padding: '12px', marginTop: '5px', borderRadius: '8px', border: '1px solid #ccc' }} />
              </div>
              
              <button type="submit" disabled={procInd} style={{ backgroundColor: '#F2A900', color: '#0F2041', padding: '16px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', marginTop: '10px' }}>
                {procInd ? 'Calculando e Registrando...' : 'Descobrir Próximo SKU e Registar'}
              </button>
            </form>

            {skuGerado && (
              <div style={{ marginTop: '25px', padding: '20px', backgroundColor: '#0F2041', color: '#fff', borderRadius: '12px', textAlign: 'center' }}>
                <p style={{ margin: '0 0 10px 0', color: '#F2A900' }}>Sucesso! Novo produto registado no Omie:</p>
                <h1 style={{ margin: 0, fontSize: '32px' }}>{skuGerado}</h1>
              </div>
            )}
          </div>
        )}

        {modo === 'massa' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '15px', borderRadius: '8px', border: '1px dashed #cbd5e1', marginBottom: '20px' }}>
              <div>
                <p style={{ margin: '0 0 5px 0', fontWeight: 'bold', color: '#334155' }}>Passo 1: Baixe o modelo padrão</p>
                <small style={{ color: '#64748b' }}>As colunas exatas são: CATEGORIA, DESCRICAO e NCM</small>
              </div>
              <button onClick={baixarPlanilhaModelo} style={{ padding: '10px 15px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                Baixar Planilha Modelo
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#334155' }}>Passo 2: Envie a planilha preenchida</p>
              <input type="file" accept=".xlsx, .xls" onChange={lerArquivoUpload} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', borderRadius: '8px' }} />
            </div>

            {dadosPlanilha.length > 0 && (
              <button onClick={processarEmMassa} disabled={procMassa} style={{ width: '100%', backgroundColor: '#F2A900', color: '#0F2041', padding: '16px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}>
                {procMassa ? `Processando ${dadosPlanilha.length} linhas...` : `Iniciar Criação em Massa (${dadosPlanilha.length} linhas)`}
              </button>
            )}

            {logsMassa.length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <h3 style={{ borderBottom: '2px solid #F0ECE4', paddingBottom: '10px', color: '#0F2041' }}>Resultados da Importação:</h3>
                <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {logsMassa.map((log, i) => (
                    <div key={i} style={{ padding: '10px', borderRadius: '6px', backgroundColor: log.status.includes('Sucesso') ? '#dcfce7' : '#fee2e2', border: `1px solid ${log.status.includes('Sucesso') ? '#bbf7d0' : '#fecaca'}`, fontSize: '14px' }}>
                      <strong>{log.status.includes('Sucesso') ? '✅' : '❌'} {log.sku ? `SKU: ${log.sku}` : 'Erro'} </strong> 
                      - {log.desc} {log.msg && `(Motivo: ${log.msg})`}
                      <span style={{float: 'right', fontSize: '12px', color: '#64748b'}}>{log.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;