import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { obterLoginSalvo } from "@/hooks/useAuth";
import { Plus, ClipboardList, ScanBarcode, ArrowLeft, GitCompare, Loader2, AlertCircle, ShoppingCart, BadgeDollarSign } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import BarcodeInput from "@/components/BarcodeInput";
import ProductCard from "@/components/ProductCard";
import { useInventory } from "@/hooks/useInventory";
import { useProductLookup } from "@/hooks/useProductLookup";
import { useToast } from "@/hooks/use-toast";
import { getLightModeEnabled } from "@/lib/lightMode";
import { getHistoricoComprasEnabled } from "@/lib/historicoCompras";
interface HistoricoItemOcorrencia {
  data: string;
  dataFormatada: string;
  status: string;
  listeiro: string;
}
import { blobToDataUrl, isDataPhotoUrl } from "@/lib/photoUtils";
import { getCompanyLogo, getCompanyName } from "@/lib/companyTheme";

const BarcodeScanner = lazy(() => import("@/components/BarcodeScanner"));
const PhotoCapture = lazy(() => import("@/components/PhotoCapture"));
const ListHistory = lazy(() => import("@/components/ListHistory"));
const ConferenceView = lazy(() => import("@/components/ConferenceView"));

const LAZY_FALLBACK = (
  <div style={{ padding: 20, textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
    Carregando...
  </div>
);

const S = {
  inputBase: {
    width: "100%",
    height: 48,
    padding: "0 16px",
    borderRadius: 10,
    border: "1.5px solid hsl(var(--border))",
    background: "hsl(var(--secondary))",
    color: "hsl(var(--foreground))",
    fontFamily: "var(--font-sans)",
    fontSize: 15,
    fontWeight: 500,
    outline: "none",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    fontWeight: 500,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    color: "hsl(var(--muted-foreground))",
    marginBottom: 6,
    display: "block",
  } as React.CSSProperties,
  btnPrimary: {
    width: "100%",
    height: 52,
    background: "hsl(var(--primary))",
    color: "hsl(var(--primary-foreground))",
    border: "none",
    borderRadius: 10,
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "all 0.18s",
    boxShadow: "var(--shadow-md)",
  } as React.CSSProperties,
};

function isConsultaBloqueada(flag?: string | null): boolean {
  return (flag ?? "loja").toLowerCase() !== "loja";
}

async function compactImageBlobToDataUrl(blob: Blob): Promise<string> {
  if (!blob.type.startsWith("image/")) return blobToDataUrl(blob);

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.crossOrigin = "anonymous";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Falha ao carregar foto do ERP"));
      image.src = objectUrl;
    });

    const maxEdge = 900;
    const currentMaxEdge = Math.max(image.width, image.height);
    const scale = currentMaxEdge > maxEdge ? maxEdge / currentMaxEdge : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return blobToDataUrl(blob);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.65);
  } finally {
    image.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

function labelStatusCompras(status: string): string {
  const s = status.toLowerCase().trim();
  if (s === "to do" || s === "a fazer") return "Aguardando Análise";
  if (s.includes("produto_bom") || s.includes("produto bom")) return "Tem no Galpão";
  if (s.includes("produto_ruim") || s.includes("produto ruim")) return "Produto Ruim";
  if (s.includes("fazer_pedido") || s.includes("fazer pedido")) return "Pedido em Aberto";
  if (s.includes("pedido_andamento") || s.includes("andamento")) return "Em Andamento";
  if (s.includes("compra_realizada") || s.includes("compra realizada")) return "Compra Realizada";
  if (s.includes("conclu")) return "Concluído";
  return status;
}

const Index = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const currentLogin = obterLoginSalvo();

  const [barcode, setBarcode] = useState(() => sessionStorage.getItem("scan_barcode") ?? "");
  const [semEAN, setSemEAN] = useState(() => (sessionStorage.getItem("scan_barcode") ?? "").startsWith("SEM_EAN_"));
  const [sku, setSku] = useState(() => sessionStorage.getItem("scan_sku") ?? "");
  const [photo, setPhoto] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(() => sessionStorage.getItem("scan_quantity") ?? "");
  const [view, setView] = useState<"scan" | "list" | "conference">(
    initialTab === "conference" ? "conference" : initialTab === "list" ? "list" : "scan"
  );
  const [showScanner, setShowScanner] = useState(false);
  const [showProductInfo, setShowProductInfo] = useState(false);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [photoProductId, setPhotoProductId] = useState<string | null>(null);

  const [modoDesktop, setModoDesktop] = useState(() => {
    // Sem preferencia salva, segue o tamanho real do aparelho (PC >= 1024px).
    const salvo = localStorage.getItem("modoDesktop");
    if (salvo === "true") return true;
    if (salvo === "false") return false;
    return typeof window !== "undefined" && window.innerWidth >= 1024;
  });
  const [modoLeve, setModoLeve] = useState(() => getLightModeEnabled());
  const [popupCompras, setPopupCompras] = useState<{ ocorrencias: HistoricoItemOcorrencia[]; carregando: boolean } | null>(null);
  const popupMostradoParaRef = useRef<string | null>(null);

  const { lists, activeList, openList, closeList, addProduct, updateList, deleteProduct, updateProduct, updateProductPhoto, moveProductToTop } = useInventory();
  const lookupEmpresa = activeList?.empresa ?? currentLogin?.empresa;
  const lookupFlag = activeList?.flag ?? currentLogin?.flag ?? "loja";
  const logoEmpresa = getCompanyLogo(lookupEmpresa);
  const nomeEmpresaLogo = getCompanyName(lookupEmpresa);
  const consultaBloqueadaPorFlag = isConsultaBloqueada(lookupFlag);
  const { productInfo, loading, error, lookupProduct } = useProductLookup({
    enabled: !consultaBloqueadaPorFlag,
    empresa: lookupEmpresa,
    flag: lookupFlag,
  });

  const startProductLookup = useCallback(
    (code: string) => {
      const normalizedCode = code.trim();
      if (!normalizedCode) return;
      lookupProduct(normalizedCode);
    },
    [lookupProduct]
  );

  useEffect(() => {
    sessionStorage.setItem("scan_barcode", barcode);
  }, [barcode]);

  useEffect(() => {
    sessionStorage.setItem("scan_sku", sku);
  }, [sku]);

  useEffect(() => {
    sessionStorage.setItem("scan_quantity", quantity);
  }, [quantity]);

  useEffect(() => {
    sessionStorage.removeItem("scan_photo");
  }, []);

  useEffect(() => {
    const handleStorageChange = () => {
      setModoDesktop(localStorage.getItem("modoDesktop") === "true");
      setModoLeve(getLightModeEnabled());
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Reseta popup ao trocar barcode
  useEffect(() => {
    popupMostradoParaRef.current = null;
    setPopupCompras(null);
  }, [barcode]);

  // Historico de conferencias por item (ex-ClickUp) removido: sem fonte de dados
  // ate a Dashboard/relatorio ser reimplementada no Supabase. popupCompras fica
  // sempre null, entao os blocos de UI abaixo ficam inertes.

  useEffect(() => {
    if (!consultaBloqueadaPorFlag) return;
    setShowProductInfo(false);
  }, [consultaBloqueadaPorFlag]);

  useEffect(() => {
    if (!productInfo) return;
    const descricao = productInfo.descricao || productInfo.nome_produto;
    if (descricao) setSku(descricao);
  }, [productInfo]);

  useEffect(() => {
    if (!productInfo?.imagem || modoLeve) return;

    let cancelled = false;

    const baixarFotoProduto = async () => {
      try {
        const dataUrl = isDataPhotoUrl(productInfo.imagem)
          ? productInfo.imagem
          : await fetch(productInfo.imagem).then(async (response) => {
              const contentType = response.headers.get("content-type") || "";
              if (!response.ok) {
                const detail = contentType.includes("application/json")
                  ? await response.json().catch(() => null)
                  : await response.text().catch(() => "");
                console.error("Erro detalhado da foto ERP:", detail);
                if (detail) {
                  console.error(
                    "Erro detalhado da foto ERP JSON:",
                    typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)
                  );
                }
                throw new Error(`Falha ao baixar foto (${response.status})`);
              }
              if (contentType.includes("application/json")) {
                const data = await response.json();
                if (typeof data?.dataUrl === "string" && isDataPhotoUrl(data.dataUrl)) {
                  return data.dataUrl;
                }
                throw new Error(data?.error || "Proxy nao retornou dataUrl de imagem.");
              }
              const blob = await response.blob();
              if (!blob.type.startsWith("image/")) {
                throw new Error(`Resposta nao e imagem (${blob.type || "sem content-type"})`);
              }
              return compactImageBlobToDataUrl(blob);
            });

        if (cancelled) return;
        const compactedDataUrl = isDataPhotoUrl(dataUrl)
          ? await compactImageBlobToDataUrl(await fetch(dataUrl).then((response) => response.blob()))
          : dataUrl;
        if (!isDataPhotoUrl(compactedDataUrl)) {
          throw new Error("Foto baixada nao gerou data:image valido.");
        }
        setPhoto((currentPhoto) => currentPhoto || compactedDataUrl);
      } catch (error) {
        console.error("Foto do ERP nao foi baixada:", error);
      }
    };

    void baixarFotoProduto();

    return () => {
      cancelled = true;
    };
  }, [productInfo?.imagem, modoLeve]);

  const handleBarcodeDetected = useCallback(
    (code: string) => {
      setShowScanner(false);
      setBarcode(code);
      if (consultaBloqueadaPorFlag) {
        toast({ title: "Consulta bloqueada", description: "Consulta de produto ativa apenas para flag LOJA." });
        return;
      }
      setShowProductInfo(true);
      startProductLookup(code);
    },
    [startProductLookup, consultaBloqueadaPorFlag, toast]
  );

  const handleCloseList = () => {
    if (!activeList) return;
    if (!window.confirm("Fechar lista atual?")) return;
    closeList();
    toast({ title: "Lista fechada" });
  };

  const handleOpenList = () => {
    const login = obterLoginSalvo();
    const isCD = login?.flag === "cd";
    const titulo = isCD ? "CD" : login?.tituloPadrao?.trim();

    if (!login?.nomePessoa || (!isCD && !titulo)) {
      toast({
        title: "Configure seu perfil antes",
        description: isCD ? "Preencha o nome da pessoa." : "Preencha a secao e o nome da pessoa.",
        variant: "destructive",
      });
      return;
    }

    const ok = openList({
      title: titulo || "CD",
      person: login.nomePessoa,
      flag: isCD ? "cd" : "loja",
      empresa: login.empresa,
    });

    if (ok) {
      toast({ title: "Lista aberta", description: `${titulo || "CD"} · ${login.nomePessoa}` });
    }
  };

  const setDraftPhoto = useCallback((nextPhoto: string) => {
    setPhoto(nextPhoto);
  }, []);

  const clearDraftPhoto = useCallback(() => {
    setPhoto(null);
  }, []);

  const handleAdd = async () => {
    if (!activeList) {
      toast({ title: "Abra uma lista primeiro", variant: "destructive" });
      return;
    }
    if (!photo) {
      toast({
        title: "Foto obrigatoria",
        description: "Adicione uma foto do produto antes de salvar.",
        variant: "destructive",
      });
      return;
    }

    const ok = await addProduct({
      barcode,
      sku,
      photo,
      quantity: Number(quantity),
      secao: productInfo?.secao,
      erpProdutoId: productInfo?.erpProdutoId,
      erpPhotoMissing: !(productInfo?.hasErpImage),
      appPhotoWithoutErp: !(productInfo?.hasErpImage) && !!photo,
    });
    if (!ok) return;

    setBarcode("");
    setSemEAN(false);
    setSku("");
    clearDraftPhoto();
    setQuantity("");
    sessionStorage.removeItem("scan_barcode");
    sessionStorage.removeItem("scan_sku");
    sessionStorage.removeItem("scan_photo");
    sessionStorage.removeItem("scan_quantity");
  };

  const productCount = activeList?.products.length ?? 0;

  const handleTabChange = (key: "scan" | "list" | "conference" | "compras" | "consultaPreco") => {
    if (key === "compras") {
      navigate("/compras");
      return;
    }
    if (key === "consultaPreco") {
      navigate("/consulta-preco");
      return;
    }
    setView(key);
  };

  const extraTab = currentLogin?.role === "compras" ? [{ key: "compras" as const, label: "COMPRADOR", Icon: ShoppingCart }] : [];
  const tabs = [
    { key: "consultaPreco" as const, label: "Consulta", Icon: BadgeDollarSign },
    { key: "scan" as const, label: "Escanear", Icon: ScanBarcode },
    { key: "list" as const, label: "Lista", Icon: ClipboardList },
    { key: "conference" as const, label: "Conferencia", Icon: GitCompare },
    ...extraTab,
  ];

  const flagBadge = { bg: "hsl(var(--primary)/0.10)", border: "hsl(var(--primary)/0.20)", text: "hsl(var(--primary))" };

  return (
    <div className={`min-h-screen flex flex-col ${modoDesktop ? "max-w-6xl mx-auto" : "max-w-md mx-auto"}`} style={{ background: "hsl(var(--background))" }}>
      <header
        style={{
          background: "hsl(var(--primary))",
          padding: modoDesktop ? "18px 32px" : "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: -30, right: -30, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.06)", pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate("/")} style={{ color: "rgba(255,255,255,0.5)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
            <ArrowLeft style={{ width: modoDesktop ? 20 : 18, height: modoDesktop ? 20 : 18 }} />
          </button>
          <img src={logoEmpresa} alt={nomeEmpresaLogo} onClick={() => navigate("/")} style={{ height: modoDesktop ? 38 : 34, objectFit: "contain", cursor: "pointer" }} />
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: modoDesktop ? 10 : 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            {activeList ? activeList.title : "Pedido"}
          </p>
          {activeList && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: modoDesktop ? 12 : 11, color: "rgba(255,255,255,0.8)", marginTop: 1 }}>{productCount} produto(s)</p>
          )}
        </div>
      </header>

      {activeList && (
        <div
          style={{
            background: "hsl(38 92% 50% / 0.12)",
            borderBottom: "1.5px solid hsl(38 92% 50% / 0.2)",
            padding: modoDesktop ? "12px 32px" : "10px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "hsl(var(--warning))", flexShrink: 0, display: "inline-block" }} />
          <p style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))" }}>
            {activeList.title}
            <span style={{ fontWeight: 400, color: "hsl(var(--muted-foreground))" }}> . {activeList.person}</span>
          </p>
          <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", background: flagBadge.bg, border: `1px solid ${flagBadge.border}`, color: flagBadge.text }}>
            {activeList.flag?.toUpperCase() ?? "LOJA"} . {activeList.empresa ? activeList.empresa.split(" ")[0] : ""}
          </span>
          <button
            onClick={handleCloseList}
            data-tut="fechar-lista"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "hsl(var(--destructive))", background: "transparent", border: "1px solid hsl(var(--destructive) / 0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            Fechar
          </button>
        </div>
      )}

      <div style={{ background: "#fff", borderBottom: "1px solid hsl(var(--border))", display: "flex", padding: modoDesktop ? "0 32px" : "0 8px" }}>
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            style={{
              flex: 1,
              padding: modoDesktop ? "14px 0 12px" : "11px 0 9px",
              fontSize: modoDesktop ? 12 : 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              display: "flex",
              flexDirection: modoDesktop ? "row" : "column",
              alignItems: "center",
              gap: modoDesktop ? 8 : 4,
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderBottom: view === key ? "2.5px solid hsl(var(--primary))" : "2.5px solid transparent",
              color: view === key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
              cursor: "pointer",
              transition: "all 0.18s",
            }}
          >
            <Icon style={{ width: modoDesktop ? 16 : 15, height: modoDesktop ? 16 : 15 }} />
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: view === "scan" ? (modoDesktop ? "24px 32px" : "20px") : "0" }}>
        {view === "scan" ? (
          <div style={{ display: "flex", flexDirection: modoDesktop ? "row" : "column", gap: modoDesktop ? 24 : 16, alignItems: modoDesktop ? "flex-start" : "stretch" }}>
            <div style={{ flex: modoDesktop ? 1 : "auto", display: "flex", flexDirection: "column", gap: modoDesktop ? 20 : 16 }}>
              {!activeList && (
                <button
                  onClick={handleOpenList}
                  data-tut="abrir-lista"
                  style={{ ...S.btnPrimary, height: modoDesktop ? 56 : 52, fontSize: modoDesktop ? 15 : 14 }}
                >
                  <ClipboardList style={{ width: modoDesktop ? 20 : 18, height: modoDesktop ? 20 : 18 }} /> Abrir Lista
                </button>
              )}

              {!activeList && (
                <div style={{ background: "hsl(var(--destructive) / 0.07)", border: "1px solid hsl(var(--destructive) / 0.15)", borderRadius: 10, padding: modoDesktop ? "16px 20px" : "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                  <ClipboardList style={{ width: modoDesktop ? 16 : 15, height: modoDesktop ? 16 : 15, color: "hsl(var(--destructive))", flexShrink: 0 }} />
                  <p style={{ fontSize: modoDesktop ? 14 : 13, color: "hsl(var(--destructive))", fontWeight: 500 }}>Abra uma lista para adicionar produtos</p>
                </div>
              )}

              {(modoLeve || consultaBloqueadaPorFlag) && (
                <div style={{ background: "hsl(var(--warning) / 0.10)", border: "1px solid hsl(var(--warning) / 0.22)", borderRadius: 10, padding: modoDesktop ? "14px 18px" : "11px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertCircle style={{ width: modoDesktop ? 16 : 15, height: modoDesktop ? 16 : 15, color: "hsl(var(--warning))", flexShrink: 0 }} />
                  <p style={{ fontSize: modoDesktop ? 13 : 12, color: "hsl(var(--foreground))", fontWeight: 500 }}>
                    {consultaBloqueadaPorFlag
                      ? "Consulta de produto ativa apenas para flag LOJA."
                      : "Modo Leve ativo: foto manual habilitada com compressao leve."}
                  </p>
                </div>
              )}

              {showProductInfo && !consultaBloqueadaPorFlag && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <h3 style={{ fontWeight: 700, fontSize: 16 }}>Informacoes do Produto</h3>
                    <button onClick={() => setShowProductInfo(false)} style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                      X
                    </button>
                  </div>

                  {loading ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : error ? (
                    <div style={{ background: "hsl(var(--destructive) / 0.07)", border: "1px solid hsl(var(--destructive) / 0.15)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                      <AlertCircle style={{ width: 15, height: 15, color: "hsl(var(--destructive))", flexShrink: 0 }} />
                      <p style={{ fontSize: 13, color: "hsl(var(--destructive))", fontWeight: 500 }}>{error}</p>
                    </div>
                  ) : productInfo ? (
                    <div style={{ background: "hsl(var(--secondary))", borderRadius: 10, padding: 16, border: "1px solid hsl(var(--border))" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                        <h4 style={{ fontWeight: 700, fontSize: 15 }}>{productInfo.nome_produto || productInfo.descricao || "Produto sem nome"}</h4>
                        {typeof productInfo.precoVarejo === "number" && (
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 700, textTransform: "uppercase" }}>Varejo</p>
                            <span style={{ fontWeight: 800, fontSize: 16, color: "hsl(var(--primary))" }}>R$ {productInfo.precoVarejo.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px" }}>
                          <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 700, textTransform: "uppercase" }}>Atacado</p>
                          <p style={{ fontWeight: 900, fontSize: 18, color: "hsl(var(--success))" }}>
                            {typeof productInfo.precoAtacado === "number" && productInfo.precoAtacado > 0
                              ? `R$ ${productInfo.precoAtacado.toFixed(2)}`
                              : "Nao informado"}
                          </p>
                        </div>
                        <div style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px" }}>
                          <p style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 700, textTransform: "uppercase" }}>Varejo</p>
                          <p style={{ fontWeight: 900, fontSize: 18, color: "hsl(var(--primary))" }}>
                            {typeof productInfo.precoVarejo === "number" && productInfo.precoVarejo > 0
                              ? `R$ ${productInfo.precoVarejo.toFixed(2)}`
                              : "Nao informado"}
                          </p>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Estoque disponivel:</span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{typeof productInfo.estoque === "number" ? productInfo.estoque : "N/A"}</span>
                      </div>
                      {productInfo.erpProdutoId && (
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                          <span style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>ID Produto ERP:</span>
                          <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-mono)" }}>{productInfo.erpProdutoId}</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Badge histórico — abre popup manualmente se já carregou */}
              {barcode && popupCompras && !popupCompras.carregando && popupCompras.ocorrencias.length > 0 && (
                <button
                  onClick={() => setPopupCompras(popupCompras)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                    background: "hsl(262 80% 50% / 0.10)", border: "1px solid hsl(262 80% 50% / 0.25)",
                    borderRadius: 10, padding: "10px 14px", cursor: "pointer",
                  }}>
                  <ShoppingCart style={{ width: 16, height: 16, color: "hsl(262 80% 50%)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, color: "hsl(262 80% 50%)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Histórico de Pedidos</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{popupCompras.ocorrencias[0] ? `Último: ${popupCompras.ocorrencias[0].dataFormatada}` : ""}</p>
                  </div>
                  <span style={{ fontSize: 11, color: "hsl(262 80% 50%)", fontWeight: 600, flexShrink: 0 }}>
                    {popupCompras.ocorrencias.length}x
                  </span>
                </button>
              )}

              <div>
                <label style={S.label}>Codigo de Barras</label>
                {semEAN ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 48, borderRadius: 10, border: "1.5px solid hsl(var(--warning) / 0.5)", background: "hsl(var(--warning) / 0.08)", display: "flex", alignItems: "center", padding: "0 14px", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>📦</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--warning))" }}>PRODUTO SEM EAN</span>
                    </div>
                    <button
                      onClick={() => { setBarcode(""); setSemEAN(false); }}
                      style={{ width: 48, height: 48, borderRadius: 10, border: "1.5px solid hsl(var(--border))", background: "hsl(var(--card))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--muted-foreground))", flexShrink: 0 }}
                      title="Cancelar sem EAN"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <BarcodeInput
                    value={barcode}
                    onChange={(v) => { setBarcode(v); setSemEAN(false); }}
                    onScanPress={() => setShowScanner(true)}
                    onEnterPress={() => {
                      if (!barcode.trim()) return;
                      if (consultaBloqueadaPorFlag) {
                        toast({ title: "Consulta bloqueada", description: "Consulta de produto ativa apenas para flag LOJA." });
                        return;
                      }
                      setShowProductInfo(true);
                      startProductLookup(barcode);
                    }}
                  />
                )}
                {!semEAN && (
                  <button
                    onClick={() => {
                      const id = `SEM_EAN_${Date.now()}`;
                      setBarcode(id);
                      setSemEAN(true);
                      setShowProductInfo(false);
                    }}
                    style={{ marginTop: 6, width: "100%", height: 36, borderRadius: 8, border: "1.5px dashed hsl(var(--warning) / 0.5)", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "hsl(var(--warning))", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    📦 Produto sem EAN
                  </button>
                )}
              </div>

              <div data-tut="scanner-descricao">
                <label style={S.label}>SKU</label>
                <input type="text" placeholder="Ex: BM-5050" value={sku} onChange={(e) => setSku(e.target.value)} style={S.inputBase} />
              </div>

              <div>
                <label style={S.label}>Foto do Produto *</label>
                <div data-tut="scanner-foto">
                  <PhotoCapture
                    photo={photo}
                    onCapture={(nextPhoto) => {
                      setDraftPhoto(nextPhoto);
                    }}
                    onRemove={() => {
                      clearDraftPhoto();
                    }}
                    compressionPreset={modoLeve ? "light" : "default"}
                  />
                </div>
              </div>

              <div>
                <label style={S.label}>Quantidade</label>
                <input type="number" inputMode="numeric" min="1" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-tut="scanner-quantity" style={{ ...S.inputBase, fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 700 }} />
              </div>

              <button
                onClick={() => {
                  void handleAdd();
                }}
                data-tut="scanner-add"
                style={{ ...S.btnPrimary, height: modoDesktop ? 60 : 56, fontSize: modoDesktop ? 16 : 15, opacity: activeList ? 1 : 0.45, cursor: activeList ? "pointer" : "not-allowed" }}
              >
                <Plus style={{ width: modoDesktop ? 22 : 20, height: modoDesktop ? 22 : 20 }} /> Adicionar Produto
              </button>
            </div>

            {modoDesktop && activeList && activeList.products.length > 0 && (
              <div style={{ flex: 1, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 16, padding: modoDesktop ? 20 : 16, maxHeight: "70vh", overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h3 style={{ fontSize: modoDesktop ? 18 : 16, fontWeight: 700, color: "hsl(var(--foreground))" }}>Produtos Adicionados</h3>
                  <span style={{ fontSize: modoDesktop ? 14 : 12, color: "hsl(var(--muted-foreground))", fontWeight: 600 }}>{activeList.products.length} itens</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {activeList.products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onDelete={deleteProduct}
                      onUpdate={updateProduct}
                      onMoveToTop={moveProductToTop}
                      onCapturePhoto={(id) => {
                        setPhotoProductId(id);
                        setShowPhotoCapture(true);
                      }}
                      modoDesktop={modoDesktop}
                    />
                  ))}
                </div>
              </div>
            )}

            {!modoDesktop && activeList && activeList.products.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                <p style={S.label}>Produtos adicionados</p>
                {activeList.products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onDelete={deleteProduct}
                    onUpdate={updateProduct}
                    onMoveToTop={moveProductToTop}
                    onCapturePhoto={(id) => {
                      setPhotoProductId(id);
                      setShowPhotoCapture(true);
                    }}
                    modoDesktop={modoDesktop}
                  />
                ))}
              </div>
            )}
          </div>
        ) : view === "list" ? (
          <Suspense fallback={LAZY_FALLBACK}>
            <ListHistory
              lists={lists}
              onUpdateList={updateList}
              onStartConference={() => setView("conference")}
              modoDesktop={modoDesktop}
              modoLeve={modoLeve}
            />
          </Suspense>
        ) : (
          <Suspense fallback={LAZY_FALLBACK}>
            <ConferenceView onBack={() => setView("list")} empresa={activeList?.empresa} flag={activeList?.flag} modoDesktop={modoDesktop} />
          </Suspense>
        )}
      </div>

      {showScanner && (
        <Suspense fallback={LAZY_FALLBACK}>
          <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}

      {showPhotoCapture && photoProductId && (
        <Suspense fallback={LAZY_FALLBACK}>
          <PhotoCapture
            photo={activeList?.products.find((p) => p.id === photoProductId)?.photo || null}
            compressionPreset={modoLeve ? "light" : "default"}
            onCapture={(nextPhoto) => {
              if (!photoProductId) return;
              void (async () => {
                const ok = await updateProductPhoto(photoProductId, nextPhoto);
                if (!ok) return;
                setShowPhotoCapture(false);
                setPhotoProductId(null);
              })();
            }}
            onRemove={() => {
              if (!photoProductId) return;
              void (async () => {
                const ok = await updateProductPhoto(photoProductId, null);
                if (!ok) return;
                setShowPhotoCapture(false);
                setPhotoProductId(null);
              })();
            }}
          />
        </Suspense>
      )}

      {/* Popup histórico de compras */}
      {popupCompras && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
          onClick={() => setPopupCompras(null)}
        >
          <div
            style={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 16, padding: 24, width: "100%", maxWidth: 360,
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "hsl(262 80% 50% / 0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ShoppingCart style={{ width: 20, height: 20, color: "hsl(262 80% 50%)" }} />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--foreground))" }}>Histórico de Pedidos</p>
                <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  {popupCompras.carregando ? "Buscando conferências..." : `${popupCompras.ocorrencias.length}x encontrado(s)`}
                </p>
              </div>
            </div>

            {/* Loading */}
            {popupCompras.carregando && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                <Loader2 style={{ display: "inline", width: 18, height: 18, marginRight: 6, verticalAlign: "middle", animation: "spin 1s linear infinite" }} />
                Buscando nos pedidos concluídos...
              </div>
            )}

            {/* Ocorrências */}
            {!popupCompras.carregando && popupCompras.ocorrencias.map((oc, i) => {
              const corStatus = oc.status === "separado" ? "#22c55e" : oc.status === "nao_tem" ? "#ef4444" : oc.status === "parcial" ? "#eab308" : "#9ca3af";
              const labelSt = oc.status === "separado" ? "Separado" : oc.status === "nao_tem" ? "Não tinha" : oc.status === "parcial" ? "Parcial" : oc.status;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "hsl(var(--secondary))", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))" }}>{oc.dataFormatada}</p>
                    {oc.listeiro && <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{oc.listeiro}</p>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: corStatus, background: `${corStatus}22`, borderRadius: 6, padding: "3px 8px" }}>{labelSt}</span>
                </div>
              );
            })}

            {/* Pergunta */}
            <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", marginTop: 16, marginBottom: 10, textAlign: "center" }}>
              Deseja pedir mesmo assim?
            </p>

            {/* Botões Sim / Não */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setPopupCompras(null);
                  setBarcode("");
                  setSemEAN(false);
                  setSku("");
                  clearDraftPhoto();
                  setQuantity("");
                  sessionStorage.removeItem("scan_barcode");
                  sessionStorage.removeItem("scan_sku");
                  sessionStorage.removeItem("scan_quantity");
                }}
                style={{ flex: 1, height: 46, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}
              >
                Não
              </button>
              <button
                onClick={() => setPopupCompras(null)}
                style={{ flex: 1, height: 46, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}
              >
                Sim, pedir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
