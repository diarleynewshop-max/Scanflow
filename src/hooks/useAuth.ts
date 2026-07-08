import { useState, useEffect } from "react";
import { applyCompanyTheme } from "@/lib/companyTheme";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

export type Empresa = "NEWSHOP" | "SOYE" | "FACIL";
export type LoginFlag = "loja" | "cd";
export type UserRole = "operador" | "compras" | "admin" | "super";

export interface LoginData {
  empresa: Empresa;
  tituloPadrao: string;
  secaoPadrao?: string;
  nomePessoa: string;
  flag: LoginFlag;
  role: UserRole;
  secoesCompras?: string[];
  usuarioId?: string;
  login?: string;
  empresasPermitidas?: Empresa[];
}

export interface UsuarioLoginContext {
  id: string;
  login: string;
  nome: string;
  role: UserRole;
  empresasPermitidas: Empresa[];
  flagDefault: LoginFlag;
  secoesCompras: string[];
  secaoPadrao?: string;
}

export interface LoginRequest {
  login: string;
  senha: string;
  empresaSelecionada?: Empresa;
  tituloPadrao?: string;
  flag?: LoginFlag;
}

export type LoginResult =
  | { sucesso: true; loginSalvo: LoginData }
  | { sucesso: false; motivo: "supabase_nao_configurado" | "credencial_invalida" | "empresa_nao_permitida" | "titulo_obrigatorio" | "selecionar_empresa"; contexto?: UsuarioLoginContext };

const STORAGE_KEY = "scan_newshop_login";

const EMPRESAS_VALIDAS: Empresa[] = ["NEWSHOP", "SOYE", "FACIL"];
const ROLES_VALIDOS: UserRole[] = ["operador", "compras", "admin", "super"];

type LoginUsuarioRow = {
  id?: string;
  login?: string;
  nome?: string;
  role?: string;
  empresas?: string[];
  flag_default?: string;
  secoes_compras?: string[];
  secao_padrao?: string | null;
};

const normalizarEmpresa = (value: unknown): Empresa | null => {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized.includes("NEWSHOP")) return "NEWSHOP";
  if (normalized.includes("SOYE")) return "SOYE";
  if (normalized.includes("FACIL")) return "FACIL";
  return null;
};

const normalizarFlag = (value: unknown): LoginFlag => (String(value ?? "").toLowerCase() === "cd" ? "cd" : "loja");

const normalizarRole = (value: unknown): UserRole => {
  const role = String(value ?? "").toLowerCase() as UserRole;
  return ROLES_VALIDOS.includes(role) ? role : "operador";
};

const normalizarEmpresas = (values: unknown): Empresa[] => {
  const raw = Array.isArray(values) ? values : [];
  const empresas = raw.map(normalizarEmpresa).filter((empresa): empresa is Empresa => !!empresa);
  return [...new Set(empresas)];
};

const toStringArray = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
};

const normalizarTextoOpcional = (value: unknown): string | undefined => {
  const texto = String(value ?? "").trim();
  return texto || undefined;
};

function montarContextoUsuario(row: LoginUsuarioRow): UsuarioLoginContext | null {
  const empresasPermitidas = normalizarEmpresas(row.empresas);
  if (!row.id || !row.login || !row.nome || empresasPermitidas.length === 0) return null;

  return {
    id: row.id,
    login: row.login,
    nome: row.nome,
    role: normalizarRole(row.role),
    empresasPermitidas,
    flagDefault: normalizarFlag(row.flag_default),
    secoesCompras: toStringArray(row.secoes_compras),
    secaoPadrao: normalizarTextoOpcional(row.secao_padrao),
  };
}

function salvarLogin(data: LoginData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    applyCompanyTheme(data.empresa);
  } catch (err) {
    console.error("Erro ao salvar login:", err);
  }
}

export function obterLoginSalvo(): LoginData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const dados = JSON.parse(raw) as Partial<LoginData>;
    const empresa = normalizarEmpresa(dados.empresa);
    if (!empresa) return null;

    const flag = normalizarFlag(dados.flag);
    const role = normalizarRole(dados.role);
    const empresasPermitidas = normalizarEmpresas(dados.empresasPermitidas);

    return {
      empresa,
      tituloPadrao: flag === "cd" ? "CD" : String(dados.tituloPadrao ?? ""),
      secaoPadrao: normalizarTextoOpcional(dados.secaoPadrao),
      nomePessoa: String(dados.nomePessoa ?? ""),
      flag,
      role,
      secoesCompras: toStringArray(dados.secoesCompras),
      usuarioId: dados.usuarioId ? String(dados.usuarioId) : undefined,
      login: dados.login ? String(dados.login) : undefined,
      empresasPermitidas: empresasPermitidas.length > 0 ? empresasPermitidas : [empresa],
    };
  } catch {
    return null;
  }
}

export function removerLogin(): void {
  localStorage.removeItem(STORAGE_KEY);
  applyCompanyTheme("NEWSHOP");
}

export function useAuth() {
  const [loginSalvo, setLoginSalvo] = useState<LoginData | null>(() => obterLoginSalvo());
  const [mostrarModalLogin, setMostrarModalLogin] = useState(false);

  useEffect(() => {
    if (!loginSalvo) setMostrarModalLogin(true);
  }, [loginSalvo]);

  const fazerLogin = async (request: LoginRequest): Promise<LoginResult> => {
    if (!isSupabaseConfigured) {
      return { sucesso: false, motivo: "supabase_nao_configurado" };
    }

    const login = request.login.trim().toLowerCase();
    const senha = request.senha;
    if (!login || !senha) {
      return { sucesso: false, motivo: "credencial_invalida" };
    }

    const { data, error } = await supabase.rpc("login_usuario", {
      p_login: login,
      p_senha: senha,
    });

    if (error) {
      console.error("[auth] login_usuario falhou", error);
      return { sucesso: false, motivo: "credencial_invalida" };
    }

    const row = Array.isArray(data) ? (data[0] as LoginUsuarioRow | undefined) : undefined;
    const contexto = row ? montarContextoUsuario(row) : null;
    if (!contexto) {
      return { sucesso: false, motivo: "credencial_invalida" };
    }

    if (!request.empresaSelecionada && contexto.empresasPermitidas.length > 1) {
      return { sucesso: false, motivo: "selecionar_empresa", contexto };
    }

    const empresa = request.empresaSelecionada ?? contexto.empresasPermitidas[0];
    if (!empresa || !contexto.empresasPermitidas.includes(empresa)) {
      return { sucesso: false, motivo: "empresa_nao_permitida", contexto };
    }

    const flag = request.flag ?? contexto.flagDefault;
    const tituloPadrao = flag === "cd" ? "CD" : (request.tituloPadrao ?? "").trim();
    if (flag === "loja" && !tituloPadrao) {
      return { sucesso: false, motivo: "titulo_obrigatorio", contexto };
    }

    const dados: LoginData = {
      empresa,
      tituloPadrao,
      secaoPadrao: contexto.secaoPadrao,
      nomePessoa: contexto.nome,
      flag,
      role: contexto.role,
      secoesCompras: contexto.secoesCompras,
      usuarioId: contexto.id,
      login: contexto.login,
      empresasPermitidas: contexto.empresasPermitidas,
    };

    salvarLogin(dados);
    setLoginSalvo(dados);
    setMostrarModalLogin(false);
    return { sucesso: true, loginSalvo: dados };
  };

  const fazerLogout = (): void => {
    removerLogin();
    setLoginSalvo(null);
    setMostrarModalLogin(true);
  };

  return {
    loginSalvo,
    mostrarModalLogin,
    setMostrarModalLogin,
    fazerLogin,
    fazerLogout,
  };
}
