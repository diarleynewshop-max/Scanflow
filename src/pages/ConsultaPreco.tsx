import { lazy, Suspense, useCallback, useState } from "react";
import { ArrowLeft, BadgeDollarSign, Loader2, Search, Tags } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BarcodeInput from "@/components/BarcodeInput";
import { obterLoginSalvo } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getCompanyLogo, getCompanyName } from "@/lib/companyTheme";
import {
  consultarPrecoProdutoVarejoFacil,
  type ConsultaPrecoVarejoFacilProduto,
} from "@/lib/varejoFacilIntegration";

const BarcodeScanner = lazy(() => import("@/components/BarcodeScanner"));

type ModoConsulta = "simples" | "completa";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatMoney = (value: number) => currency.format(Number.isFinite(value) ? value : 0);

const ConsultaPreco = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const login = obterLoginSalvo();
  const logoEmpresa = getCompanyLogo(login?.empresa);
  const nomeEmpresaLogo = getCompanyName(login?.empresa);
  const [modo, setModo] = useState<ModoConsulta>("simples");
  const [codigo, setCodigo] = useState("");
  const [produto, setProduto] = useState<ConsultaPrecoVarejoFacilProduto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  const consultar = useCallback(
    async (codigoInformado = codigo) => {
      const codigoLimpo = codigoInformado.trim();
      if (!codigoLimpo) {
        toast({ title: "Informe o codigo", description: "Digite ou leia um codigo de barras." });
        return;
      }

      setCodigo(codigoLimpo);
      setLoading(true);
      setError(null);
      setProduto(null);

      try {
        const resultado = await consultarPrecoProdutoVarejoFacil(
          codigoLimpo,
          { empresa: login?.empresa ?? "NEWSHOP", flag: login?.flag ?? "loja" },
          modo === "completa"
        );

        if (!resultado) {
          setError("Produto nao encontrado.");
          return;
        }

        setProduto(resultado);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao consultar preco.";
        console.error("Erro na consulta de preco:", err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [codigo, login?.empresa, login?.flag, modo, toast]
  );

  const handleDetected = (code: string) => {
    setShowScanner(false);
    setCodigo(code);
    void consultar(code);
  };

  return (
    <div className="min-h-screen max-w-md mx-auto flex flex-col bg-background">
      <header className="bg-primary px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="w-9 h-9 rounded-full bg-primary-foreground/10 flex items-center justify-center"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-primary-foreground" />
          </button>
          <img src={logoEmpresa} alt={nomeEmpresaLogo} className="h-9 object-contain" />
        </div>
        <div className="text-right">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-primary-foreground/55">
            Consulta Preco
          </p>
          <p className="text-xs font-semibold text-primary-foreground/85">
            {login?.empresa ?? "NEWSHOP"} · {(login?.flag ?? "loja").toUpperCase()}
          </p>
        </div>
      </header>

      <main className="flex-1 p-5 space-y-5">
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BadgeDollarSign className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">CONSULTA PRECO</h1>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => {
                setModo("simples");
                setProduto(null);
                setError(null);
              }}
              className={`h-11 rounded-lg text-sm font-bold border ${
                modo === "simples"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-foreground border-border"
              }`}
            >
              Simples
            </button>
            <button
              onClick={() => {
                setModo("completa");
                setProduto(null);
                setError(null);
              }}
              className={`h-11 rounded-lg text-sm font-bold border ${
                modo === "completa"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-foreground border-border"
              }`}
            >
              Completa
            </button>
          </div>

          <div className="space-y-3">
            <BarcodeInput
              value={codigo}
              onChange={setCodigo}
              onScanPress={() => setShowScanner(true)}
              onEnterPress={() => void consultar()}
            />

            <button
              onClick={() => void consultar()}
              disabled={loading}
              className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              Consultar
            </button>
          </div>
        </section>

        {loading && (
          <div className="rounded-lg border bg-card p-5 text-center text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-primary" />
            Consultando produto...
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        {produto && !loading && (
          <section className="rounded-lg border bg-card p-4 shadow-sm space-y-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground mb-1">
                Descricao
              </p>
              <h2 className="text-base font-bold text-foreground leading-snug">{produto.descricao}</h2>
              <p className="text-xs text-muted-foreground mt-1">EAN {produto.codigo_barras}</p>
            </div>

            {modo === "completa" && (
              <div className="grid grid-cols-2 gap-3">
                <InfoBox label="Secao" value={produto.secao || "Nao informado"} />
                <InfoBox label="Grupo" value={produto.grupo || "Nao informado"} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <PriceBox label="Preco Varejo" value={formatMoney(produto.precoVarejo)} />
              <PriceBox label="Preco Atacado" value={formatMoney(produto.precoAtacado)} />
            </div>
          </section>
        )}
      </main>

      {showScanner && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-background p-6">Carregando scanner...</div>}>
          <BarcodeScanner onDetected={handleDetected} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}
    </div>
  );
};

const InfoBox = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-secondary border border-border p-3 min-h-[74px]">
    <div className="flex items-center gap-1.5 mb-1">
      <Tags className="w-3.5 h-3.5 text-primary" />
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
    </div>
    <p className="text-sm font-bold text-foreground leading-snug break-words">{value}</p>
  </div>
);

const PriceBox = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 min-h-[82px]">
    <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground mb-2">{label}</p>
    <p className="text-lg font-black text-primary leading-tight">{value}</p>
  </div>
);

export default ConsultaPreco;
