import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { montarModeloPlanilha, LINHA_INICIAL_DADOS } from './modeloPlanilha.js';
import { lerLinhasDaPlanilha, cadastrarComVaga } from './skus.js';
import { resolverFamilia, FAMILIAS } from './familias.js';

test('modelo: gera .xlsx, preenche como o usuário, lê de volta e importa todas as linhas', async () => {
  const wb = montarModeloPlanilha(ExcelJS);
  const aba = wb.getWorksheet('Modelo SKU Biscoitê');

  // lista suspensa existe e traz as 7 famílias
  const lista = aba.getCell(`A${LINHA_INICIAL_DADOS}`).dataValidation.formulae[0];
  for (const f of FAMILIAS) assert.ok(lista.includes(f.familia), `lista sem ${f.familia}`);

  // usuário preenche (inclui família por prefixo e por grupo, pra provar compatibilidade)
  const linhas = [
    ['PRODUTOS PRONTOS', 'BISCOITO GOIABA', '19059020'],
    ['CESTAS/KIT', 'CESTA NATAL', '19059020'],
    ['INSUMOS PARA ENVASE', 'LATA 200G', ''],
    ['ATIVO', 'FORNO INDUSTRIAL', '84198999'],
    ['400', 'BISCOITO COCO', '19059020'],
    ['EXTERNO', 'MASCARPONE 200G', '04061010'],
  ];
  linhas.forEach((l, i) => l.forEach((v, c) => { aba.getCell(LINHA_INICIAL_DADOS + i, c + 1).value = v; }));

  const buffer = await wb.xlsx.writeBuffer();
  const lido = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  assert.deepEqual(lido.SheetNames, ['Modelo SKU Biscoitê', 'Famílias']);
  const planilha = lido.Sheets[lido.SheetNames[0]];
  const matriz = XLSX.utils.sheet_to_json(planilha, { header: 1, defval: '' });
  const primeiraLinha = XLSX.utils.decode_range(planilha['!ref']).s.r + 1;
  const dados = lerLinhasDaPlanilha(matriz, primeiraLinha);

  assert.equal(dados.length, 6);
  assert.equal(dados[0].linha, 5);
  assert.equal(dados[5].ncm, '04061010'); // zero à esquerda preservado

  // importa tudo contra um Omie falso
  const banco = new Set();
  const cadastrar = async ({ codigo }) => {
    if (banco.has(codigo)) throw new Error(`Já existe um produto com o código ${codigo}`);
    banco.add(codigo);
    return { omie_id: banco.size, familia_id: 1 };
  };
  const produtos = [];
  const ocupados = new Set();
  const codigos = [];
  for (const l of dados) {
    const familia = resolverFamilia(l.familia);
    assert.ok(familia, `família não reconhecida: ${l.familia}`);
    const r = await cadastrarComVaga(cadastrar, { produtos, ocupados, familia, descricao: l.descricao, ncm: l.ncm });
    codigos.push(r.codigo);
  }
  assert.deepEqual(codigos, ['4000001', '5000001', '1010001', '8000001', '4000002', '3000001']);
});
