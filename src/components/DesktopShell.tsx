import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getCompanyLogo, getCompanyName } from "@/lib/companyTheme";
import { ErpLayout } from "@/components/ErpLayout";

interface DesktopShellProps {
  children: React.ReactNode;
  pageTitle?: string;
}

/**
 * Envolve qualquer página com o layout ERP em telas ≥1024px.
 * Em mobile retorna os children sem alteração.
 *
 * Perfil/Configurações redirecionam para Home com query param —
 * Home detecta `?modal=perfil` / `?modal=config` e abre o modal correspondente.
 */
export function DesktopShell({ children, pageTitle }: DesktopShellProps) {
  const navigate = useNavigate();
  const { loginSalvo, fazerLogout } = useAuth();
  const logoEmpresa = getCompanyLogo(loginSalvo?.empresa);
  const nomeEmpresaLogo = getCompanyName(loginSalvo?.empresa);

  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!isDesktop) return <>{children}</>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <ErpLayout
        loginSalvo={loginSalvo}
        logoEmpresa={logoEmpresa}
        nomeEmpresaLogo={nomeEmpresaLogo}
        setMostrarPerfil={() => navigate("/?modal=perfil")}
        setMostrarConfiguracoes={() => navigate("/?modal=config")}
        fazerLogout={fazerLogout}
        pageTitle={pageTitle}
      >
        {children}
      </ErpLayout>
    </div>
  );
}
