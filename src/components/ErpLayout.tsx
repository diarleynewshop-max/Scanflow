import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ScanBarcode, ClipboardList, GitCompare, BadgeDollarSign,
  Package, ShoppingCart, BarChart3, Users, User, Settings,
  ChevronDown, ChevronRight, LogOut, Menu, Home as HomeIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { hasAnyRoleAccess } from "@/components/ProtectedRoute";
import type { LoginData } from "@/hooks/useAuth";

interface NavItemDef {
  icon: LucideIcon;
  label: string;
  path?: string;
  onClick?: () => void;
}

interface ErpLayoutProps {
  children: React.ReactNode;
  loginSalvo: LoginData | null;
  logoEmpresa: string;
  nomeEmpresaLogo: string;
  setMostrarPerfil: (v: boolean) => void;
  setMostrarConfiguracoes: (v: boolean) => void;
  fazerLogout: () => void;
  pageTitle?: string;
}

const LABEL_MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "hsl(var(--muted-foreground))",
};

export function ErpLayout({
  children,
  loginSalvo,
  logoEmpresa,
  nomeEmpresaLogo,
  setMostrarPerfil,
  setMostrarConfiguracoes,
  fazerLogout,
  pageTitle = "Início",
}: ErpLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    operacional: true,
    gestao: true,
    admin: true,
  });

  const currentPath = location.pathname + location.search;
  const isPriv = !!loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['compras', 'admin', 'super']);
  const isAdm = !!loginSalvo?.role && hasAnyRoleAccess(loginSalvo.role, ['admin', 'super']);
  const flag = loginSalvo?.flag ?? 'loja';

  const groups: { key: string; label: string; items: NavItemDef[] }[] = [
    {
      key: "operacional",
      label: "Operacional",
      items: [
        { icon: HomeIcon, label: "Início", path: "/" },
        { icon: ScanBarcode, label: "Escanear", path: "/scanner" },
        { icon: ClipboardList, label: "Lista", path: "/scanner?tab=list" },
        ...((flag === 'loja' || isPriv) ? [{ icon: Package, label: "Meus Pedidos", path: "/meus-pedidos" }] : []),
        ...((flag === 'cd' || isPriv) ? [{ icon: GitCompare, label: "Conferência", path: "/scanner?tab=conference" }] : []),
        { icon: BadgeDollarSign, label: "Consulta Preço", path: "/consulta-preco" },
      ],
    },
    ...(isPriv ? [{
      key: "gestao",
      label: "Gestão",
      items: [
        { icon: ShoppingCart, label: "Compras", path: "/compras" },
        { icon: BarChart3, label: "Dashboard", path: "/dashboard" },
      ],
    }] : []),
    ...(isAdm ? [{
      key: "admin",
      label: "Admin",
      items: [
        { icon: Users, label: "Usuarios", path: "/usuarios" },
      ],
    }] : []),
  ];

  function isActive(path?: string) {
    if (!path) return false;
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path.split('?')[0]);
  }

  function NavBtn({ icon: Icon, label, path, onClick }: NavItemDef) {
    const on = isActive(path);
    return (
      <button
        onClick={() => { onClick ? onClick() : path && navigate(path); }}
        title={collapsed ? label : undefined}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: collapsed ? 0 : 11,
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "10px 0" : "9px 12px",
          borderRadius: 10,
          background: on ? "hsl(var(--secondary))" : "transparent",
          border: "none",
          cursor: "pointer",
          marginBottom: 2,
          position: "relative",
          transition: "background 0.13s",
        }}
        onMouseEnter={e => { if (!on) e.currentTarget.style.background = "hsl(var(--accent))"; }}
        onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
      >
        {on && !collapsed && (
          <span style={{
            position: "absolute", left: 0, top: 8, bottom: 8,
            width: 3, borderRadius: 2,
            background: "hsl(var(--primary))",
          }} />
        )}
        <Icon
          size={17}
          style={{
            color: on ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
            flexShrink: 0,
          }}
        />
        {!collapsed && (
          <span style={{
            fontSize: 13.5,
            fontWeight: on ? 600 : 400,
            color: on ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
            fontFamily: "var(--font-sans)",
          }}>
            {label}
          </span>
        )}
      </button>
    );
  }

  const sideW = collapsed ? 64 : 244;

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      overflow: "hidden",
      background: "hsl(var(--background))",
      fontFamily: "var(--font-sans)",
    }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: sideW,
        minWidth: sideW,
        height: "100vh",
        background: "hsl(var(--card))",
        borderRight: "1px solid hsl(var(--border))",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.2s ease",
        flexShrink: 0,
      }}>
        {/* Logo / Toggle */}
        <div style={{
          padding: collapsed ? "18px 12px" : "18px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid hsl(var(--border))",
          marginBottom: 10,
        }}>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <img
                src={logoEmpresa}
                alt={nomeEmpresaLogo}
                style={{ height: 28, objectFit: "contain", maxWidth: "100%" }}
              />
              <p style={{ ...LABEL_MONO, marginTop: 6 }}>Sistema de Pedidos</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "hsl(var(--muted-foreground))",
              padding: 6,
              borderRadius: 7,
              flexShrink: 0,
              display: "flex",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--accent))"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            <Menu size={16} />
          </button>
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, padding: "0 10px", overflowY: "auto" }}>
          {groups.map(g => (
            <div key={g.key} style={{ marginBottom: 6 }}>
              {!collapsed && (
                <button
                  onClick={() => setOpenGroups(p => ({ ...p, [g.key]: !p[g.key] }))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    width: "100%",
                    padding: "6px 8px 6px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ ...LABEL_MONO, flex: 1, textAlign: "left" }}>
                    {g.label}
                  </span>
                  {openGroups[g.key] !== false
                    ? <ChevronDown size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                    : <ChevronRight size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                  }
                </button>
              )}
              {(openGroups[g.key] !== false || collapsed) && g.items.map(it => (
                <NavBtn key={it.label} {...it} />
              ))}
            </div>
          ))}

          {/* Conta */}
          <div style={{ marginTop: 6 }}>
            {!collapsed && (
              <p style={{ ...LABEL_MONO, padding: "6px 8px 6px" }}>
                Conta
              </p>
            )}
            <NavBtn icon={User} label="Perfil" onClick={() => setMostrarPerfil(true)} />
            <NavBtn icon={Settings} label="Configurações" onClick={() => setMostrarConfiguracoes(true)} />
          </div>
        </div>

        {/* User footer */}
        {loginSalvo && (
          <div style={{
            padding: collapsed ? "12px 10px" : "12px 14px",
            borderTop: "1px solid hsl(var(--border))",
          }}>
            {!collapsed ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: "hsl(var(--primary))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <span style={{
                    color: "hsl(var(--primary-foreground))",
                    fontSize: 13, fontWeight: 700,
                    fontFamily: "var(--font-serif)",
                  }}>
                    {(loginSalvo.nomePessoa || "U").charAt(0).toUpperCase()}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "hsl(var(--foreground))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {loginSalvo.nomePessoa || "Usuário"}
                  </p>
                  <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>
                    {loginSalvo.role || "operador"}
                  </p>
                </div>
                <button
                  onClick={fazerLogout}
                  title="Sair"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "hsl(var(--muted-foreground))",
                    padding: 5,
                    borderRadius: 6,
                    display: "flex",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--accent))"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                >
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: "hsl(var(--primary))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{
                    color: "hsl(var(--primary-foreground))",
                    fontSize: 13, fontWeight: 700,
                    fontFamily: "var(--font-serif)",
                  }}>
                    {(loginSalvo.nomePessoa || "U").charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{
          height: 56,
          background: "hsl(var(--card))",
          borderBottom: "1px solid hsl(var(--border))",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          flexShrink: 0,
          gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ ...LABEL_MONO, marginBottom: 2 }}>
              Sistema
            </p>
            <p style={{
              fontSize: 13,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              fontFamily: "var(--font-sans)",
            }}>
              {pageTitle}
            </p>
          </div>
          {loginSalvo && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "6px 12px",
              background: "hsl(var(--secondary))",
              borderRadius: 10,
              border: "1px solid hsl(var(--border))",
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: "hsl(var(--primary))",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{
                  color: "hsl(var(--primary-foreground))",
                  fontSize: 11, fontWeight: 700,
                  fontFamily: "var(--font-serif)",
                }}>
                  {(loginSalvo.nomePessoa || "U").charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                  lineHeight: 1,
                }}>
                  {loginSalvo.nomePessoa || "Usuário"}
                </p>
                <p style={{
                  fontSize: 10,
                  color: "hsl(var(--muted-foreground))",
                  lineHeight: 1,
                  marginTop: 2,
                }}>
                  {loginSalvo.empresa} · {loginSalvo.role || "operador"}
                </p>
              </div>
            </div>
          )}
        </header>

        {/* Content */}
        <main
          className="erp-main"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px 32px",
            background: "hsl(var(--background))",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
