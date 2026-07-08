import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { obterLoginSalvo } from "@/hooks/useAuth";
import { applyCompanyTheme } from "@/lib/companyTheme";

const STORAGE_KEY = "scan_newshop_login";

export function EmpresaToggleSF() {
  const [login, setLogin] = useState(() => obterLoginSalvo());

  useEffect(() => {
    const onStorage = () => setLogin(obterLoginSalvo());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!login) return null;
  const elevado = login.role === "compras" || login.role === "admin" || login.role === "super";
  if (!elevado) return null;

  const CICLO: Array<"NEWSHOP" | "SOYE" | "FACIL"> =
    login.empresasPermitidas && login.empresasPermitidas.length > 0
      ? login.empresasPermitidas
      : [login.empresa];
  if (CICLO.length < 2) return null;

  const atualIdx = CICLO.indexOf(login.empresa as any);
  const proxima = CICLO[((atualIdx >= 0 ? atualIdx : 0) + 1) % CICLO.length];

  const trocar = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      data.empresa = proxima;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      applyCompanyTheme(proxima);
      window.location.reload();
    } catch (err) {
      console.error("Erro ao trocar empresa:", err);
    }
  };

  return (
    <button
      onClick={trocar}
      aria-label={`Trocar para ${proxima}`}
      title={`Trocar para ${proxima}`}
      style={{
        position: "fixed",
        top: 16,
        right: 64,
        zIndex: 60,
        height: 36,
        padding: "0 12px",
        borderRadius: 10,
        border: "1.5px solid hsl(var(--border))",
        background: "hsl(var(--card))",
        color: "hsl(var(--foreground))",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <Repeat style={{ width: 14, height: 14 }} />
      <span style={{ opacity: 0.6 }}>{login.empresa}</span>
      <span>→</span>
      <span>{proxima}</span>
    </button>
  );
}

export default EmpresaToggleSF;
