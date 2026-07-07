import * as XLSX from "xlsx";

export interface SpreadsheetItem {
  description: string;
  sku: string;
  qtdPlanilha: number;
}

const HEADER_WORDS = [
  "descr", "descricao", "descrição", "material", "produto", "item",
  "codigo", "código", "cod", "sku", "ref", "qtd", "quant", "quantidade",
  "preco", "preço", "total", "um", "unid",
];

function isHeaderRow(row: any[]): boolean {
  return row
    .filter(Boolean)
    .map((v) => String(v).toLowerCase().trim())
    .some((t) => HEADER_WORDS.some((kw) => t.startsWith(kw)));
}

// Lê o arquivo como base64 — método mais compatível com Android Chrome
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) {
        reject(new Error("FileReader retornou vazio"));
        return;
      }
      // Remove o prefixo "data:...;base64," e retorna só o base64
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo: " + (reader.error?.message ?? "desconhecido")));
    reader.readAsDataURL(file);
  });
}

// Lê CSV como texto puro
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) ?? "");
    reader.onerror = () => reject(new Error("Erro ao ler CSV"));
    reader.readAsText(file, "UTF-8");
  });
}

function extractItems(jsonData: any[][]): SpreadsheetItem[] {
  const items: SpreadsheetItem[] = [];

  for (const row of jsonData) {
    if (!row || row.length === 0) continue;
    if (isHeaderRow(row)) continue;

    const colA = row[0];
    const colB = row[1];
    const colD = row[3];

    const descricao = colB ? String(colB).trim() : colA ? String(colA).trim() : "";
    const codigo = colA ? String(colA).trim() : "";

    if (!descricao && !codigo) continue;
    if (!colA && String(row[5] ?? "").toLowerCase().includes("total")) continue;

    const qtd = Number(colD);
    items.push({
      description: descricao,
      sku: codigo,
      qtdPlanilha: isNaN(qtd) ? 0 : Math.round(qtd),
    });
  }

  return items.slice(0, 500);
}

function parseCSVText(text: string): SpreadsheetItem[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const items: SpreadsheetItem[] = [];

  for (const line of lines) {
    const sep = line.includes(";") ? ";" : ",";
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (isHeaderRow(cols)) continue;

    const descricao = cols[1] || cols[0] || "";
    const codigo = cols[0] || "";
    if (!descricao && !codigo) continue;

    const qtd = Number(cols[3]);
    items.push({
      description: descricao,
      sku: codigo,
      qtdPlanilha: isNaN(qtd) ? 0 : Math.round(qtd),
    });
  }

  return items.slice(0, 500);
}

export async function parseSpreadsheet(file: File): Promise<SpreadsheetItem[]> {
  const isCSV =
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "text/plain";

  if (isCSV) {
    const text = await readFileAsText(file);
    if (!text.trim()) throw new Error("CSV vazio ou sem permissão de leitura");
    return parseCSVText(text);
  }

  // XLSX/XLS — lê como base64 (mais confiável no Android que arrayBuffer)
  const base64 = await readFileAsBase64(file);

  if (!base64 || base64.length < 10) {
    throw new Error(
      "Arquivo ilegível. Certifique-se de que o arquivo está na pasta Downloads do dispositivo e tente novamente."
    );
  }

  const workbook = XLSX.read(base64, { type: "base64" });

  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase().includes("nota")) ??
    workbook.SheetNames[0];

  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

  const items = extractItems(jsonData);

  if (items.length === 0) {
    throw new Error(
      "Nenhum produto encontrado. Verifique se a planilha tem dados nas colunas A e B a partir da linha 2."
    );
  }

  return items;
}