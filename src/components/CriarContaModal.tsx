import { useState } from "react";
import { UserPlus, Loader2, Eye, EyeOff, Check } from "lucide-react";
import type { Empresa, LoginFlag } from "@/hooks/useAuth";
import { criarMinhaConta } from "@/lib/usuarios";

const EMPRESAS: Empresa[] = ["NEWSHOP", "SOYE", "FACIL"];

interface Props {
  modoDesktop: boolean;
  onClose: () => void;
  /** Chamado após criar a conta com sucesso; recebe o login criado. */
  onSuccess: (login: string) => void;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
  textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%", height: 48, padding: "0 16px", borderRadius: 10,
  border: "1.5px solid hsl(var(--border))", background: "hsl(var(--secondary))",
  color: "hsl(var(--foreground))", fontFamily: "var(--font-sans)", fontSize: 15,
  fontWeight: 500, outline: "none", boxSizing: "border-box",
};

export default function CriarContaModal({ modoDesktop, onClose, onSuccess }: Props) {
  const [login, setLogin] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [flag, setFlag] = useState<LoginFlag>("loja");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  function toggleEmpresa(emp: Empresa) {
    setErro("");
    setEmpresas((atual) => (atual.includes(emp) ? atual.filter((e) => e !== emp) : [...atual, emp]));
  }

  async function handleCriar() {
    setErro("");
    if (!login.trim() || !nome.trim()) return setErro("Preencha login e nome.");
    if (!senha.trim()) return setErro("Defina uma senha.");
    if (senha.trim().length < 3) return setErro("A senha precisa ter ao menos 3 caracteres.");
    if (empresas.length === 0) return setErro("Selecione ao menos uma empresa.");

    setCarregando(true);
    try {
      await criarMinhaConta({ login: login.trim(), nome: nome.trim(), senha, empresas, flagDefault: flag });
      onSuccess(login.trim().toLowerCase());
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? "");
      if (/login ja existe|unique/i.test(msg)) setErro("Esse login já está em uso. Escolha outro.");
      else if (/empresa/i.test(msg)) setErro("Selecione ao menos uma empresa.");
      else setErro("Não foi possível criar a conta. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: modoDesktop ? "center" : "flex-end",
        justifyContent: "center", zIndex: 1100,
      }}
    >
      <div style={{
        background: "hsl(var(--card))", width: "100%", maxWidth: modoDesktop ? 500 : 430,
        borderRadius: modoDesktop ? 20 : "20px 20px 0 0",
        padding: modoDesktop ? "32px" : "24px 20px 36px",
        animation: modoDesktop ? "fadeIn 0.28s ease" : "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
        margin: modoDesktop ? "auto" : "0", maxHeight: modoDesktop ? "90vh" : "80vh",
        overflowY: "auto",
      }}>
        {!modoDesktop && <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 20px" }} />}

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <UserPlus style={{ width: 22, height: 22, color: "hsl(var(--primary))" }} />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>Criar conta</p>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Você entra como operador</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Nome</label>
            <input type="text" placeholder="Ex: João Silva" value={nome} autoFocus
              onChange={(e) => { setNome(e.target.value); setErro(""); }} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Login</label>
            <input type="text" placeholder="Ex: joao" value={login}
              onChange={(e) => { setLogin(e.target.value); setErro(""); }} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Senha</label>
            <div style={{ position: "relative" }}>
              <input type={mostrarSenha ? "text" : "password"} placeholder="Defina uma senha" value={senha}
                onChange={(e) => { setSenha(e.target.value); setErro(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleCriar()}
                style={{ ...inputStyle, paddingRight: 44 }} />
              <button onClick={() => setMostrarSenha(!mostrarSenha)} type="button"
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex" }}>
                {mostrarSenha ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Empresa(s) onde você trabalha</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {EMPRESAS.map((emp) => {
                const on = empresas.includes(emp);
                return (
                  <button key={emp} type="button" onClick={() => toggleEmpresa(emp)}
                    style={{
                      height: 46, borderRadius: 12, fontWeight: 700, fontSize: 13,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      cursor: "pointer", transition: "all 0.18s", letterSpacing: "0.04em",
                      background: on ? "hsl(var(--foreground))" : "hsl(var(--secondary))",
                      color: on ? "hsl(var(--background))" : "hsl(var(--foreground))",
                      border: on ? "2px solid hsl(var(--foreground))" : "2px solid hsl(var(--border))",
                    }}>
                    {on && <Check style={{ width: 15, height: 15 }} />}
                    {emp}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Tipo</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["loja", "cd"] as LoginFlag[]).map((f) => {
                const on = flag === f;
                return (
                  <button key={f} type="button" onClick={() => setFlag(f)}
                    style={{
                      flex: 1, height: 44, borderRadius: 12, fontWeight: 700, fontSize: 13,
                      cursor: "pointer", transition: "all 0.18s", letterSpacing: "0.04em",
                      background: on ? "hsl(var(--foreground))" : "hsl(var(--secondary))",
                      color: on ? "hsl(var(--background))" : "hsl(var(--foreground))",
                      border: on ? "2px solid hsl(var(--foreground))" : "2px solid hsl(var(--border))",
                    }}>
                    {f.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {erro && (
            <p style={{ fontSize: 12, color: "hsl(var(--destructive))", fontWeight: 700 }}>{erro}</p>
          )}

          <button onClick={handleCriar} disabled={carregando}
            style={{
              width: "100%", height: 52, background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 10,
              fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
              cursor: carregando ? "wait" : "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8, boxShadow: "var(--shadow-md)", marginTop: 4,
              opacity: carregando ? 0.75 : 1,
            }}>
            {carregando ? <Loader2 style={{ width: 18, height: 18 }} /> : <UserPlus style={{ width: 18, height: 18 }} />}
            Criar conta
          </button>

          <button onClick={onClose} type="button"
            style={{ width: "100%", height: 44, background: "transparent", color: "hsl(var(--muted-foreground))", border: "none", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Já tenho conta — voltar ao login
          </button>
        </div>
      </div>
    </div>
  );
}
