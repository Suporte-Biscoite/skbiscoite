import { FAMILIAS } from './familias.js';

export const LINHA_INICIAL_DADOS = 5;
const LINHA_FINAL_DADOS = 1004; // 1000 linhas com lista suspensa

// Monta o workbook do modelo de importação. Recebe a classe ExcelJS para funcionar no
// navegador e em testes. A leitura (lerLinhasDaPlanilha) acha o cabeçalho sozinha.
export function montarModeloPlanilha(ExcelJS) {
  const listaFamilias = FAMILIAS.map((f) => f.familia).join(',');
  const fundoEscuro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B1E16' } };

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Modelo SKU Biscoitê');

  worksheet.mergeCells('A1:C1');
  worksheet.getCell('A1').value = 'Planilha de Importação de SKUs';
  worksheet.getCell('A1').font = { name: 'Arial', size: 16, color: { argb: 'FFFFFFFF' }, bold: true };
  worksheet.getCell('A1').fill = fundoEscuro;

  worksheet.mergeCells('A2:C2');
  worksheet.getCell('A2').value = 'Módulo: Gestão de Produtos Biscoitê';
  worksheet.getCell('A2').font = { name: 'Arial', size: 11, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('A2').fill = fundoEscuro;

  const dicas = worksheet.addRow([
    '(obrigatório)\nEscolha na lista\n(ex: PRODUTOS PRONTOS)',
    '(obrigatório)\nNome em maiúsculas',
    '(opcional)\nNCM apenas números',
  ]);
  dicas.height = 60;
  dicas.alignment = { wrapText: true, vertical: 'top' };
  worksheet.addRow(['FAMILIA', 'DESCRICAO', 'NCM']).font = { bold: true };
  worksheet.getColumn(1).width = 32;
  worksheet.getColumn(2).width = 50;
  worksheet.getColumn(3).width = 25;

  // Lista suspensa de famílias; NCM como texto para o Excel não cortar o zero à esquerda (04061010).
  for (let linha = LINHA_INICIAL_DADOS; linha <= LINHA_FINAL_DADOS; linha++) {
    worksheet.getCell(`A${linha}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${listaFamilias}"`],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'Família',
      error: 'Escolha uma família da lista.',
    };
    worksheet.getCell(`C${linha}`).numFmt = '@';
  }

  // Aba de consulta: como cada família vira prefixo de código
  const referencia = workbook.addWorksheet('Famílias');
  referencia.addRow(['PREFIXO DO CÓDIGO', 'GRUPO', 'FAMÍLIA NO OMIE']).font = { bold: true };
  FAMILIAS.forEach((f) => referencia.addRow([f.prefixo, f.grupo, f.familia]));
  referencia.getColumn(1).width = 22;
  referencia.getColumn(2).width = 18;
  referencia.getColumn(3).width = 28;
  referencia.addRow([]);
  referencia.addRow(['O código do SKU é gerado automaticamente a partir da família escolhida.']);

  return workbook;
}
