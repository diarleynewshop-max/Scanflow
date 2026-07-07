import { useState } from "react";
import { enviarListaParaSupabase, WebhookPayload } from "@/lib/webhookRouter";
import { Product, ListData } from "@/components/ProductCard";
import { Pencil, Trash2, Download, FileText, Share2, FileInput, ChevronLeft, ChevronRight, Monitor } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { resolvePhotoToDataUrl } from "@/lib/photoUtils";

interface ListHistoryProps {
  lists: ListData[];
  onUpdateList: (list: ListData) => void;
  onStartConference: () => void;
  modoDesktop?: boolean;
  modoLeve?: boolean;
}

const S_INPUT = {
  width: "100%", height: 44, padding: "0 14px", borderRadius: 10,
  border: "1.5px solid hsl(var(--border))", background: "hsl(var(--secondary))",
  color: "hsl(var(--foreground))", fontSize: 14, outline: "none",
  boxSizing: "border-box" as const,
} as React.CSSProperties;

const LABEL = {
  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500,
  letterSpacing: "0.18em", textTransform: "uppercase" as const,
  color: "hsl(var(--muted-foreground))", marginBottom: 5, display: "block",
} as React.CSSProperties;

const STATUS_LEFT: Record<string, string> = {
  green: "hsl(var(--success))",
  red: "hsl(var(--destructive))",
  yellow: "hsl(var(--warning))",
};

const ListHistory = ({ lists, onUpdateList, onStartConference, modoDesktop = false, modoLeve = false }: ListHistoryProps) => {
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState<string | null>(null);
  const [editList, setEditList] = useState<ListData | null>(null);
  const [editIndex, setEditIndex] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);


  const [sendingId, setSendingId] = useState<string | null>(null);

  const sortedLists = [...lists]
    .filter((l) => l.status !== "open")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const handleDelete = (listId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    onUpdateList({ ...list, status: "red" });
    setDeleteConfirm(null); setMenuOpen(null);
    toast({ title: "Lista marcada como excluída" });
  };

  const exportPDF = async (list: ListData) => {
    const hydratedProducts = await hydrateProductsForExport(list);
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text(list.title || "Lista", 14, 20);
    doc.setFontSize(11); doc.text(`Pessoa: ${list.person}`, 14, 28);
    doc.text(`Data: ${list.createdAt.toLocaleDateString("pt-BR")}`, 14, 35);
    let y = 45; const ph = doc.internal.pageSize.getHeight();
    hydratedProducts.forEach(({ product, photoDataUrl }, i) => {
      const p = product;
      const h = photoDataUrl ? 45 : 25;
      if (y + h > ph - 20) { doc.addPage(); y = 20; }
      if (photoDataUrl) { try { doc.addImage(photoDataUrl, "JPEG", 14, y, 28, 28); } catch {} }
      const tx = photoDataUrl ? 48 : 14;
      doc.setFontSize(11); doc.setFont("helvetica", "bold");
      doc.text(`${i + 1}. ${product.barcode}`, tx, y + 6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.text(`SKU: ${p.sku || "-"} | Qtd: ${p.quantity} | Etiqueta: ${p.removeTag ? "Sim" : "Não"}`, tx, y + 13);
      y += h;
    });
    doc.save(`lista_${list.person.replace(/\s/g, "_")}.pdf`);
    setDownloadOpen(null);
    toast({ title: "PDF exportado!" });
  };

  const exportCSV = (list: ListData) => {
    const header = "DESCRICAO;CODIGO;QTD_CONFERIDA;QTD_PLANILHA;DIVERGENCIA;DIVERGENTE";
    const rows = list.products.map((p) => {
      const desc = (p.description || p.sku || "").replace(/;/g, ",");
      const codigo = p.barcode || "";
      const qtdConferida = p.quantity;
      const qtdPlanilha = p.qtdPlanilha ?? 0;
      const divergencia = qtdPlanilha - qtdConferida;
      const divergente = divergencia !== 0 ? "SIM" : "NAO";
      return `${desc};${codigo};${qtdConferida};${qtdPlanilha};${divergencia};${divergente}`;
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `lista_${list.person.replace(/\s/g,"_")}.csv`; a.click();
    URL.revokeObjectURL(url); setDownloadOpen(null);
    toast({ title: "CSV exportado!" });
  };

  const handleShare = async (list: ListData) => {
    let text = `📋 ${list.title}\n👤 ${list.person}\n\n`;
    list.products.forEach((p, i) => { text += `${i + 1}. ${p.barcode} | SKU: ${p.sku || "-"} | Qtd: ${p.quantity}\n`; });
    if (navigator.share) { try { await navigator.share({ title: list.title, text }); } catch {} }
    else { await navigator.clipboard.writeText(text); toast({ title: "Lista copiada!" }); }
    setDownloadOpen(null);
  };

  const hydrateProductsForExport = async (list: ListData) => {
    return await Promise.all(
      list.products.map(async (product) => ({
        product,
        photoDataUrl: await resolvePhotoToDataUrl(product),
      }))
    );
  };

  const exportJSON = async (list: ListData) => {
    const hydratedProducts = await hydrateProductsForExport(list);
    const data = {
      type: "conference-file",
      items: hydratedProducts.map(({ product, photoDataUrl }) => ({
        codigo: product.barcode,
        sku: product.sku || "",
        quantidade: product.quantity,
        photo: photoDataUrl,
      })),
    };
    const fileName = list.title.replace(/[\s/]/g, "").replace(/[^a-zA-Z0-9-áéíóúàèìòùâêîôûãõäëïöüçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇ]/g, "");
    const txt = `Codigo\n${list.products.map((p) => p.barcode).join("\n")}\n\n------------------------\n\nCodigo;Quantidade\n${list.products.map((p) => `${p.barcode};${p.quantity}`).join("\n")}`;
    setDownloadOpen(null);
    try {
      const zip = new JSZip();
      zip.file(`${fileName}.json`, JSON.stringify(data, null, 2));
      zip.file(`${fileName}.txt`, txt);
      const blob = await zip.generateAsync({ type: "blob" });
      const zipFile = new File([blob], `${fileName}.zip`, { type: "application/zip" });
      if (navigator.share) { try { await navigator.share({ files: [zipFile], title: `Lista - ${list.title}` }); return; } catch (e: any) { if (e?.name === "AbortError") return; } }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${fileName}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "ZIP baixado!" });
    } catch {
      toast({ title: "Erro ao gerar ZIP", variant: "destructive" });
    }
  };

  const exportHTML = async (list: ListData) => {
    const escapeHtml = (value: unknown) => String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    const hydratedProducts = await hydrateProductsForExport(list);
    const cardsHtml = hydratedProducts.map(({ product, photoDataUrl }) => {
      const codigo = escapeHtml(product.barcode);
      const sku = escapeHtml(product.sku || "-");
      const quantidade = escapeHtml(product.quantity);
      const foto = photoDataUrl
        ? '<img class="card-img" src="' + escapeHtml(photoDataUrl) + '" alt="' + codigo + '" loading="lazy">'
        : '<div class="card-no-img">SEM FOTO</div>';
      const tag = product.removeTag
        ? '<span class="tag tag-etiqueta">Tira etiqueta</span>'
        : '<span class="tag tag-ok">OK</span>';

      return '<button class="card' + (product.removeTag ? ' has-tag' : '') + '" data-code="' + codigo + '">' +
        foto +
        '<span class="card-body">' +
          '<span class="card-code">' + codigo + '</span>' +
          '<span class="card-sku">SKU: ' + sku + '</span>' +
          '<span class="card-footer">' +
            '<span class="card-qty"><strong>' + quantidade + '</strong><span>unid</span></span>' +
            tag +
          '</span>' +
        '</span>' +
      '</button>';
    }).join("");

    const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>' + escapeHtml(list.title) + ' - ' + escapeHtml(list.person) + '</title><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f3f0;color:#1a1916;padding:24px 14px 56px}header{max-width:1200px;margin:0 auto 18px}h1{font-size:28px;font-weight:900;line-height:1.1;letter-spacing:0}header p{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#77736b;margin-top:8px;line-height:1.45}.grid{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px}.card{appearance:none;text-align:left;background:#fff;border-radius:12px;border:1.5px solid #e2e0da;overflow:hidden;cursor:pointer;position:relative;color:inherit;font:inherit}.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#e2e0da}.card.has-tag::before{background:#f0a500}.card-img,.card-no-img{width:100%;aspect-ratio:1;display:block}.card-img{object-fit:cover}.card-no-img{background:#f0ede8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#aaa49a}.card-body{display:block;padding:11px 13px 13px;border-top:1.5px solid #e2e0da}.card-code{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:700;word-break:break-all}.card-sku{display:block;font-size:11px;color:#77736b;margin-top:3px;min-height:28px;line-height:1.25}.card-footer{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px}.card-qty strong{font-size:22px;font-weight:900;display:block;line-height:1}.card-qty span{font-size:10px;color:#77736b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.tag{font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.tag-etiqueta{background:#fff3e0;color:#a05c00}.tag-ok{background:#e8f5ee;color:#1e7d4a}.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(70px);background:#1a1916;color:#fff;padding:12px 20px;border-radius:30px;font-size:13px;font-weight:700;opacity:0;transition:all .2s;pointer-events:none;white-space:nowrap;z-index:10}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}@media(max-width:430px){body{padding:20px 12px 50px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}h1{font-size:26px}.card-body{padding:10px}}</style></head><body><header><h1>' + escapeHtml(list.title) + '</h1><p>' + escapeHtml(list.person) + ' - ' + list.createdAt.toLocaleDateString("pt-BR") + ' - Toque no card para copiar o codigo</p></header><main class="grid">' + cardsHtml + '</main><div class="toast" id="toast"></div><script>document.querySelectorAll(".card").forEach(function(card){card.addEventListener("click",function(){var code=card.getAttribute("data-code")||"";if(navigator.clipboard){navigator.clipboard.writeText(code)}var toast=document.getElementById("toast");toast.textContent="Copiado: "+code;toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},1600)})});</script></body></html>';
    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "lista_" + list.person.replace(/\s/g, "_") + ".html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadOpen(null);
    toast({ title: "HTML gerado!" });
  };

  const STORAGE_KEY = "conferencia_sent_list_ids";

  const listaJaFoiEnviada = (listId: string): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      return ids.includes(listId);
    } catch { return false; }
  };

  const marcarListaEnviada = (listId: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      const novos = [...ids, listId].slice(-200);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(novos));
    } catch {}
  };

  const enviarParaConferencia = async (list: ListData) => {
    // Verifica se a lista tem itens antes de enviar
    if (list.products.length === 0) {
      toast({
        title: "❌ Lista vazia",
        description: "Não é possível enviar listas com 0 itens para conferência.",
        variant: "destructive"
      });
      return;
    }

    const itensSemFoto = list.products.filter((product) => !product.photo && !product.photoBlob && !product.photoAssetId);
    if (itensSemFoto.length > 0) {
      toast({
        title: "Foto obrigatoria",
        description: `${itensSemFoto.length} item(ns) sem foto. Edite a lista e adicione foto antes de enviar.`,
        variant: "destructive",
      });
      return;
    }

    if (list.sentToConference || listaJaFoiEnviada(list.id)) {
      toast({ title: "⚠️ Já enviado!", description: "Esta lista já foi enviada para conferência.", variant: "destructive" });
      return;
    }
    if (sendingId === list.id) return;

    setSendingId(list.id);

    try {
      const listaParaEnviar = list;
      const hydratedProducts = await hydrateProductsForExport(listaParaEnviar);
      const fotosNaoResolvidas = hydratedProducts.filter(({ photoDataUrl }) => !photoDataUrl);
      if (fotosNaoResolvidas.length > 0) {
        toast({
          title: "Foto obrigatoria",
          description: `${fotosNaoResolvidas.length} foto(s) nao carregaram. Abra a lista, remova e tire a foto novamente.`,
          variant: "destructive",
        });
        return;
      }

      const payload: WebhookPayload = {
        flag:        listaParaEnviar.flag ?? "loja",
        empresa:     listaParaEnviar.empresa ?? "",
        pessoa:      listaParaEnviar.person,
        titulo:      listaParaEnviar.title,
        totalItens:  listaParaEnviar.products.length,
        dataCriacao: listaParaEnviar.createdAt.toISOString(),
        produtos:    hydratedProducts.map(({ product, photoDataUrl }) => ({
          barcode:    product.barcode,
          sku:        product.sku || "",
          quantidade: product.quantity,
          removeTag:  product.removeTag ?? false,
          secao:      product.secao || null,
          photo:      photoDataUrl,
          erpProdutoId: product.erpProdutoId,
          appPhotoWithoutErp: product.appPhotoWithoutErp,
        })),
      };

      await enviarListaParaSupabase(payload);
      marcarListaEnviada(listaParaEnviar.id);
      onUpdateList({ ...listaParaEnviar, status: "green", sentToConference: true });
      const dest = `${payload.flag.toUpperCase()} · ${payload.empresa}`;
      toast({ title: `✅ Enviado para conferência! [${dest}]`, description: `Lista "${listaParaEnviar.title}" enviada com sucesso.` });
    } catch {
      toast({ title: "❌ Falha no envio", description: "Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const openEdit = (list: ListData) => {
    setEditList({ ...list, products: list.products.map((p) => ({ ...p })) });
    setEditIndex(0); setEditProduct({ ...list.products[0] }); setMenuOpen(null);
  };

  const finishEdit = () => {
    if (!editList) return;
    const prods = editList.products.map((p, i) => i === editIndex ? { ...editProduct! } : p);
    onUpdateList({ ...editList, products: prods });
    setEditList(null); setEditProduct(null);
    toast({ title: "Lista atualizada!" });
  };

  const navigateEdit = (dir: number) => {
    if (!editList || !editProduct) return;
    const prods = editList.products.map((p, i) => i === editIndex ? { ...editProduct } : p);
    const updated = { ...editList, products: prods };
    setEditList(updated);
    const next = editIndex + dir;
    if (next >= 0 && next < updated.products.length) { setEditIndex(next); setEditProduct({ ...updated.products[next] }); }
  };

  const dialogStyle = { background: "hsl(var(--card))", borderRadius: 20, border: "1px solid hsl(var(--border))" };

  if (sortedLists.length === 0) {
    return (
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center", padding: "52px 20px" }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "hsl(var(--muted-foreground))" }}>
            <FileInput style={{ width: 26, height: 26 }} />
          </div>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 4 }}>Nenhuma lista</p>
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Feche uma lista na aba Escanear</p>
        </div>
        <button onClick={onStartConference}
          style={{ width: "100%", height: 48, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", borderRadius: 10, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}
        >
          <FileInput style={{ width: 17, height: 17 }} /> Importar para Conferência
        </button>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: modoDesktop ? 24 : 20, 
      display: "flex", 
      flexDirection: "column", 
      gap: modoDesktop ? 16 : 12 
    }}>
      {sortedLists.map((list) => {
         return (
          <div key={list.id} style={{ 
            background: "hsl(var(--card))", 
            borderRadius: modoDesktop ? 18 : 16, 
            border: "1px solid hsl(var(--border))", 
            overflow: "hidden", 
            boxShadow: modoDesktop ? "var(--shadow-sm)" : "var(--shadow-xs)", 
            position: "relative" 
          }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: modoDesktop ? 6 : 4, background: STATUS_LEFT[list.status] ?? STATUS_LEFT.yellow }} />

            <div style={{ 
              padding: modoDesktop ? "20px 20px 16px 24px" : "16px 16px 12px 20px", 
              display: "flex", 
              alignItems: "flex-start", 
              justifyContent: "space-between", 
              gap: modoDesktop ? 16 : 12 
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ 
                  fontFamily: "var(--font-serif)", 
                  fontSize: modoDesktop ? 18 : 16, 
                  fontWeight: 700, 
                  color: "hsl(var(--foreground))", 
                  overflow: "hidden", 
                  textOverflow: "ellipsis", 
                  whiteSpace: "nowrap" 
                }}>
                  {list.title}
                </p>
                 {(() => {
                  const emp = list.empresa || list.title.split("—")[0].trim().split(" — ")[0].trim();
                  return (
                    <span style={{
                      display: "inline-block", 
                      marginTop: modoDesktop ? 6 : 4, 
                      padding: modoDesktop ? "3px 10px" : "2px 8px", 
                      borderRadius: modoDesktop ? 6 : 5, 
                      fontSize: modoDesktop ? 10 : 9, 
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)", 
                      letterSpacing: "0.08em", 
                      textTransform: "uppercase",
                      background: "hsl(var(--primary) / 0.1)",
                      color: "hsl(var(--primary))",
                      border: "1px solid hsl(var(--primary) / 0.2)",
                    }}>
                      {list.flag?.toUpperCase() ?? "LOJA"} · {emp}
                    </span>
                  );
                })()}
                <p style={{ 
                  fontSize: modoDesktop ? 13 : 12, 
                  color: "hsl(var(--muted-foreground))", 
                  marginTop: modoDesktop ? 4 : 3 
                }}>
                  👤 {list.person} · {list.createdAt.toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ 
                  fontFamily: "var(--font-serif)", 
                  fontSize: modoDesktop ? 32 : 28, 
                  fontWeight: 900, 
                  color: "hsl(var(--foreground))", 
                  lineHeight: 1 
                }}>
                  {list.products.length}
                </div>
                <div style={{ 
                  fontFamily: "var(--font-mono)", 
                  fontSize: modoDesktop ? 10 : 9, 
                  color: "hsl(var(--muted-foreground))", 
                  letterSpacing: "0.1em", 
                  textTransform: "uppercase" 
                }}>
                  itens
                </div>
              </div>
            </div>

            <div style={{ 
              display: "flex", 
              gap: modoDesktop ? 10 : 8, 
              padding: modoDesktop ? "12px 20px 8px 24px" : "10px 16px 6px 20px", 
              borderTop: "1px solid hsl(var(--muted))" 
            }}>
              <button onClick={() => openEdit(list)}
                style={{ 
                  flex: 1, 
                  height: modoDesktop ? 40 : 44, 
                  borderRadius: modoDesktop ? 10 : 8, 
                  fontSize: modoDesktop ? 13 : 12, 
                  fontWeight: 600, 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  gap: modoDesktop ? 6 : 5, 
                  cursor: "pointer", 
                  touchAction: "manipulation",
                  background: "hsl(var(--secondary))", 
                  color: "hsl(var(--foreground))", 
                  border: "1px solid hsl(var(--border))" 
                }}>
                <Pencil style={{ width: modoDesktop ? 14 : 13, height: modoDesktop ? 14 : 13 }} /> Editar
              </button>
              <button onClick={() => { setDownloadOpen(list.id); setMenuOpen(null); }}
                style={{ 
                  flex: 1, 
                  height: modoDesktop ? 40 : 44, 
                  borderRadius: modoDesktop ? 10 : 8, 
                  fontSize: modoDesktop ? 13 : 12, 
                  fontWeight: 600, 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  gap: modoDesktop ? 6 : 5, 
                  cursor: "pointer", 
                  touchAction: "manipulation",
                  background: "hsl(var(--secondary))", 
                  color: "hsl(var(--foreground))", 
                  border: "1px solid hsl(var(--border))" 
                }}>
                <Download style={{ width: modoDesktop ? 14 : 13, height: modoDesktop ? 14 : 13 }} /> Baixar
              </button>
              {(() => {
                const jaEnviado = list.sentToConference || listaJaFoiEnviada(list.id);
                const enviando  = sendingId === list.id;
                return (
                  <button
                    onClick={() => enviarParaConferencia(list)}
                    disabled={enviando || jaEnviado}
                    style={{
                      flex: 1, 
                      height: modoDesktop ? 40 : 44, 
                      borderRadius: modoDesktop ? 10 : 8, 
                      fontSize: modoDesktop ? 13 : 12, 
                      fontWeight: 600,
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center", 
                      gap: modoDesktop ? 6 : 5,
                      cursor: (enviando || jaEnviado) ? "not-allowed" : "pointer",
                      touchAction: "manipulation",
                      opacity: (enviando || jaEnviado) ? 0.75 : 1,
                      transition: "all 0.2s",
                      background: jaEnviado ? "hsl(var(--success))" : enviando ? "hsl(var(--muted))" : "hsl(var(--primary))",
                      color:      jaEnviado ? "hsl(var(--success-foreground))" : enviando ? "hsl(var(--muted-foreground))" : "hsl(var(--primary-foreground))",
                      border: "none",
                    }}
                  >
                    {enviando && <span style={{ 
                      width: modoDesktop ? 12 : 11, 
                      height: modoDesktop ? 12 : 11, 
                      border: "2px solid currentColor", 
                      borderTopColor: "transparent", 
                      borderRadius: "50%", 
                      display: "inline-block", 
                      animation: "spin 0.7s linear infinite" 
                    }} />}
                    {jaEnviado && <span style={{ fontSize: modoDesktop ? 12 : 11 }}>✅</span>}
                    {!enviando && !jaEnviado && <Share2 style={{ width: modoDesktop ? 14 : 13, height: modoDesktop ? 14 : 13 }} />}
                    {enviando ? "Enviando…" : jaEnviado ? "Enviado" : "Enviar"}
                  </button>
                );
              })()}
              <button onClick={() => { setDeleteConfirm(list.id); setMenuOpen(null); }}
                style={{ flex: 1, height: 44, borderRadius: 8, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", touchAction: "manipulation", background: "hsl(var(--destructive) / 0.07)", color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.2)" }}>
                <Trash2 style={{ width: 13, height: 13 }} /> Excluir
              </button>
            </div>

          </div>
        );
      })}

      <button onClick={onStartConference}
        style={{ width: "100%", height: 48, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", borderRadius: 10, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", marginTop: 4 }}
      >
        <FileInput style={{ width: 17, height: 17 }} /> Importar para Conferência
      </button>

      {/* ── DELETE ── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-sm" style={dialogStyle}>
          <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 16px" }} />
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700 }}>Excluir lista?</DialogTitle>
            <DialogDescription style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Ela será marcada como excluída no histórico.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2" style={{ marginTop: 16 }}>
            <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancelar</button>
            <button onClick={() => deleteConfirm && handleDelete(deleteConfirm)} style={{ flex: 1, height: 44, borderRadius: 10, background: "hsl(var(--destructive))", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Excluir</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DOWNLOAD ── */}
      <Dialog open={!!downloadOpen} onOpenChange={() => setDownloadOpen(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-sm" style={dialogStyle}>
          <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 16px" }} />
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700 }}>Baixar</DialogTitle>
            <DialogDescription style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Escolha o formato do arquivo.</DialogDescription>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { label: "HTML", Icon: Monitor, action: () => { const l = lists.find(x => x.id === downloadOpen); if (l) exportHTML(l); } },
                { label: "PDF", Icon: FileText, action: () => { const l = lists.find(x => x.id === downloadOpen); if (l) exportPDF(l); } },
                { label: "JSON", Icon: FileInput, action: () => { const l = lists.find(x => x.id === downloadOpen); if (l) exportJSON(l); } },
              ].map(({ label, Icon, action }) => (
                <button key={label} onClick={action} style={{ height: 56, borderRadius: 10, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", fontWeight: 600, fontSize: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer" }}>
                  <Icon style={{ width: 18, height: 18 }} /> {label}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── EDIT ── */}
      <Dialog open={!!editList} onOpenChange={() => { setEditList(null); setEditProduct(null); }}>
        <DialogContent aria-describedby={undefined} className="max-w-sm" style={{ ...dialogStyle, maxHeight: "90vh", overflowY: "auto" }}>
          <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 16px" }} />
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700 }}>Editar Produtos</DialogTitle>
            <DialogDescription style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Item {editIndex + 1} de {editList?.products.length || 0}</DialogDescription>
          </DialogHeader>
          {editProduct && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
              {editProduct.photo && <img src={editProduct.photo} alt="Produto" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10 }} />}
              {[
                { label: "Código de Barras", value: editProduct.barcode, onChange: (v: string) => setEditProduct({ ...editProduct, barcode: v }), type: "text" },
                { label: "SKU", value: editProduct.sku, onChange: (v: string) => setEditProduct({ ...editProduct, sku: v }), type: "text" },
                { label: "Quantidade", value: String(editProduct.quantity), onChange: (v: string) => setEditProduct({ ...editProduct, quantity: Number(v) || 0 }), type: "number" },
              ].map(({ label, value, onChange, type }) => (
                <div key={label}>
                  <label style={LABEL}>{label}</label>
                  <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={S_INPUT} />
                </div>
              ))}
              <div>
                <label style={LABEL}>Tira Etiqueta?</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([true, false] as const).map((val) => (
                    <button key={String(val)} onClick={() => setEditProduct({ ...editProduct, removeTag: val })} style={{ height: 42, borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", background: editProduct.removeTag === val ? "hsl(var(--primary))" : "hsl(var(--secondary))", color: editProduct.removeTag === val ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))", border: editProduct.removeTag === val ? "2px solid hsl(var(--primary))" : "2px solid hsl(var(--border))" }}>
                      {val ? "SIM" : "NÃO"}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                <button onClick={() => navigateEdit(-1)} disabled={editIndex === 0} style={{ height: 42, padding: "0 14px", borderRadius: 10, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", opacity: editIndex === 0 ? 0.35 : 1 }}>
                  <ChevronLeft style={{ width: 16, height: 16 }} /> Ant
                </button>
                {editIndex < (editList?.products.length || 0) - 1 ? (
                  <button onClick={() => navigateEdit(1)} style={{ flex: 1, height: 42, borderRadius: 10, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "none", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer" }}>
                    Próximo <ChevronRight style={{ width: 16, height: 16 }} />
                  </button>
                ) : (
                  <button onClick={finishEdit} style={{ flex: 1, height: 42, borderRadius: 10, background: "hsl(var(--success))", color: "hsl(var(--success-foreground))", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Salvar Tudo</button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ListHistory;
