import { useState, useEffect } from "react";
import {
  ClipboardList, Package, TrendingUp, CheckCheck, AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import type { LoginData } from "@/hooks/useAuth";
import { formatDateInputValue } from "@/lib/periodoFiltro";
import { listarDashboardDiario, type DashboardDiarioRow } from "@/lib/dashboardSupabase";

const DAYS = 7;
const DASH_CACHE_TTL = 30 * 60 * 1000;

function isDesktopMode(): boolean {
  try {
    return localStorage.getItem('modoDesktop') === 'true' || window.innerWidth >= 1024;
  } catch { return false; }
}

function lerCacheDash<T>(key: string): T | null {
  if (!isDesktopMode()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, updatedAt } = JSON.parse(raw);
    if (Date.now() - updatedAt > DASH_CACHE_TTL) return null;
    return data as T;
  } catch { return null; }
}

function salvarCacheDash<T>(key: string, data: T): void {
  if (!isDesktopMode()) return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, updatedAt: Date.now() }));
  } catch {}
}

function emptyDays() {
  const out: { dia: string; valor: number }[] = [];
  const hoje = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    out.push({ dia: diaLabel(d), valor: 0 });
  }
  return out;
}


function buildPorDiaFromKpis(porDia: { data: string; valor: number }[]): { dia: string; valor: number }[] {
  return porDia.map(({ data, valor }) => {
    const parts = data.split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return { dia: diaLabel(d), valor };
  });
}

function diaLabel(d: Date) {
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  return `${dias[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}`;
}

const LABEL_MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "hsl(var(--muted-foreground))",
};

interface KpiProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint: string;
  accent?: string;
}

function Kpi({ icon: Icon, label, value, hint, accent = "hsl(var(--foreground))" }: KpiProps) {
  return (
    <div style={{
      flex: 1,
      minWidth: 180,
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 16,
      padding: "20px 22px",
      boxShadow: "var(--shadow-sm)",
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={LABEL_MONO}>{label}</p>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: "hsl(var(--secondary))",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={15} style={{ color: accent }} />
        </div>
      </div>
      <p style={{
        fontFamily: "var(--font-serif)",
        fontSize: 38,
        fontWeight: 900,
        color: "hsl(var(--foreground))",
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{hint}</p>
    </div>
  );
}

function BarChart7Dias({ data, loading }: { data: { dia: string; valor: number }[]; loading?: boolean }) {
  const max = Math.max(1, ...data.map(d => d.valor));
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      gap: 12,
      height: 160,
      padding: "0 4px",
      opacity: loading ? 0.4 : 1,
      transition: "opacity 0.3s",
    }}>
      {data.map((d) => {
        const h = (d.valor / max) * 100;
        return (
          <div key={d.dia} style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            height: "100%",
          }}>
            <div style={{
              flex: 1,
              width: "100%",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}>
              <div style={{
                width: "100%",
                maxWidth: 36,
                height: `${Math.max(h, 4)}%`,
                background: d.valor > 0 ? "hsl(var(--primary))" : "hsl(var(--muted))",
                borderRadius: "6px 6px 0 0",
                transition: "height 0.3s ease",
                position: "relative",
              }}>
                {d.valor > 0 && (
                  <span style={{
                    position: "absolute",
                    top: -18,
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "hsl(var(--foreground))",
                    fontFamily: "var(--font-mono)",
                  }}>
                    {d.valor}
                  </span>
                )}
              </div>
            </div>
            <p style={{
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}>
              {d.dia}
            </p>
          </div>
        );
      })}
    </div>
  );
}


export function ErpDashboard({ loginSalvo }: { loginSalvo: LoginData | null }) {
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const nome = loginSalvo?.nomePessoa || "usuário";

  const empresasResumo = (loginSalvo?.empresasPermitidas && loginSalvo.empresasPermitidas.length > 0)
    ? loginSalvo.empresasPermitidas
    : (loginSalvo?.empresa ? [loginSalvo.empresa] : []);
  const flagResumo = loginSalvo?.flag ?? "loja";
  const empresasKey = empresasResumo.join(",");

  const [resumoLoading, setResumoLoading] = useState(true);
  const [hoje, setHoje] = useState({ conferencias: 0, itens: 0, separado: 0, pendente: 0 });
  const [mes, setMes] = useState({ conferencias: 0, itens: 0 });
  const [porDia, setPorDia] = useState<{ dia: string; valor: number }[]>(() => emptyDays());

  useEffect(() => {
    if (empresasResumo.length === 0) { setResumoLoading(false); return; }
    let cancelado = false;
    const somar = (rows: DashboardDiarioRow[], k: keyof DashboardDiarioRow) =>
      rows.reduce((acc, r) => acc + Number((r[k] as number) ?? 0), 0);

    const hojeStr = formatDateInputValue(new Date());
    const inicioMes = new Date(); inicioMes.setDate(1);
    const inicioMesStr = formatDateInputValue(inicioMes);
    const ini7 = new Date(); ini7.setDate(ini7.getDate() - (DAYS - 1));
    const dataInicio = ini7 < inicioMes ? formatDateInputValue(ini7) : inicioMesStr;

    setResumoLoading(true);
    listarDashboardDiario({ empresas: empresasResumo, flag: flagResumo, dataInicio, dataFim: hojeStr })
      .then((rows) => {
        if (cancelado) return;
        const doHoje = rows.filter((r) => r.data === hojeStr);
        setHoje({
          conferencias: somar(doHoje, "total_conferencias"),
          itens: somar(doHoje, "total_itens"),
          separado: somar(doHoje, "separado"),
          pendente: somar(doHoje, "pendente"),
        });
        const doMes = rows.filter((r) => r.data >= inicioMesStr);
        setMes({ conferencias: somar(doMes, "total_conferencias"), itens: somar(doMes, "total_itens") });

        const porData = new Map<string, number>();
        rows.forEach((r) => porData.set(r.data, (porData.get(r.data) ?? 0) + Number(r.total_conferencias ?? 0)));
        const ultimos: { dia: string; valor: number }[] = [];
        for (let i = DAYS - 1; i >= 0; i--) {
          const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
          ultimos.push({ dia: diaLabel(d), valor: porData.get(formatDateInputValue(d)) ?? 0 });
        }
        setPorDia(ultimos);
      })
      .catch((err) => console.error("[ErpDashboard] Falha ao carregar resumo:", err))
      .finally(() => { if (!cancelado) setResumoLoading(false); });

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresasKey, flagResumo]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1400 }}>
      {/* Saudação */}
      <div>
        <p style={{ ...LABEL_MONO, marginBottom: 6 }}>Painel Principal</p>
        <h1 style={{
          fontFamily: "var(--font-serif)",
          fontSize: 32,
          fontWeight: 900,
          color: "hsl(var(--foreground))",
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}>
          {saudacao}, {nome}.
        </h1>
        <p style={{
          fontSize: 14,
          color: "hsl(var(--muted-foreground))",
          marginTop: 8,
          maxWidth: 560,
          lineHeight: 1.5,
        }}>
          Resumo das listas, conferências e atividade — hoje, no mês e nos últimos {DAYS} dias.
        </p>
      </div>

      {/* Resumo de HOJE */}
      <div>
        <p style={{ ...LABEL_MONO, marginBottom: 12 }}>Hoje</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <Kpi icon={ClipboardList} label="Conferências" value={hoje.conferencias} hint="fechadas hoje" />
          <Kpi icon={Package} label="Itens" value={hoje.itens} hint="conferidos hoje" />
          <Kpi icon={CheckCheck} label="Separado" value={hoje.separado} hint="itens ok" accent="hsl(var(--success))" />
          <Kpi icon={AlertTriangle} label="Pendente" value={hoje.pendente} hint="a resolver" accent="hsl(var(--warning))" />
        </div>
      </div>

      {/* Resumo do MÊS + gráfico 7 dias */}
      <div>
        <p style={{ ...LABEL_MONO, marginBottom: 12 }}>Este mês</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
          <Kpi icon={TrendingUp} label="Conferências" value={mes.conferencias} hint="no mês atual" />
          <Kpi icon={Package} label="Itens" value={mes.itens} hint="no mês atual" />
        </div>
        <div style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 16,
          padding: "22px 22px 18px",
          boxShadow: "var(--shadow-sm)",
        }}>
          <p style={{ ...LABEL_MONO, marginBottom: 18 }}>Conferências · últimos {DAYS} dias</p>
          <BarChart7Dias data={porDia} loading={resumoLoading} />
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
