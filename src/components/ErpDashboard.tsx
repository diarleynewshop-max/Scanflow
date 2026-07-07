import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScanBarcode, ClipboardList, GitCompare,
  BadgeDollarSign, Package, CheckCircle2, AlertCircle, TrendingUp,
  RefreshCw, CheckCheck, XCircle, AlertTriangle, Clock,
} from "lucide-react";
import type { LoginData } from "@/hooks/useAuth";

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
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
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

const QUICK_ACTIONS = [
  { icon: ScanBarcode, label: "Escanear", desc: "Ler código de barras", path: "/scanner" },
  { icon: ClipboardList, label: "Lista", desc: "Ver histórico", path: "/scanner?tab=list" },
  { icon: GitCompare, label: "Conferência", desc: "Importar e conferir", path: "/scanner?tab=conference" },
  { icon: BadgeDollarSign, label: "Consulta Preço", desc: "Varejo · Atacado · Grupo", path: "/consulta-preco" },
];

export function ErpDashboard({ loginSalvo }: { loginSalvo: LoginData | null }) {
  const navigate = useNavigate();
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const nome = loginSalvo?.nomePessoa || "usuário";

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
          Resumo das listas, conferências e atividade dos últimos {DAYS} dias.
        </p>
      </div>

      {/* Ações rápidas */}
      <div style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 16,
        padding: "22px 22px",
        boxShadow: "var(--shadow-sm)",
        maxWidth: 420,
      }}>
        <p style={{ ...LABEL_MONO, marginBottom: 14 }}>Acesso Rápido</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {QUICK_ACTIONS.map(({ icon: Icon, label, desc, path }) => (
            <button
              key={label}
              onClick={() => navigate(path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 12px",
                borderRadius: 10,
                background: "transparent",
                border: "1px solid hsl(var(--border))",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "all 0.13s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--secondary))"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 8,
                background: "hsl(var(--secondary))",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <Icon size={16} style={{ color: "hsl(var(--foreground))" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                  lineHeight: 1.2,
                }}>
                  {label}
                </p>
                <p style={{
                  fontSize: 11,
                  color: "hsl(var(--muted-foreground))",
                  marginTop: 2,
                }}>
                  {desc}
                </p>
              </div>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
