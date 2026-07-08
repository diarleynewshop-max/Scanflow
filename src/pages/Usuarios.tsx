import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, RefreshCw, RotateCcw, Save, Users } from "lucide-react";
import { useAuth, type Empresa, type LoginFlag, type UserRole } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getSecoesFixasPorEmpresa } from "@/lib/secoesCompras";
import {
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  redefinirSenhaUsuario,
  type ActorCredenciais,
  type UsuarioAdmin,
  type UsuarioFormPayload,
} from "@/lib/usuarios";

const EMPRESAS: Empresa[] = ["NEWSHOP", "SOYE", "FACIL"];
const ROLES: UserRole[] = ["operador", "compras", "admin", "super"];
const FLAGS: LoginFlag[] = ["loja", "cd"];

const emptyForm: UsuarioFormPayload = {
  login: "",
  nome: "",
  senha: "",
  role: "operador",
  empresas: ["NEWSHOP"],
  flagDefault: "loja",
  secoesCompras: [],
  ativo: true,
};

function labelRole(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    operador: "Operador",
    compras: "Compras",
    admin: "Admin",
    super: "Super",
  };
  return labels[role];
}

export default function Usuarios() {
  const { loginSalvo } = useAuth();
  const { toast } = useToast();
  const [actorSenha, setActorSenha] = useState("");
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [form, setForm] = useState<UsuarioFormPayload>(emptyForm);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [carregando, setCarregando] = useState(false);

  const actor: ActorCredenciais | null = loginSalvo?.login
    ? { login: loginSalvo.login, senha: actorSenha }
    : null;

  const secoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const empresa of form.empresas) {
      getSecoesFixasPorEmpresa(empresa).forEach((secao) => set.add(secao));
    }
    return [...set];
  }, [form.empresas]);

  async function carregarUsuarios(senha = actorSenha) {
    if (!loginSalvo?.login) {
      toast({ title: "Refaca o login", description: "O login salvo nao tem identificador de usuario.", variant: "destructive" });
      return;
    }
    if (!senha.trim()) {
      toast({ title: "Informe sua senha", variant: "destructive" });
      return;
    }

    setCarregando(true);
    try {
      const lista = await listarUsuarios({ login: loginSalvo.login, senha });
      setUsuarios(lista);
      setActorSenha(senha);
      setConfirmado(true);
    } catch (err) {
      toast({
        title: "Acesso negado",
        description: err instanceof Error ? err.message : "Nao foi possivel validar sua senha.",
        variant: "destructive",
      });
    } finally {
      setCarregando(false);
    }
  }

  function editar(usuario: UsuarioAdmin) {
    setEditandoId(usuario.id);
    setForm({
      login: usuario.login,
      nome: usuario.nome,
      senha: "",
      role: usuario.role,
      empresas: usuario.empresas.length > 0 ? usuario.empresas : ["NEWSHOP"],
      flagDefault: usuario.flagDefault,
      secoesCompras: usuario.secoesCompras,
      ativo: usuario.ativo,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function limparForm() {
    setEditandoId(null);
    setForm(emptyForm);
  }

  function toggleEmpresa(empresa: Empresa) {
    setForm((prev) => {
      const exists = prev.empresas.includes(empresa);
      const empresas = exists ? prev.empresas.filter((item) => item !== empresa) : [...prev.empresas, empresa];
      return { ...prev, empresas: empresas.length > 0 ? empresas : prev.empresas };
    });
  }

  function toggleSecao(secao: string) {
    setForm((prev) => ({
      ...prev,
      secoesCompras: prev.secoesCompras.includes(secao)
        ? prev.secoesCompras.filter((item) => item !== secao)
        : [...prev.secoesCompras, secao],
    }));
  }

  async function salvarUsuario() {
    if (!actor) return;
    if (!form.nome.trim() || (!editandoId && !form.login.trim())) {
      toast({ title: "Preencha login e nome", variant: "destructive" });
      return;
    }
    if (!editandoId && !form.senha?.trim()) {
      toast({ title: "Informe a senha inicial", variant: "destructive" });
      return;
    }
    if (form.empresas.length === 0) {
      toast({ title: "Selecione pelo menos uma loja", variant: "destructive" });
      return;
    }

    setCarregando(true);
    try {
      if (editandoId) {
        await atualizarUsuario(actor, editandoId, form);
        toast({ title: "Usuario atualizado" });
      } else {
        await criarUsuario(actor, form);
        toast({ title: "Usuario criado" });
      }
      limparForm();
      await carregarUsuarios();
    } catch (err) {
      toast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setCarregando(false);
    }
  }

  async function redefinirSenha(id: string) {
    if (!actor) return;
    if (!novaSenha.trim()) {
      toast({ title: "Informe a nova senha", variant: "destructive" });
      return;
    }

    setCarregando(true);
    try {
      await redefinirSenhaUsuario(actor, id, novaSenha);
      setResetId(null);
      setNovaSenha("");
      toast({ title: "Senha redefinida" });
    } catch (err) {
      toast({
        title: "Falha ao redefinir",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 16px 56px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
            Admin
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "hsl(var(--foreground))", margin: "4px 0 0" }}>
            Usuarios
          </h1>
        </div>
        {confirmado && (
          <button
            onClick={() => carregarUsuarios()}
            disabled={carregando}
            style={{ height: 40, padding: "0 14px", borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700 }}
          >
            <RefreshCw size={15} /> Atualizar
          </button>
        )}
      </div>

      {!confirmado ? (
        <section style={{ maxWidth: 420, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 18 }}>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 8 }}>
            Confirme sua senha
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={senhaVisivel ? "text" : "password"}
              value={actorSenha}
              onChange={(event) => setActorSenha(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && carregarUsuarios()}
              autoFocus
              style={{ width: "100%", height: 46, borderRadius: 10, border: "1.5px solid hsl(var(--border))", background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", padding: "0 44px 0 14px", boxSizing: "border-box" }}
            />
            <button
              type="button"
              onClick={() => setSenhaVisivel((value) => !value)}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "hsl(var(--muted-foreground))", cursor: "pointer", display: "flex" }}
            >
              {senhaVisivel ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={() => carregarUsuarios()}
            disabled={carregando}
            style={{ width: "100%", height: 46, marginTop: 12, borderRadius: 10, border: 0, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontWeight: 800, cursor: "pointer" }}
          >
            Validar
          </button>
        </section>
      ) : (
        <>
          <section style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 18, marginBottom: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
              <Field label="Login">
                <input value={form.login} disabled={!!editandoId} onChange={(event) => setForm((prev) => ({ ...prev, login: event.target.value }))} style={inputStyle} />
              </Field>
              <Field label="Nome">
                <input value={form.nome} onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))} style={inputStyle} />
              </Field>
              {!editandoId && (
                <Field label="Senha inicial">
                  <input type="password" value={form.senha ?? ""} onChange={(event) => setForm((prev) => ({ ...prev, senha: event.target.value }))} style={inputStyle} />
                </Field>
              )}
              <Field label="Role">
                <select value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))} style={inputStyle}>
                  {ROLES.map((role) => <option key={role} value={role}>{labelRole(role)}</option>)}
                </select>
              </Field>
              <Field label="Flag">
                <select value={form.flagDefault} onChange={(event) => setForm((prev) => ({ ...prev, flagDefault: event.target.value as LoginFlag }))} style={inputStyle}>
                  {FLAGS.map((flag) => <option key={flag} value={flag}>{flag.toUpperCase()}</option>)}
                </select>
              </Field>
            </div>

            <div style={{ marginTop: 14 }}>
              <Label>Lojas</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {EMPRESAS.map((empresa) => {
                  const selected = form.empresas.includes(empresa);
                  return <Chip key={empresa} selected={selected} onClick={() => toggleEmpresa(empresa)}>{empresa}</Chip>;
                })}
              </div>
            </div>

            {form.role === "compras" && (
              <div style={{ marginTop: 14 }}>
                <Label>Secoes de compras</Label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {secoesDisponiveis.map((secao) => (
                    <Chip key={secao} selected={form.secoesCompras.includes(secao)} onClick={() => toggleSecao(secao)}>
                      {secao}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <Chip selected={form.ativo} onClick={() => setForm((prev) => ({ ...prev, ativo: !prev.ativo }))}>
                {form.ativo ? "Ativo" : "Inativo"}
              </Chip>
              <button onClick={salvarUsuario} disabled={carregando} style={primaryButtonStyle}>
                {editandoId ? <Save size={16} /> : <Plus size={16} />} {editandoId ? "Salvar" : "Criar usuario"}
              </button>
              {editandoId && (
                <button onClick={limparForm} style={secondaryButtonStyle}>
                  <RotateCcw size={16} /> Cancelar edicao
                </button>
              )}
            </div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {usuarios.map((usuario) => (
              <article key={usuario.id} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: "hsl(var(--primary) / 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--primary))", flexShrink: 0 }}>
                    <Users size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--foreground))" }}>{usuario.nome}</p>
                    <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{usuario.login} · {labelRole(usuario.role)}</p>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: usuario.ativo ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                    {usuario.ativo ? "ATIVO" : "INATIVO"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  {usuario.empresas.map((empresa) => <Tag key={empresa}>{empresa}</Tag>)}
                  <Tag>{usuario.flagDefault.toUpperCase()}</Tag>
                  {usuario.secoesCompras.map((secao) => <Tag key={secao}>{secao}</Tag>)}
                </div>
                {resetId === usuario.id ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12 }}>
                    <input type="password" value={novaSenha} onChange={(event) => setNovaSenha(event.target.value)} placeholder="Nova senha" style={inputStyle} />
                    <button onClick={() => redefinirSenha(usuario.id)} style={primaryIconButtonStyle}><Check size={16} /></button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={() => editar(usuario)} style={secondaryButtonStyle}><Pencil size={15} /> Editar</button>
                    <button onClick={() => { setResetId(usuario.id); setNovaSenha(""); }} style={secondaryButtonStyle}>Senha</button>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", display: "block", marginBottom: 6 }}>
      {children}
    </label>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 34,
        padding: "0 12px",
        borderRadius: 9,
        border: selected ? "1.5px solid hsl(var(--primary))" : "1.5px solid hsl(var(--border))",
        background: selected ? "hsl(var(--primary) / 0.1)" : "hsl(var(--secondary))",
        color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
        fontSize: 12,
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--muted-foreground))", background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "4px 7px" }}>
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  borderRadius: 10,
  border: "1.5px solid hsl(var(--border))",
  background: "hsl(var(--secondary))",
  color: "hsl(var(--foreground))",
  padding: "0 12px",
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: 0,
  background: "hsl(var(--primary))",
  color: "hsl(var(--primary-foreground))",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--secondary))",
  color: "hsl(var(--foreground))",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  fontWeight: 700,
  cursor: "pointer",
};

const primaryIconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: 0,
  background: "hsl(var(--primary))",
  color: "hsl(var(--primary-foreground))",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
