import jsPDF from "jspdf";

export interface ItemPedidoPdf {
  codigo: string;
  descricao: string;
  foto: string | null;
}

export interface PedidoFornecedorPdf {
  fornecedorId: string;
  fornecedorNome: string;
  blob: Blob;
  dataUrl: string;
  filename: string;
  totalItens: number;
}

// Redimensiona a foto pra uma miniatura JPEG pequena antes de colocar no PDF —
// sem isso, um pedido com varias fotos grandes facilmente passa do limite de
// payload da Vercel quando o PDF e enviado pro endpoint de anexo do ClickUp.
async function comprimirFotoParaThumb(foto: string, tamanho = 120): Promise<string | null> {
  try {
    // Passa por fetch+blob antes do canvas — foto pode vir de origem remota
    // (ERP/ClickUp) e ler pixel via canvas de uma <img> cross-origin "mancha"
    // o canvas (SecurityError). fetch().blob() nao tem essa restricao e o
    // data URL resultante e sempre seguro de desenhar/ler depois.
    const resposta = await fetch(foto);
    if (!resposta.ok) return null;
    const blob = await resposta.blob();
    const fotoLocal = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Falha ao ler foto"));
      reader.readAsDataURL(blob);
    });

    const img = new Image();
    const carregada = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    });
    img.src = fotoLocal;
    await carregada;

    const canvas = document.createElement("canvas");
    canvas.width = tamanho;
    canvas.height = tamanho;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const escala = Math.min(tamanho / img.width, tamanho / img.height);
    const w = img.width * escala;
    const h = img.height * escala;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tamanho, tamanho);
    ctx.drawImage(img, (tamanho - w) / 2, (tamanho - h) / 2, w, h);

    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

function nomeArquivoSeguro(valor: string): string {
  return (
    valor
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "fornecedor"
  );
}

export async function gerarPdfPedidoFornecedor(
  fornecedorId: string,
  fornecedorNome: string,
  itens: ItemPedidoPdf[]
): Promise<PedidoFornecedorPdf> {
  const doc = new jsPDF();
  const dataFormatada = new Date().toLocaleDateString("pt-BR");

  doc.setFontSize(16);
  doc.text(`Pedido de Compra — ${fornecedorNome}`, 14, 18);
  doc.setFontSize(10);
  doc.text(`Data: ${dataFormatada}  |  Itens: ${itens.length}`, 14, 25);

  let y = 35;
  const pageHeight = doc.internal.pageSize.getHeight();
  const rowHeight = 26;

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (y + rowHeight > pageHeight - 14) {
      doc.addPage();
      y = 20;
    }

    if (item.foto) {
      const thumb = await comprimirFotoParaThumb(item.foto);
      if (thumb) {
        try {
          doc.addImage(thumb, "JPEG", 14, y, 20, 20);
        } catch {
          // Foto invalida/corrompida nao deve travar o PDF inteiro.
        }
      }
    }

    const textX = 38;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${i + 1}. ${item.codigo}`, textX, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(item.descricao || "(sem descricao)", textX, y + 14, { maxWidth: 150 });

    y += rowHeight;
  }

  const blob = doc.output("blob");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao converter PDF"));
    reader.readAsDataURL(blob);
  });

  const filename = `pedido_${nomeArquivoSeguro(fornecedorNome)}_${dataFormatada.replace(/\//g, "-")}.pdf`;

  return { fornecedorId, fornecedorNome, blob, dataUrl, filename, totalItens: itens.length };
}

export function baixarPdfNoNavegador(pdf: PedidoFornecedorPdf): void {
  const url = URL.createObjectURL(pdf.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = pdf.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

