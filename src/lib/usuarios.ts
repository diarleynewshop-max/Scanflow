import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import type { Empresa, LoginFlag, UserRole } from "@/hooks/useAuth";

export interface UsuarioAdmin {
  id: string;
  login: string;
  nome: string;
  role: UserRole;
  empresas: Empresa[];
  flagDefault: LoginFlag;
  secoesCompras: string[];
  secaoPadrao?: string;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActorCredenciais {
  login: string;
  senha: string;
}

export interface UsuarioFormPayload {
  login: string;
  nome: string;
  senha?: string;
  role: UserRole;
  empresas: Empresa[];
  flagDefault: LoginFlag;
  secoesCompras: string[];
  secaoPadrao: string;
  ativo: boolean;
}

type UsuarioRpcRow = {
  id?: string;
  login?: string;
  nome?: string;
  role?: string;
  empresas?: string[];
  flag_default?: string;
  secoes_compras?: string[];
  secao_padrao?: string | null;
  ativo?: boolean;
  created_at?: string;
  updated_at?: string;
};

const ROLES: UserRole[] = ["operador", "compras", "admin", "super"];
const EMPRESAS: Empresa[] = ["NEWSHOP", "SOYE", "FACIL"];

function assertSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase nao configurado.");
  }
}

function normalizarRole(value: unknown): UserRole {
  const role = String(value ?? "").toLowerCase() as UserRole;
  return ROLES.includes(role) ? role : "operador";
}

function normalizarFlag(value: unknown): LoginFlag {
  return String(value ?? "").toLowerCase() === "cd" ? "cd" : "loja";
}

function normalizarEmpresas(values: unknown): Empresa[] {
  const raw = Array.isArray(values) ? values : [];
  return raw.filter((value): value is Empresa => EMPRESAS.includes(String(value) as Empresa));
}

function normalizarArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function normalizarTextoOpcional(value: unknown): string | undefined {
  const texto = String(value ?? "").trim();
  return texto || undefined;
}

function mapUsuario(row: UsuarioRpcRow): UsuarioAdmin {
  return {
    id: String(row.id ?? ""),
    login: String(row.login ?? ""),
    nome: String(row.nome ?? ""),
    role: normalizarRole(row.role),
    empresas: normalizarEmpresas(row.empresas),
    flagDefault: normalizarFlag(row.flag_default),
    secoesCompras: normalizarArray(row.secoes_compras),
    secaoPadrao: normalizarTextoOpcional(row.secao_padrao),
    ativo: row.ativo !== false,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function actorParams(actor: ActorCredenciais) {
  return {
    p_actor_login: actor.login,
    p_actor_senha: actor.senha,
  };
}

export async function listarUsuarios(actor: ActorCredenciais): Promise<UsuarioAdmin[]> {
  assertSupabase();
  const { data, error } = await supabase.rpc("admin_listar_usuarios", actorParams(actor));
  if (error) throw error;
  return ((data ?? []) as UsuarioRpcRow[]).map(mapUsuario);
}

export async function criarUsuario(actor: ActorCredenciais, payload: UsuarioFormPayload): Promise<string> {
  assertSupabase();
  const { data, error } = await supabase.rpc("admin_criar_usuario", {
    ...actorParams(actor),
    p_login: payload.login,
    p_nome: payload.nome,
    p_senha: payload.senha ?? "",
    p_role: payload.role,
    p_empresas: payload.empresas,
    p_flag_default: payload.flagDefault,
    p_secoes: payload.secoesCompras,
    p_secao_padrao: payload.secaoPadrao,
  });
  if (error) throw error;
  return String(data ?? "");
}

export async function atualizarUsuario(actor: ActorCredenciais, id: string, payload: UsuarioFormPayload): Promise<void> {
  assertSupabase();
  const { error } = await supabase.rpc("admin_atualizar_usuario", {
    ...actorParams(actor),
    p_id: id,
    p_nome: payload.nome,
    p_role: payload.role,
    p_empresas: payload.empresas,
    p_flag_default: payload.flagDefault,
    p_secoes: payload.secoesCompras,
    p_secao_padrao: payload.secaoPadrao,
    p_ativo: payload.ativo,
  });
  if (error) throw error;
}

export async function redefinirSenhaUsuario(actor: ActorCredenciais, id: string, novaSenha: string): Promise<void> {
  assertSupabase();
  const { error } = await supabase.rpc("admin_redefinir_senha", {
    ...actorParams(actor),
    p_id: id,
    p_nova_senha: novaSenha,
  });
  if (error) throw error;
}

// Self-service: o proprio dono da conta troca a senha (valida a atual no banco).
// Retorna false se a senha atual estiver errada.
export async function alterarMinhaSenha(login: string, senhaAtual: string, novaSenha: string): Promise<boolean> {
  assertSupabase();
  const { data, error } = await supabase.rpc("alterar_minha_senha", {
    p_login: login,
    p_senha_atual: senhaAtual,
    p_nova_senha: novaSenha,
  });
  if (error) throw error;
  return data === true;
}
