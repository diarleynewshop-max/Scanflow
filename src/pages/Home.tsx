import { useNavigate, useSearchParams } from "react-router-dom";
import { ScanBarcode, ClipboardList, GitCompare, Trash2, AlertTriangle, Eye, EyeOff, Store, User, ShoppingCart, BarChart3, Settings, Moon, Sun, Monitor, Smartphone, BadgeDollarSign, Download, Shield, Package, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth, type Empresa, type LoginFlag, type LoginResult, type UsuarioLoginContext } from "@/hooks/useAuth";
import { alterarMinhaSenha } from "@/lib/usuarios";
import { hasAnyRoleAccess } from "@/components/ProtectedRoute";
import { getLightModeEnabled, setLightModeEnabled } from "@/lib/lightMode";
import { HISTORICO_COMPRAS_KEY, getHistoricoComprasEnabled } from "@/lib/historicoCompras";
import { useToast } from "@/hooks/use-toast";
import { getCompanyLogo, getCompanyName } from "@/lib/companyTheme";
import { ErpLayout } from "@/components/ErpLayout";
import { ErpDashboard } from "@/components/ErpDashboard";

const STORAGE_KEY = "scan_newshop_lists";
const ACTIVE_KEY  = "scan_newshop_active_list";

function getStorageSize(): { kb: number; hasData: boolean; listCount: number; hasPhotos: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { kb: 0, hasData: false, listCount: 0, hasPhotos: false };
    const kb = Math.round((raw.length * 2) / 1024); // UTF-16 aprox
    const parsed = JSON.parse(raw);
    const listCount = Array.isArray(parsed) ? parsed.filter((l: Record<string, unknown>) => l.status !== "open").length : 0;
    const hasPhotos = Array.isArray(parsed) && parsed.some((l: Record<string, unknown>) =>
      (l.products as Array<Record<string, unknown>> | undefined)?.some((p: Record<string, unknown>) => !!p.photo)
    );
    return { kb, hasData: kb > 0, listCount, hasPhotos };
  } catch {
    return { kb: 0, hasData: false, listCount: 0, hasPhotos: false };
  }
}

// Menu base (sempre visível)
const baseMenuItems = [
  { Icon: ScanBarcode,  label: "Escanear",    description: "Leia códigos e registre produtos",    path: "/scanner",                  accent: "hsl(var(--primary))"     },
  { Icon: BadgeDollarSign, label: "Consulta Preço", description: "Consulte varejo, atacado e grupo", path: "/consulta-preco", accent: "hsl(var(--warning))" },
  { Icon: ClipboardList, label: "Lista",       description: "Visualize e gerencie o histórico",    path: "/scanner?tab=list",          accent: "hsl(var(--success))"     },
  { Icon: Package,      label: "Meus Pedidos", description: "Acompanhe o status dos seus pedidos",  path: "/meus-pedidos",              accent: "hsl(var(--indigo))"      },
  { Icon: GitCompare,   label: "Conferência", description: "Importe e confira listas do ERP",     path: "/scanner?tab=conference",    accent: "hsl(var(--destructive))" },
  { Icon: User,         label: "Perfil",      description: "Visualize seus dados de login",       path: null, accent: "hsl(var(--warning))" },
  { Icon: Settings,     label: "Configuração", description: "Tema, layout e Modo Leve", path: null, accent: "hsl(var(--indigo))" },
];

// Menu para compras (compras, admin, super)
const comprasMenuItems = [
  { Icon: ShoppingCart, label: "Compras",     description: "Gestão de reposição e itens faltantes", path: "/compras", accent: "hsl(var(--indigo))" },
];

// Menu para analytics (admin, super)
const analyticsMenuItems = [
  { Icon: BarChart3,    label: "Dashboard",   description: "Relatórios e gráficos de conferência",  path: "/dashboard", accent: "hsl(var(--violet))" },
];

// Menu exclusivo admin (admin, super) — vazio ate a proxima ferramenta admin-only ser criada.
const adminMenuItems: Array<{ Icon: LucideIcon; label: string; description: string; path: string; accent: string }> = [
  { Icon: Shield, label: "Usuários", description: "Cadastro e acesso por loja", path: "/usuarios", accent: "hsl(var(--destructive))" },
];

// Componente de card do menu
interface MenuCardProps {
  Icon: LucideIcon;
  label: string;
  description: string;
  path: string | null;
  accent: string;
  manutencao?: boolean;
  navigate: (path: string) => void;
  setMostrarPerfil: (show: boolean) => void;
  setMostrarConfiguracoes: (show: boolean) => void;
}

const MenuCard: React.FC<MenuCardProps> = ({
  Icon, label, description, path, accent, manutencao = false, navigate, setMostrarPerfil, setMostrarConfiguracoes
}) => {
  const isDesktop = window.innerWidth >= 768; // Simples check para desktop

  return (
    <button onClick={() => {
      if (path === null) {
        if (label === "Perfil") {
          setMostrarPerfil(true);
        } else if (label === "Configuração") {
          setMostrarConfiguracoes(true);
        }
      } else {
        navigate(path);
      }
    }}
      style={{
        width: "100%",
        display: "flex",
        alignItems: isDesktop ? "flex-start" : "center",
        gap: isDesktop ? 20 : 16,
        padding: isDesktop ? "24px" : "16px 18px",
        borderRadius: isDesktop ? 20 : 16,
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        boxShadow: isDesktop ? "var(--shadow-md)" : "var(--shadow-sm)",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.18s",
        height: isDesktop ? 168 : 80,
        boxSizing: "border-box",
        overflow: "hidden",
        opacity: manutencao ? 0.55 : 1,
        filter: manutencao ? "grayscale(1)" : undefined,
      }}
    >
      <div style={{ 
        width: isDesktop ? 64 : 52, 
        height: isDesktop ? 64 : 52, 
        borderRadius: isDesktop ? 16 : 14, 
        flexShrink: 0, 
        background: accent + (isDesktop ? "20" : "14"), 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center" 
      }}>
        <Icon style={{ width: isDesktop ? 28 : 24, height: isDesktop ? 28 : 24, color: accent }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ 
          fontSize: isDesktop ? 18 : 15, 
          fontWeight: 700, 
          color: "hsl(var(--foreground))", 
          marginBottom: isDesktop ? 8 : 2
        }}>
          {label}
          {manutencao && (
            <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", padding: "2px 6px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Em manutenção
            </span>
          )}
        </p>
        <p style={{
          fontSize: isDesktop ? 13 : 12,
          color: "hsl(var(--muted-foreground))",
          lineHeight: 1.4,
          marginBottom: isDesktop ? 12 : 0,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {description}
        </p>
        {isDesktop && path && (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: accent,
            fontWeight: 600,
            marginTop: "auto",
          }}>
            <span>Acessar</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}
      </div>
      {!isDesktop && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" style={{ opacity: 0.4, flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
};

const Home = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [storage, setStorage] = useState(getStorageSize());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [mostrarPerfil, setMostrarPerfil] = useState(false);
  const [senhaAtualPerfil, setSenhaAtualPerfil] = useState("");
  const [novaSenhaPerfil, setNovaSenhaPerfil] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [msgSenhaPerfil, setMsgSenhaPerfil] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const handleTrocarMinhaSenha = async () => {
    setMsgSenhaPerfil(null);
    if (!loginSalvo?.login) {
      setMsgSenhaPerfil({ tipo: "erro", texto: "Conta sem login no Supabase. Refaça o login." });
      return;
    }
    if (!senhaAtualPerfil.trim() || !novaSenhaPerfil.trim()) {
      setMsgSenhaPerfil({ tipo: "erro", texto: "Preencha a senha atual e a nova." });
      return;
    }
    if (novaSenhaPerfil.trim().length < 3) {
      setMsgSenhaPerfil({ tipo: "erro", texto: "A nova senha é muito curta." });
      return;
    }
    setTrocandoSenha(true);
    try {
      const ok = await alterarMinhaSenha(loginSalvo.login, senhaAtualPerfil, novaSenhaPerfil);
      if (ok) {
        setMsgSenhaPerfil({ tipo: "ok", texto: "Senha alterada com sucesso!" });
        setSenhaAtualPerfil("");
        setNovaSenhaPerfil("");
      } else {
        setMsgSenhaPerfil({ tipo: "erro", texto: "Senha atual incorreta." });
      }
    } catch (err) {
      console.error("[Perfil] Falha ao alterar senha:", err);
      setMsgSenhaPerfil({ tipo: "erro", texto: "Não foi possível alterar a senha agora." });
    } finally {
      setTrocandoSenha(false);
    }
  };

  // Autenticação
  const { 
    loginSalvo, 
    mostrarModalLogin, 
    setMostrarModalLogin, 
    fazerLogin,
    fazerLogout
  } = useAuth();

  // Estados para o formulário de login
  const [empresa, setEmpresa] = useState<Empresa>("NEWSHOP");
  const [flag, setFlag] = useState<LoginFlag>("loja");
  const [loginUsuario, setLoginUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [tituloPadrao, setTituloPadrao] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState(false);
  const [erroLogin, setErroLogin] = useState("");
  const [loginCarregando, setLoginCarregando] = useState(false);
  const [usuarioPendente, setUsuarioPendente] = useState<UsuarioLoginContext | null>(null);

  // Estados para configurações
  const [modoEscuro, setModoEscuro] = useState(() => {
    return localStorage.getItem('modoEscuro') === 'true';
  });
  const [modoDesktop, setModoDesktop] = useState(() => {
    // Sem preferencia salva, segue o tamanho real do aparelho (PC >= 1024px).
    // Se o usuario tiver escolhido no toggle, a escolha dele vence.
    const salvo = localStorage.getItem('modoDesktop');
    if (salvo === 'true') return true;
    if (salvo === 'false') return false;
    return typeof window !== 'undefined' && window.innerWidth >= 1024;
  });
  const [modoLeve, setModoLeve] = useState(() => getLightModeEnabled());
  const [historicoCompras, setHistoricoCompras] = useState(() => getHistoricoComprasEnabled());
  const [mostrarConfiguracoes, setMostrarConfiguracoes] = useState(false);
  const logoEmpresa = getCompanyLogo(loginSalvo?.empresa ?? empresa);
  const nomeEmpresaLogo = getCompanyName(loginSalvo?.empresa ?? empresa);


  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Detecta ?modal=perfil ou ?modal=config (vindo do DesktopShell de outras páginas)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const modal = searchParams.get('modal');
    if (modal === 'perfil') {
      setMostrarPerfil(true);
      searchParams.delete('modal');
      setSearchParams(searchParams, { replace: true });
    } else if (modal === 'config') {
      setMostrarConfiguracoes(true);
      searchParams.delete('modal');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => { setStorage(getStorageSize()); }, []);

  // Aplicar tema ao carregar
  useEffect(() => {
    if (modoEscuro) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [modoEscuro]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "modoEscuro") setModoEscuro(localStorage.getItem("modoEscuro") === "true");
      if (event.key === "modoDesktop") setModoDesktop(localStorage.getItem("modoDesktop") === "true");
      if (event.key === "scan_newshop_light_mode") setModoLeve(getLightModeEnabled());
      if (event.key === HISTORICO_COMPRAS_KEY) setHistoricoCompras(getHistoricoComprasEnabled());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!mostrarModalLogin) return;

    setEmpresa(loginSalvo?.empresa ?? "NEWSHOP");
    setFlag(loginSalvo?.flag ?? "loja");
    setLoginUsuario(loginSalvo?.login ?? "");
    setTituloPadrao(loginSalvo?.flag === "cd" ? "" : (loginSalvo?.tituloPadrao ?? ""));
    setSenha("");
    setMostrarSenha(false);
    setErroSenha(false);
    setErroLogin("");
    setUsuarioPendente(null);
  }, [mostrarModalLogin, loginSalvo]);

  // Funções para configurações
  const toggleModoEscuro = () => {
    const novoModo = !modoEscuro;
    setModoEscuro(novoModo);
    localStorage.setItem('modoEscuro', novoModo.toString());
    // Aplicar tema escuro/claro
    if (novoModo) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleModoDesktop = () => {
    const novoModo = !modoDesktop;
    setModoDesktop(novoModo);
    localStorage.setItem('modoDesktop', novoModo.toString());
    // Aqui você pode adicionar lógica para alternar entre layouts mobile/desktop
  };

  const toggleModoLeve = () => {
    const novoModo = !modoLeve;
    setModoLeve(novoModo);
    setLightModeEnabled(novoModo);
  };

  const toggleHistoricoCompras = () => {
    const novo = !historicoCompras;
    setHistoricoCompras(novo);
    localStorage.setItem(HISTORICO_COMPRAS_KEY, novo.toString());
  };


  const baixarAtalhoApp = () => {
    const appUrl = `${window.location.origin}/`;
    const nomeEmpresa = loginSalvo?.empresa || "NEWSHOP";
    const shortcut = [
      "[InternetShortcut]",
      `URL=${appUrl}`,
      "IconIndex=0",
      "",
    ].join("\r\n");

    const blob = new Blob([shortcut], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SCAN ${nomeEmpresa}.url`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast({
      title: "Atalho baixado",
      description: "Mova o arquivo para a Area de Trabalho para abrir o app direto.",
    });
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    setStorage(getStorageSize());
    setConfirmOpen(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 3000);
  };

  const handleLogin = async () => {
    if (!loginUsuario.trim()) {
      setErroSenha(true);
      setErroLogin("Informe o login.");
      return;
    }

    if (!senha.trim()) {
      setErroSenha(true);
      setErroLogin("Informe a senha.");
      return;
    }

    const empresasPermitidas = usuarioPendente?.empresasPermitidas ?? [];
    const flagLogin = usuarioPendente?.flagDefault ?? flag;
    const empresaSelecionada = usuarioPendente
      ? (empresasPermitidas.length === 1 ? empresasPermitidas[0] : empresa)
      : undefined;

    if (usuarioPendente && flagLogin === "loja" && !tituloPadrao.trim()) {
      toast({ title: "Informe a secao", variant: "destructive" });
      return;
    }

    setLoginCarregando(true);
    setErroSenha(false);
    setErroLogin("");

    const resultado = await fazerLogin({
      login: loginUsuario,
      senha,
      empresaSelecionada,
      tituloPadrao: flagLogin === "cd" ? "CD" : tituloPadrao.trim(),
      flag: flagLogin,
    });

    setLoginCarregando(false);

    if (resultado.sucesso) {
      setUsuarioPendente(null);
      setSenha("");
      setErroLogin("");
      return;
    }

    const falha = resultado as Extract<LoginResult, { sucesso: false }>;

    if (falha.contexto) {
      setUsuarioPendente(falha.contexto);
      setFlag(falha.contexto.flagDefault);
      if (falha.contexto.flagDefault === "loja" && falha.contexto.secaoPadrao && !tituloPadrao.trim()) {
        setTituloPadrao(falha.contexto.secaoPadrao);
      }
      if (!falha.contexto.empresasPermitidas.includes(empresa)) {
        setEmpresa(falha.contexto.empresasPermitidas[0]);
      }
    }

    if (falha.motivo === "selecionar_empresa") {
      setErroLogin("Selecione a loja permitida para este usuario.");
      return;
    }

    if (falha.motivo === "titulo_obrigatorio") {
      setErroLogin("Informe a secao da lista.");
      return;
    }

    if (falha.motivo === "supabase_nao_configurado") {
      toast({ title: "Supabase nao configurado", variant: "destructive" });
      setErroLogin("Supabase nao configurado.");
      return;
    }

    if (falha.motivo === "empresa_nao_permitida") {
      setErroLogin("Esta loja nao esta liberada para o usuario.");
      return;
    }

    if (falha.motivo === "credencial_invalida") {
      setErroSenha(true);
      setErroLogin("Login ou senha invalidos.");
    }
  };

  const empresasPermitidasLogin = usuarioPendente?.empresasPermitidas ?? [];
  const flagLogin = usuarioPendente?.flagDefault ?? flag;

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto" style={{ background: "hsl(var(--background))" }}>

      {/* Layout ERP Desktop (auto em telas ≥1024px) */}
      {isDesktop && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
          <ErpLayout
            loginSalvo={loginSalvo}
            logoEmpresa={logoEmpresa}
            nomeEmpresaLogo={nomeEmpresaLogo}
            setMostrarPerfil={setMostrarPerfil}
            setMostrarConfiguracoes={setMostrarConfiguracoes}
            fazerLogout={fazerLogout}
            pageTitle="Início"
          >
            <ErpDashboard loginSalvo={loginSalvo} />
          </ErpLayout>
        </div>
      )}

      {/* Conteúdo mobile (oculto em desktop) */}
      <div style={{ display: isDesktop ? 'none' : 'contents' }}>

      {/* â”€â”€ Header â”€â”€ */}
      <header className={`relative overflow-hidden ${modoDesktop ? 'pt-6 pb-8 px-8' : 'pt-5 pb-7 px-5'} bg-primary text-primary-foreground border-b border-border`}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "currentColor", opacity: 0.05, pointerEvents: "none" }} />
        <div className={`${modoDesktop ? 'flex items-center justify-between' : ''}`}>
          <div>
            <img 
              src={logoEmpresa} 
              alt={nomeEmpresaLogo} 
              className={`${modoDesktop ? 'h-12' : 'h-10'} object-contain`}
            />
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-60 mt-2">
              Sistema de Pedido
            </p>
          </div>
          
          {modoDesktop && loginSalvo && (
            <div className="flex items-center gap-4">
              <div className="px-4 py-2 bg-primary-foreground/10 rounded-lg">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="text-sm font-medium">{loginSalvo.nomePessoa || "Usuário"}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Store className="h-3 w-3" />
                  <span className="text-xs opacity-80">
                    {loginSalvo.empresa} · {(loginSalvo.flag ?? "loja").toUpperCase()}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-primary-foreground/20 rounded">
                    {loginSalvo.role ? loginSalvo.role.charAt(0).toUpperCase() + loginSalvo.role.slice(1) : "Operador"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* â”€â”€ Greeting â”€â”€ */}
      <div style={{ padding: modoDesktop ? "32px 32px 16px" : "28px 20px 8px" }}>
        <div className={`${modoDesktop ? 'flex items-end justify-between' : ''}`}>
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6 }}>
              Menu Principal
            </p>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: modoDesktop ? 32 : 26, fontWeight: 900, color: "hsl(var(--foreground))", lineHeight: 1.15 }}>
              O que deseja fazer?
            </h2>
            {modoDesktop && (
              <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 8, maxWidth: "600px" }}>
                Acesse todas as funcionalidades do sistema de pedidos, conferência e gestão de compras em uma interface otimizada para desktop.
              </p>
            )}
          </div>
          
          {modoDesktop && (
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${modoEscuro ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'}`}>
                {modoEscuro ? 'Modo Escuro' : 'Modo Claro'}
              </div>
              <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                 Modo Desktop
              </div>
            </div>
          )}
        </div>
      </div>

       {/* â”€â”€ Menu Cards â”€â”€ */}
        <div style={{ 
          flex: 1,
          padding: modoDesktop ? "16px 32px 24px" : "12px 16px 8px",
          display: "grid",
          gridTemplateColumns: modoDesktop ? "repeat(3, 1fr)" : "1fr",
          gap: modoDesktop ? 20 : 12,
          alignItems: "stretch",
        }}>
          {/* Cards base — filtrados por flag para operadores */}
          {baseMenuItems
            .filter(({ label }) => {
              const isPrivileged = loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['compras', 'admin', 'super']);
              if (isPrivileged) return true;
              const userFlag = loginSalvo?.flag ?? 'loja';
              if (label === 'Escanear' || label === 'Lista') return true;
              if (label === 'Conferência') return userFlag === 'cd';
              if (label === 'Meus Pedidos') return userFlag === 'loja';
              return true; // Consulta Preço, Perfil, Configuração sempre visíveis
            })
            .map(({ Icon, label, description, path, accent }) => (
            <div key={label}>
              <MenuCard
                Icon={Icon}
                label={label}
                description={description}
                path={path}
                accent={accent}
                navigate={navigate}
                setMostrarPerfil={setMostrarPerfil}
                setMostrarConfiguracoes={setMostrarConfiguracoes}
              />
            </div>
          ))}
          
          {/* Cards para compras (se tiver acesso) */}
          {loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['compras', 'admin', 'super']) && (
            comprasMenuItems.map(({ Icon, label, description, path, accent }) => (
              <div key={label}>
                <MenuCard 
                  Icon={Icon}
                  label={label}
                  description={description}
                  path={path}
                  accent={accent}
                  navigate={navigate}
                  setMostrarPerfil={setMostrarPerfil}
                  setMostrarConfiguracoes={setMostrarConfiguracoes}
                />
              </div>
            ))
          )}
          
          {/* Cards para analytics (se tiver acesso) */}
          {loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['compras', 'admin', 'super']) && (
            analyticsMenuItems.map(({ Icon, label, description, path, accent }) => (
              <div key={label}>
                <MenuCard
                  Icon={Icon}
                  label={label}
                  description={description}
                  path={path}
                  accent={accent}
                  navigate={navigate}
                  setMostrarPerfil={setMostrarPerfil}
                  setMostrarConfiguracoes={setMostrarConfiguracoes}
                />
              </div>
            ))
          )}

          {/* Cards exclusivos admin */}
          {loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['admin', 'super']) && (
            adminMenuItems.map(({ Icon, label, description, path, accent }) => (
              <div key={label}>
                <MenuCard
                  Icon={Icon}
                  label={label}
                  description={description}
                  path={path}
                  accent={accent}
                  navigate={navigate}
                  setMostrarPerfil={setMostrarPerfil}
                  setMostrarConfiguracoes={setMostrarConfiguracoes}
                />
              </div>
            ))
          )}
        </div>

      {/* â”€â”€ Storage Card â”€â”€ */}
      <div style={{ padding: modoDesktop ? "16px 32px 32px" : "8px 16px 24px" }}>
        <div style={{
          background: "hsl(var(--card))",
          borderRadius: modoDesktop ? 20 : 16, 
          border: "1px solid hsl(var(--border))",
          padding: modoDesktop ? "24px" : "16px 18px", 
          boxShadow: modoDesktop ? "var(--shadow-md)" : "var(--shadow-sm)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 3 }}>
                Armazenamento Local
              </p>
              {storage.hasData ? (
                <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 900 }}>{storage.kb}</span>
                  <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>KB · {storage.listCount} lista(s) no histórico</span>
                </p>
              ) : (
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Nenhum dado salvo</p>
              )}
              {storage.hasPhotos && (
                <p style={{ fontSize: 11, color: "hsl(var(--warning))", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  <AlertTriangle style={{ width: 11, height: 11 }} /> Contém fotos (pesado)
                </p>
              )}
            </div>

            {storage.hasData && (
              <button onClick={() => setConfirmOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 10,
                  background: "hsl(var(--destructive) / 0.08)",
                  color: "hsl(var(--destructive))",
                  border: "1px solid hsl(var(--destructive) / 0.2)",
                  fontWeight: 700, fontSize: 12, cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <Trash2 style={{ width: 14, height: 14 }} /> Limpar
              </button>
            )}
          </div>

          {/* barra de uso */}
          {storage.hasData && (
            <div style={{ height: 4, background: "hsl(var(--muted))", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2, transition: "width 0.4s ease",
                width: `${Math.min((storage.kb / 5000) * 100, 100)}%`,
                background: storage.kb > 2000 ? "hsl(var(--destructive))" : storage.kb > 500 ? "hsl(var(--warning))" : "hsl(var(--success))",
              }} />
            </div>
          )}
        </div>

        {/* Toast de sucesso */}
        {cleared && (
          <div style={{
            marginTop: 10, padding: "10px 16px", borderRadius: 10,
            background: "hsl(var(--success) / 0.1)", border: "1px solid hsl(var(--success) / 0.2)",
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 13, fontWeight: 600, color: "hsl(var(--success))",
          }}>
            ✅ Cache limpo com sucesso!
          </div>
        )}
      </div>

      {/* â”€â”€ Footer â”€â”€ */}
      <div style={{ 
        padding: modoDesktop ? "0 32px 32px" : "0 20px 24px", 
        textAlign: "center",
        borderTop: modoDesktop ? "1px solid hsl(var(--border))" : "none",
        marginTop: modoDesktop ? 16 : 0,
        paddingTop: modoDesktop ? 24 : 0
      }}>
        <div className={`${modoDesktop ? 'flex items-center justify-between' : ''}`}>
          <p style={{ 
            fontFamily: "var(--font-mono)", 
            fontSize: modoDesktop ? 11 : 10, 
            color: "hsl(var(--muted-foreground))", 
            letterSpacing: "0.1em" 
          }}>
            Diarley Duarte Â© 2025
          </p>
          {modoDesktop && (
            <div className="flex items-center gap-6">
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                Versão 2.1.0
              </span>
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                {loginSalvo?.empresa || "NEWSHOP"}
              </span>
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                {modoEscuro ? "Modo Escuro" : "Modo Claro"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* â”€â”€ Modal Confirmação â”€â”€ */}
      </div>{/* fim conteúdo mobile */}

      {confirmOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)", display: "flex",
            alignItems: "flex-end", justifyContent: "center", zIndex: 100,
          }}
        >
          <div style={{
            background: "hsl(var(--card))",
            width: "100%", maxWidth: 430,
            borderRadius: "20px 20px 0 0", padding: "24px 20px 36px",
            animation: "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
          }}>
            <style>{`@keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 20px" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "hsl(var(--destructive) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Trash2 style={{ width: 22, height: 22, color: "hsl(var(--destructive))" }} />
              </div>
              <div>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>Limpar cache?</p>
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Esta ação não pode ser desfeita.</p>
              </div>
            </div>

            <div style={{ background: "hsl(var(--destructive) / 0.06)", border: "1px solid hsl(var(--destructive) / 0.15)", borderRadius: 10, padding: "12px 14px", marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: "hsl(var(--foreground))", lineHeight: 1.6 }}>
                Serão apagados: <strong>{storage.listCount} lista(s)</strong> do histórico e todos os dados salvos no celular (<strong>{storage.kb} KB</strong>).
                {storage.hasPhotos && <span style={{ color: "hsl(var(--destructive))" }}> Inclui fotos.</span>}
              </p>
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 6 }}>
                âš ï¸ Listas já enviadas ao ClickUp <strong>não</strong> serão afetadas.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)}
                style={{ height: 50, borderRadius: 12, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button onClick={handleClear}
                style={{ height: 50, borderRadius: 12, background: "hsl(var(--destructive))", color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 4px 14px hsl(var(--destructive) / 0.3)" }}
              >
                Limpar tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Modal de Login â”€â”€ */}
      {mostrarModalLogin && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setMostrarModalLogin(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)", display: "flex",
            alignItems: modoDesktop ? "center" : "flex-end", 
            justifyContent: "center", 
            zIndex: 1000,
          }}
        >
          <div style={{
            background: "hsl(var(--card))",
            width: "100%", 
            maxWidth: modoDesktop ? 500 : 430,
            borderRadius: modoDesktop ? 20 : "20px 20px 0 0", 
            padding: modoDesktop ? "32px" : "24px 20px 36px",
             animation: modoDesktop ? "fadeIn 0.28s ease" : "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
            margin: modoDesktop ? "auto" : "0",
            maxHeight: modoDesktop ? "90vh" : "auto",
            overflowY: modoDesktop ? "auto" : "visible",
          }}>
            <style>{`
              @keyframes slideUp{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
              @keyframes fadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}
            `}</style>
            {!modoDesktop && <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 20px" }} />}

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Store style={{ width: 22, height: 22, color: "hsl(var(--primary))" }} />
              </div>
              <div>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>Faça seu login</p>
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Configure seus dados para começar</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Login</label>
                <input
                  type="text"
                  placeholder="Ex: joao"
                  value={loginUsuario}
                  onChange={(e) => { setLoginUsuario(e.target.value); setErroSenha(false); setErroLogin(""); setUsuarioPendente(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  autoFocus
                  style={{
                    width: "100%", height: 48, padding: "0 16px",
                    borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                    background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                    fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                    outline: "none", boxSizing: "border-box",
                    borderColor: erroSenha && !loginUsuario.trim() ? "hsl(var(--destructive))" : "hsl(var(--border))",
                  }}
                />
              </div>

              <div>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Senha</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={mostrarSenha ? "text" : "password"}
                      placeholder="Digite a senha"
                      data-tut="login-senha"
                      value={senha}
                      onChange={(e) => { setSenha(e.target.value); setErroSenha(false); setErroLogin(""); setUsuarioPendente(null); }}
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                      style={{
                        width: "100%", height: 48, padding: "0 16px",
                        borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                        background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                        fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                        outline: "none", boxSizing: "border-box",
                        borderColor: erroSenha ? "hsl(var(--destructive))" : "hsl(var(--border))",
                        paddingRight: 44,
                      }}
                    />
                    <button
                      onClick={() => setMostrarSenha(!mostrarSenha)}
                      style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex" }}
                    >
                      {mostrarSenha ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                    </button>
                  </div>
                </div>
                {erroSenha && (
                  <p style={{ fontSize: 12, color: "hsl(var(--destructive))", marginTop: 5, fontWeight: 600 }}>Login ou senha invalidos.</p>
                )}
              </div>

              {empresasPermitidasLogin.length > 0 && (
                <div data-tut="login-empresa">
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Empresa</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {empresasPermitidasLogin.map((emp) => (
                      <button key={emp} onClick={() => { setEmpresa(emp); setErroLogin(""); }}
                        style={{
                          height: 46, borderRadius: 12, fontWeight: 700, fontSize: 13,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", transition: "all 0.18s",
                          background: empresa === emp ? "hsl(var(--foreground))" : "hsl(var(--secondary))",
                          color: empresa === emp ? "hsl(var(--background))" : "hsl(var(--foreground))",
                          border: empresa === emp ? "2px solid hsl(var(--foreground))" : "2px solid hsl(var(--border))",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {emp}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {usuarioPendente && (
                <div>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Perfil</label>
                  <div style={{
                    width: "100%", height: 48, padding: "0 16px",
                    borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                    background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                    fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600,
                    display: "flex", alignItems: "center", boxSizing: "border-box",
                  }}>
                    {usuarioPendente.nome} · {usuarioPendente.role} · {flagLogin.toUpperCase()}
                  </div>
                </div>
              )}

              {usuarioPendente && flagLogin === "loja" && (
                <div>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Secao</label>
                  <input
                    type="text"
                    placeholder="Ex: Utilidade"
                    data-tut="login-lista"
                    value={tituloPadrao}
                    onChange={(e) => setTituloPadrao(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    style={{
                      width: "100%", height: 48, padding: "0 16px",
                      borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                      background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                      outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {erroLogin && !erroSenha && (
                <p style={{ fontSize: 12, color: "hsl(var(--destructive))", fontWeight: 700 }}>
                  {erroLogin}
                </p>
              )}

              {/* Botão de login */}
              <button onClick={handleLogin}
                disabled={loginCarregando}
                data-tut="login-salvar"
                style={{
                  width: "100%", height: 52, background: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))", border: "none",
                  borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                  cursor: loginCarregando ? "wait" : "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 8, transition: "all 0.18s",
                  boxShadow: "var(--shadow-md)", marginTop: 8,
                  opacity: loginCarregando ? 0.75 : 1,
                }}
              >
                {loginCarregando ? <Loader2 style={{ width: 18, height: 18 }} /> : <Store style={{ width: 18, height: 18 }} />}
                {usuarioPendente ? "Entrar" : "Validar Login"}
              </button>

              <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", marginTop: 8 }}>
                A senha nao fica salva neste aparelho.
              </p>
            </div>
          </div>
        </div>
      )}

       {/* â”€â”€ Modal de Perfil â”€â”€ */}
      {mostrarPerfil && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setMostrarPerfil(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)", display: "flex",
            alignItems: modoDesktop ? "center" : "flex-end", 
            justifyContent: "center", 
            zIndex: 1000,
          }}
        >
          <div style={{
            background: "hsl(var(--card))",
            width: "100%", 
            maxWidth: modoDesktop ? 500 : 430,
            borderRadius: modoDesktop ? 20 : "20px 20px 0 0", 
            padding: modoDesktop ? "32px" : "24px 20px 36px",
            animation: modoDesktop ? "fadeIn 0.28s ease" : "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
            margin: modoDesktop ? "auto" : "0",
            maxHeight: modoDesktop ? "90vh" : "auto",
            overflowY: modoDesktop ? "auto" : "visible",
          }}>
            {!modoDesktop && <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 20px" }} />}

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "hsl(var(--warning) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <User style={{ width: 22, height: 22, color: "hsl(var(--warning))" }} />
              </div>
              <div>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>Seu Perfil</p>
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Dados salvos para uso automático</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              
              {/* Dados do perfil */}
              {loginSalvo ? (
                <>
                  <div style={{ background: "hsl(var(--success) / 0.08)", border: "1px solid hsl(var(--success) / 0.2)", borderRadius: 10, padding: "14px 16px" }}>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--success))", marginBottom: 4 }}>Login configurado ✅</p>
                    <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Seus dados estão salvos e serão usados automaticamente.</p>
                  </div>

                  <div>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Empresa</label>
                    <div style={{
                      width: "100%", height: 48, padding: "0 16px",
                      borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                      background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                      display: "flex", alignItems: "center",
                    }}>
                      {loginSalvo.empresa}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Perfil</label>
                    <div style={{
                      width: "100%", height: 48, padding: "0 16px",
                      borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                      background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                      display: "flex", alignItems: "center",
                    }}>
                      {(loginSalvo.flag ?? "loja").toUpperCase()}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Secao</label>
                    <div style={{
                      width: "100%", height: 48, padding: "0 16px",
                      borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                      background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                      display: "flex", alignItems: "center",
                    }}>
                      {loginSalvo.flag === "cd" ? "Nao se aplica" : (loginSalvo.tituloPadrao || "(nao definido)")}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 6, display: "block" }}>Nome da pessoa</label>
                    <div style={{
                      width: "100%", height: 48, padding: "0 16px",
                      borderRadius: 10, border: "1.5px solid hsl(var(--border))",
                      background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 500,
                      display: "flex", alignItems: "center",
                    }}>
                      {loginSalvo.nomePessoa || "(nao definido)"}
                    </div>
                  </div>

                  {/* Trocar minha senha (dono da conta) */}
                  {loginSalvo.login && (
                    <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: "16px", display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                      <p style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>Trocar minha senha</p>
                      <input
                        type="password"
                        placeholder="Senha atual"
                        value={senhaAtualPerfil}
                        onChange={(e) => { setSenhaAtualPerfil(e.target.value); setMsgSenhaPerfil(null); }}
                        style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "var(--font-sans)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                      />
                      <input
                        type="password"
                        placeholder="Nova senha"
                        value={novaSenhaPerfil}
                        onChange={(e) => { setNovaSenhaPerfil(e.target.value); setMsgSenhaPerfil(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleTrocarMinhaSenha(); }}
                        style={{ width: "100%", height: 44, padding: "0 14px", borderRadius: 10, border: "1.5px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontFamily: "var(--font-sans)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                      />
                      {msgSenhaPerfil && (
                        <p style={{ fontSize: 12, fontWeight: 600, color: msgSenhaPerfil.tipo === "ok" ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>{msgSenhaPerfil.texto}</p>
                      )}
                      <button
                        onClick={() => void handleTrocarMinhaSenha()}
                        disabled={trocandoSenha}
                        style={{ width: "100%", height: 44, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "none", borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 700, cursor: trocandoSenha ? "wait" : "pointer", opacity: trocandoSenha ? 0.7 : 1 }}
                      >
                        {trocandoSenha ? "Salvando…" : "Salvar nova senha"}
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                    <button onClick={() => { setMostrarPerfil(false); setMostrarModalLogin(true); }}
                      style={{
                        width: "100%", height: 48, background: "hsl(var(--primary))",
                        color: "hsl(var(--primary-foreground))", border: "none",
                        borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", display: "flex", alignItems: "center",
                        justifyContent: "center", gap: 8,
                      }}
                    >
                      <Store style={{ width: 18, height: 18 }} /> Editar Login
                    </button>

                    <button onClick={() => { fazerLogout(); setMostrarPerfil(false); }}
                      style={{
                        width: "100%", height: 48, background: "hsl(var(--destructive) / 0.08)",
                        color: "hsl(var(--destructive))", border: "1.5px solid hsl(var(--destructive) / 0.3)",
                        borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                        cursor: "pointer", display: "flex", alignItems: "center",
                        justifyContent: "center", gap: 8,
                      }}
                    >
                      <Trash2 style={{ width: 18, height: 18 }} /> Remover Login
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "24px 16px" }}>
                  <div style={{ width: 64, height: 64, borderRadius: 16, background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                    <User style={{ width: 28, height: 28, color: "hsl(var(--muted-foreground))" }} />
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 6 }}>Nenhum login salvo</p>
                  <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginBottom: 20 }}>Configure seu login para uso automático das listas.</p>
                  <button onClick={() => { setMostrarPerfil(false); setMostrarModalLogin(true); }}
                    style={{
                      width: "100%", height: 48, background: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))", border: "none",
                      borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                      cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", gap: 8,
                    }}
                  >
                    <Store style={{ width: 18, height: 18 }} /> Configurar Login
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

       {/* Modal de Configurações */}
      {mostrarConfiguracoes && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setMostrarConfiguracoes(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)", display: "flex",
            alignItems: modoDesktop ? "center" : "flex-end", 
            justifyContent: "center", 
            zIndex: 1000,
          }}
        >
          <div style={{
            background: "hsl(var(--card))",
            width: "100%", 
            maxWidth: modoDesktop ? 600 : 430,
            borderRadius: modoDesktop ? 20 : "20px 20px 0 0", 
            padding: modoDesktop ? "32px" : "24px 20px 36px",
            animation: modoDesktop ? "fadeIn 0.28s ease" : "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
            margin: modoDesktop ? "auto" : "0",
            maxHeight: modoDesktop ? "90vh" : "92vh",
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}>
            {!modoDesktop && <div style={{ width: 36, height: 4, background: "hsl(var(--border))", borderRadius: 2, margin: "0 auto 20px" }} />}

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Settings style={{ width: 22, height: 22, color: "hsl(var(--primary))" }} />
              </div>
              <div>
                <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 700, color: "hsl(var(--foreground))" }}>Configurações</p>
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Personalize sua experiência no app</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              
              {/* Modo Escuro/Claro */}
              <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {modoEscuro ? <Moon style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} /> : <Sun style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />}
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--foreground))" }}>Modo {modoEscuro ? "Escuro" : "Claro"}</p>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Alternar entre tema escuro e claro</p>
                    </div>
                  </div>
                  <button onClick={toggleModoEscuro}
                    style={{
                      width: 52, height: 28, borderRadius: 14,
                      background: modoEscuro ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      border: "none", cursor: "pointer", position: "relative",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 2, left: modoEscuro ? 26 : 2,
                      width: 24, height: 24, borderRadius: "50%",
                      background: "white", transition: "left 0.2s",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }} />
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 8, borderTop: "1px solid hsl(var(--border))" }}>
                  {modoEscuro ? "Tema escuro ativado para melhor visualização noturna" : "Tema claro ativado para melhor legibilidade diurna"}
                </p>
              </div>

              {/* Modo Desktop/Mobile */}
              <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {modoDesktop ? <Monitor style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} /> : <Smartphone style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />}
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--foreground))" }}>Modo {modoDesktop ? "Desktop" : "Mobile"}</p>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Otimizar layout para {modoDesktop ? "telas grandes" : "dispositivos móveis"}</p>
                    </div>
                  </div>
                  <button onClick={toggleModoDesktop}
                    style={{
                      width: 52, height: 28, borderRadius: 14,
                      background: modoDesktop ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      border: "none", cursor: "pointer", position: "relative",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 2, left: modoDesktop ? 26 : 2,
                      width: 24, height: 24, borderRadius: "50%",
                      background: "white", transition: "left 0.2s",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }} />
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 8, borderTop: "1px solid hsl(var(--border))" }}>
                  {modoDesktop ? "Layout otimizado para uso em computadores e telas grandes" : "Layout otimizado para smartphones e tablets"}
                </p>
              </div>

              {/* Modo Leve */}
              <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Smartphone style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--foreground))" }}>Modo Leve {modoLeve ? "Ativo" : "Inativo"}</p>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Menos carga para celular fraco</p>
                    </div>
                  </div>
                  <button onClick={toggleModoLeve}
                    style={{
                      width: 52, height: 28, borderRadius: 14,
                      background: modoLeve ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      border: "none", cursor: "pointer", position: "relative",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 2, left: modoLeve ? 26 : 2,
                      width: 24, height: 24, borderRadius: "50%",
                      background: "white", transition: "left 0.2s",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }} />
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 8, borderTop: "1px solid hsl(var(--border))" }}>
                  {modoLeve
                    ? "Supabase no scanner e analise de estoque ficam desligados; foto salva comprimida e animacoes reduzidas."
                    : "Quando ativado, corta consultas pesadas e reduz efeitos visuais para melhorar desempenho."}
                </p>
              </div>

              {/* Histórico de Compras no Scanner */}
              <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "hsl(var(--primary) / 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <ShoppingCart style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: "hsl(var(--foreground))" }}>Histórico de Compras {historicoCompras ? "Ativo" : "Inativo"}</p>
                      <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Mostra status do pedido no scanner</p>
                    </div>
                  </div>
                  <button onClick={toggleHistoricoCompras}
                    style={{
                      width: 52, height: 28, borderRadius: 14,
                      background: historicoCompras ? "hsl(var(--primary))" : "hsl(var(--muted))",
                      border: "none", cursor: "pointer", position: "relative",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 2, left: historicoCompras ? 26 : 2,
                      width: 24, height: 24, borderRadius: "50%",
                      background: "white", transition: "left 0.2s",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }} />
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 8, borderTop: "1px solid hsl(var(--border))" }}>
                  {historicoCompras
                    ? "Lista de compras carregada ao abrir o scanner. Cada produto exibe se já foi pedido e qual o status atual."
                    : "Quando ativado, consulta a lista de compras do ClickUp uma vez e exibe o status por produto. Pode pesar em celular fraco."}
                </p>
              </div>


              {loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['admin', 'super']) && (
                <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 10 }}>Gestao de Usuarios</p>
                  <button
                    onClick={() => {
                      setMostrarConfiguracoes(false);
                      navigate("/usuarios");
                    }}
                    style={{
                      width: "100%", height: 44, background: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))", border: "none",
                      borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 800,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    <Shield style={{ width: 17, height: 17 }} /> Abrir Usuarios
                  </button>
                </div>
              )}

               {/* Informações do Sistema */}
               <div style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "16px" }}>
                 <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: 8 }}>Informações do Sistema</p>
                 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                   <div>
                     <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>Versão</p>
                     <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>2.1.0</p>
                   </div>
                   <div>
                     <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>Empresa</p>
                     <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{loginSalvo?.empresa || "Não configurado"}</p>
                   </div>
                   <div>
                     <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>Perfil Atual</p>
                     <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{loginSalvo?.role ? loginSalvo.role.charAt(0).toUpperCase() + loginSalvo.role.slice(1) : "Não logado"}</p>
                   </div>
                    <div>
                      <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>Interface</p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>{modoDesktop ? "Desktop" : "Mobile"}{modoLeve ? " · Leve" : ""}</p>
                    </div>
                  </div>
                </div>

               {/* Botões de ação */}
               <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                 <button onClick={() => { setMostrarConfiguracoes(false); }}
                   style={{
                     width: "100%", height: 48, background: "hsl(var(--primary))",
                     color: "hsl(var(--primary-foreground))", border: "none",
                     borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                     cursor: "pointer", display: "flex", alignItems: "center",
                     justifyContent: "center", gap: 8,
                   }}
                 >
                   <Settings style={{ width: 18, height: 18 }} /> Salvar Configurações
                 </button>

                <button onClick={() => { 
                  setModoEscuro(false); 
                  setModoDesktop(false); 
                  setModoLeve(false);
                  localStorage.removeItem('modoEscuro');
                  localStorage.removeItem('modoDesktop');
                  setLightModeEnabled(false);
                  document.documentElement.classList.remove('dark');
                  setMostrarConfiguracoes(false); 
                }}
                  style={{
                    width: "100%", height: 48, background: "hsl(var(--secondary))",
                    color: "hsl(var(--foreground))", border: "1.5px solid hsl(var(--border))",
                    borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700,
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", gap: 8,
                  }}
                >
                  <Trash2 style={{ width: 18, height: 18 }} /> Restaurar Padrões
                </button>
              </div>

              <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", textAlign: "center", marginTop: 8 }}>
                As configurações são salvas automaticamente no seu dispositivo.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;


