import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

interface Resumo {
  separado: number;
  naoTem: number;
  parcial: number;
  pendente: number;
  totalItens: number;
}

interface PorDia {
  label: string;
  Separado: number;
  "Não tem": number;
  Parcial: number;
  Pendente: number;
  total: number;
  "% Diferença"?: number;
}

interface ItemFrequencia {
  codigo: string;
  sku: string;
  secao: string;
  vezes: number;
  statusDominante: string;
  totalPedido: number;
  totalReal: number;
}

export interface GraficoCapturado {
  label: string;
  dataUrl: string;
  largura: number;
  altura: number;
}

export interface DadosExport {
  empresa: string;
  flag: string;
  periodo: string;
  resumo: Resumo;
  porDia: PorDia[];
  frequencia: ItemFrequencia[];
  totalPedido: number;
  totalReal: number;
  pctDif: number;
  graficos?: GraficoCapturado[];
}

function statusLabel(s: string) {
  return s === "nao_tem" ? "Não tem" : s === "parcial" ? "Parcial" : s === "pendente" ? "Pendente" : "Separado";
}

// ── CSV ────────────────────────────────────────────────────────────────────────

function rowsToCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) lines.push(r.map(escape).join(","));
  return lines.join("\n");
}

export function exportarCSV(dados: DadosExport) {
  const partes: string[] = [];

  partes.push(`Relatório Dashboard — ${dados.empresa} ${dados.flag.toUpperCase()}`);
  partes.push(`Período: ${dados.periodo}`);
  partes.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
  partes.push("");

  partes.push("RESUMO GERAL");
  partes.push(rowsToCsv(
    ["Separado", "Não tem", "Parcial", "Pendente", "Total SKUs", "Total Pedido", "Total Real", "% Diferença"],
    [[
      dados.resumo.separado,
      dados.resumo.naoTem,
      dados.resumo.parcial,
      dados.resumo.pendente,
      dados.resumo.totalItens,
      dados.totalPedido,
      dados.totalReal,
      `${dados.pctDif}%`,
    ]]
  ));

  if (dados.porDia.length > 0) {
    partes.push("");
    partes.push("POR DIA");
    partes.push(rowsToCsv(
      ["Data", "Separado", "Não tem", "Parcial", "Pendente", "Total", "% Diferença"],
      dados.porDia.map((d) => [
        d.label, d.Separado, d["Não tem"], d.Parcial, d.Pendente, d.total, d["% Diferença"] ?? "",
      ])
    ));
  }

  if (dados.frequencia.length > 0) {
    partes.push("");
    partes.push("ITENS (FREQUÊNCIA)");
    partes.push(rowsToCsv(
      ["Código", "SKU", "Seção", "Ocorrências", "Status Dominante", "Total Pedido", "Total Real"],
      dados.frequencia.map((i) => [
        i.codigo, i.sku, i.secao, i.vezes, statusLabel(i.statusDominante), i.totalPedido, i.totalReal,
      ])
    ));
  }

  download(`dashboard_${dados.empresa}_${dados.periodo}.csv`, new Blob(["﻿" + partes.join("\n")], { type: "text/csv;charset=utf-8;" }));
}

// ── Excel ──────────────────────────────────────────────────────────────────────

export function exportarExcel(dados: DadosExport) {
  const wb = XLSX.utils.book_new();

  const resumoWs = XLSX.utils.aoa_to_sheet([
    [`Relatório Dashboard — ${dados.empresa} ${dados.flag.toUpperCase()}`],
    [`Período: ${dados.periodo}`],
    [`Gerado em: ${new Date().toLocaleString("pt-BR")}`],
    [],
    ["Separado", "Não tem", "Parcial", "Pendente", "Total SKUs", "Total Pedido", "Total Real", "% Diferença"],
    [dados.resumo.separado, dados.resumo.naoTem, dados.resumo.parcial, dados.resumo.pendente,
      dados.resumo.totalItens, dados.totalPedido, dados.totalReal, `${dados.pctDif}%`],
  ]);
  XLSX.utils.book_append_sheet(wb, resumoWs, "Resumo");

  if (dados.porDia.length > 0) {
    const diasWs = XLSX.utils.aoa_to_sheet([
      ["Data", "Separado", "Não tem", "Parcial", "Pendente", "Total", "% Diferença"],
      ...dados.porDia.map((d) => [
        d.label, d.Separado, d["Não tem"], d.Parcial, d.Pendente, d.total, d["% Diferença"] ?? "",
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, diasWs, "Por Dia");
  }

  if (dados.frequencia.length > 0) {
    const itensWs = XLSX.utils.aoa_to_sheet([
      ["Código", "SKU", "Seção", "Ocorrências", "Status Dominante", "Total Pedido", "Total Real"],
      ...dados.frequencia.map((i) => [
        i.codigo, i.sku, i.secao, i.vezes, statusLabel(i.statusDominante), i.totalPedido, i.totalReal,
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, itensWs, "Itens");
  }

  XLSX.writeFile(wb, `dashboard_${dados.empresa}_${dados.periodo}.xlsx`);
}

// ── PDF ────────────────────────────────────────────────────────────────────────

export function exportarPDF(dados: DadosExport) {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Cabeçalho
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(`Dashboard — ${dados.empresa} ${dados.flag.toUpperCase()}`, 14, 10);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Período: ${dados.periodo}`, 14, 17);
  doc.text(`Gerado: ${new Date().toLocaleString("pt-BR")}`, pageW - 14, 17, { align: "right" });

  let y = 30;

  // Resumo geral
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Resumo Geral", 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Separado", "Não tem", "Parcial", "Pendente", "Total SKUs", "Total Pedido", "Total Real", "% Diferença"]],
    body: [[
      dados.resumo.separado, dados.resumo.naoTem, dados.resumo.parcial, dados.resumo.pendente,
      dados.resumo.totalItens, dados.totalPedido, dados.totalReal, `${dados.pctDif}%`,
    ]],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 30, 30] },
    theme: "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Gráficos capturados
  if (dados.graficos && dados.graficos.length > 0) {
    for (const g of dados.graficos) {
      if (y > pageH - 80) { doc.addPage(); y = 20; }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text(g.label, 14, y);
      y += 4;

      // Calcula dimensões mantendo proporção, com largura máxima de pageW - 28
      const maxW = pageW - 28;
      const maxH = 80;
      const ratio = Math.min(maxW / g.largura, maxH / g.altura);
      const w = g.largura * ratio;
      const h = g.altura * ratio;

      doc.addImage(g.dataUrl, "PNG", 14, y, w, h);
      y += h + 12;
    }
  }

  // Por dia
  if (dados.porDia.length > 0) {
    if (y > pageH - 60) { doc.addPage(); y = 20; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Resumo por Dia", 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Data", "Separado", "Não tem", "Parcial", "Pendente", "Total", "% Dif."]],
      body: dados.porDia.map((d) => [
        d.label, d.Separado, d["Não tem"], d.Parcial, d.Pendente, d.total,
        d["% Diferença"] != null ? `${d["% Diferença"]}%` : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 30, 30] },
      theme: "striped",
    });

    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Itens (top 100)
  if (dados.frequencia.length > 0) {
    if (y > pageH - 60) { doc.addPage(); y = 20; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(`Top Itens por Frequência (${Math.min(dados.frequencia.length, 100)} de ${dados.frequencia.length})`, 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [["Código", "SKU", "Seção", "Ocorr.", "Status", "Pedido", "Real"]],
      body: dados.frequencia.slice(0, 100).map((i) => [
        i.codigo, i.sku.slice(0, 30), i.secao, i.vezes, statusLabel(i.statusDominante), i.totalPedido, i.totalReal,
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [30, 30, 30] },
      theme: "striped",
      columnStyles: { 1: { cellWidth: 50 } },
    });
  }

  doc.save(`dashboard_${dados.empresa}_${dados.periodo}.pdf`);
}

// ── HTML ───────────────────────────────────────────────────────────────────────

export function exportarHTML(dados: DadosExport) {
  const tableStyle = `border-collapse:collapse;width:100%;margin-bottom:24px;font-size:13px`;
  const thStyle = `background:#1e1e1e;color:#fff;padding:8px 10px;text-align:left;border:1px solid #444`;
  const tdStyle = `padding:7px 10px;border:1px solid #ddd`;
  const trEven = `background:#f9f9f9`;

  const tabelaHtml = (headers: string[], rows: (string | number)[][]) => `
    <table style="${tableStyle}">
      <thead><tr>${headers.map((h) => `<th style="${thStyle}">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr style="${i % 2 === 1 ? trEven : ""}">${r.map((v) => `<td style="${tdStyle}">${v ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;

  const graficosHtml = dados.graficos && dados.graficos.length > 0
    ? dados.graficos.map((g) => `
  <h2>${g.label}</h2>
  <div style="text-align:center;margin-bottom:24px">
    <img src="${g.dataUrl}" alt="${g.label}" style="max-width:100%;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08)"/>
  </div>`).join("")
    : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Dashboard — ${dados.empresa} ${dados.flag.toUpperCase()}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#333;background:#fff}
    h1{font-size:22px;margin:0 0 4px}
    h2{font-size:16px;margin:24px 0 8px;border-bottom:2px solid #1e1e1e;padding-bottom:4px}
    .meta{font-size:12px;color:#666;margin-bottom:24px}
    .header{background:#1e1e1e;color:#fff;padding:16px 24px;margin:-24px -24px 24px}
    @media print{.header,.header *{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style>
</head>
<body>
  <div class="header">
    <h1>Dashboard — ${dados.empresa} ${dados.flag.toUpperCase()}</h1>
    <div class="meta" style="color:#ccc">Período: ${dados.periodo} · Gerado: ${new Date().toLocaleString("pt-BR")}</div>
  </div>

  <h2>Resumo Geral</h2>
  ${tabelaHtml(
    ["Separado", "Não tem", "Parcial", "Pendente", "Total SKUs", "Total Pedido", "Total Real", "% Diferença"],
    [[dados.resumo.separado, dados.resumo.naoTem, dados.resumo.parcial, dados.resumo.pendente,
      dados.resumo.totalItens, dados.totalPedido, dados.totalReal, `${dados.pctDif}%`]]
  )}

  ${graficosHtml}

  ${dados.porDia.length > 0 ? `
  <h2>Resumo por Dia</h2>
  ${tabelaHtml(
    ["Data", "Separado", "Não tem", "Parcial", "Pendente", "Total", "% Diferença"],
    dados.porDia.map((d) => [d.label, d.Separado, d["Não tem"], d.Parcial, d.Pendente, d.total, d["% Diferença"] != null ? `${d["% Diferença"]}%` : "—"])
  )}` : ""}

  ${dados.frequencia.length > 0 ? `
  <h2>Itens por Frequência (${dados.frequencia.length} itens)</h2>
  ${tabelaHtml(
    ["Código", "SKU", "Seção", "Ocorrências", "Status Dominante", "Total Pedido", "Total Real"],
    dados.frequencia.map((i) => [i.codigo, i.sku, i.secao, i.vezes, statusLabel(i.statusDominante), i.totalPedido, i.totalReal])
  )}` : ""}
</body>
</html>`;

  download(`dashboard_${dados.empresa}_${dados.periodo}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
}

// ── helper ─────────────────────────────────────────────────────────────────────

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}