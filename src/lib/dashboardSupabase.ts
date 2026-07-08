import type { Empresa, LoginFlag } from "@/hooks/useAuth";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export type DashboardFlagFiltro = LoginFlag | "todos";
export type DashboardEmpresaFiltroKey = "NEWSHOP" | "SO_FACIL" | "SO_SOYE" | "SOYE_FACIL" | "TUDO";

export interface DashboardConsultaParams {
  empresas: Empresa[];
  flag?: DashboardFlagFiltro;
  dataInicio?: string;
  dataFim?: string;
}

export interface DashboardDiarioRow {
  empresa: Empresa;
  flag: LoginFlag;
  data: string;
  total_conferencias: number;
  total_itens: number;
  separado: number;
  nao_tem: number;
  parcial: number;
  pendente: number;
}

export interface DashboardSemanalRow {
  empresa: Empresa;
  flag: LoginFlag;
  semana_inicio: string;
  total_conferencias: number;
  total_itens: number;
  separado: number;
  nao_tem: number;
  parcial: number;
  pendente: number;
}

export interface DashboardPedidosStatusRow {
  empresa: Empresa;
  flag: LoginFlag;
  pendentes: number;
  analisados: number;
  em_andamento: number;
  concluidos: number;
}

export interface DashboardPorConferenteRow {
  empresa: Empresa;
  flag: LoginFlag;
  data: string;
  conferente: string;
  conferencias: number;
  total_itens: number;
  separado: number;
  nao_tem: number;
  parcial: number;
  pendente: number;
  tempo_segundos: number;
}

export interface DashboardPorSecaoRow {
  empresa: Empresa;
  flag: LoginFlag;
  data: string;
  secao: string;
  total: number;
  separado: number;
  nao_tem: number;
  parcial: number;
  pendente: number;
  total_pedido: number;
  total_real: number;
}

export interface DashboardItemFrequenciaRow {
  empresa: Empresa;
  flag: LoginFlag;
  data: string;
  codigo: string;
  sku: string;
  secao: string;
  vezes: number;
  total_pedido: number;
  total_real: number;
  foto_url: string | null;
}

export const DASHBOARD_EMPRESA_FILTROS: Record<
  DashboardEmpresaFiltroKey,
  { label: string; empresas: Empresa[] }
> = {
  NEWSHOP: { label: "NEWSHOP", empresas: ["NEWSHOP"] },
  SO_FACIL: { label: "SO FACIL", empresas: ["FACIL"] },
  SO_SOYE: { label: "SO SOYE", empresas: ["SOYE"] },
  SOYE_FACIL: { label: "SOYE+FACIL", empresas: ["SOYE", "FACIL"] },
  TUDO: { label: "TUDO", empresas: ["NEWSHOP", "SOYE", "FACIL"] },
};

const EMPRESA_ORDEM: Empresa[] = ["NEWSHOP", "SOYE", "FACIL"];

type DashboardDiarioRowRaw = {
  empresa: string | null;
  flag: string | null;
  data: string | null;
  total_conferencias: number | null;
  total_itens: number | null;
  separado: number | null;
  nao_tem: number | null;
  parcial: number | null;
  pendente: number | null;
};

type DashboardSemanalRowRaw = {
  empresa: string | null;
  flag: string | null;
  semana_inicio: string | null;
  total_conferencias: number | null;
  total_itens: number | null;
  separado: number | null;
  nao_tem: number | null;
  parcial: number | null;
  pendente: number | null;
};

type DashboardPedidosStatusRowRaw = {
  empresa: string | null;
  flag: string | null;
  pendentes: number | null;
  analisados: number | null;
  em_andamento: number | null;
  concluidos: number | null;
};

type DashboardPorConferenteRowRaw = {
  empresa: string | null;
  flag: string | null;
  data: string | null;
  conferente: string | null;
  conferencias: number | null;
  total_itens: number | null;
  separado: number | null;
  nao_tem: number | null;
  parcial: number | null;
  pendente: number | null;
  tempo_segundos: number | null;
};

type DashboardPorSecaoRowRaw = {
  empresa: string | null;
  flag: string | null;
  data: string | null;
  secao: string | null;
  total: number | null;
  separado: number | null;
  nao_tem: number | null;
  parcial: number | null;
  pendente: number | null;
  total_pedido: number | null;
  total_real: number | null;
};

type DashboardItemFrequenciaRowRaw = {
  empresa: string | null;
  flag: string | null;
  data: string | null;
  codigo: string | null;
  sku: string | null;
  secao: string | null;
  vezes: number | null;
  total_pedido: number | null;
  total_real: number | null;
  foto_url: string | null;
};

function normalizarEmpresa(value: unknown): Empresa {
  const empresa = String(value ?? "NEWSHOP").trim().toUpperCase();
  if (empresa.includes("SOYE")) return "SOYE";
  if (empresa.includes("FACIL")) return "FACIL";
  return "NEWSHOP";
}

function normalizarFlag(value: unknown): LoginFlag {
  return String(value ?? "loja").trim().toLowerCase() === "cd" ? "cd" : "loja";
}

function normalizarEmpresas(values: Empresa[]): Empresa[] {
  const set = new Set(values.map(normalizarEmpresa));
  return EMPRESA_ORDEM.filter((empresa) => set.has(empresa));
}

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function withBaseFilters(query: any, params: DashboardConsultaParams, dateColumn?: string) {
  const empresas = normalizarEmpresas(params.empresas);
  let next = query.in("empresa", empresas);

  if (params.flag && params.flag !== "todos") {
    next = next.eq("flag", normalizarFlag(params.flag));
  }

  if (dateColumn) {
    if (params.dataInicio) next = next.gte(dateColumn, params.dataInicio);
    if (params.dataFim) next = next.lte(dateColumn, params.dataFim);
  }

  return next;
}

async function selectAll<T>(buildQuery: () => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function canQuery(params: DashboardConsultaParams): boolean {
  return isSupabaseConfigured && normalizarEmpresas(params.empresas).length > 0;
}

export function getDashboardEmpresaFiltroLabel(filtro: DashboardEmpresaFiltroKey): string {
  return DASHBOARD_EMPRESA_FILTROS[filtro]?.label ?? "NEWSHOP";
}

export function getDashboardEmpresasFiltro(
  filtro: DashboardEmpresaFiltroKey,
  empresasPermitidas?: Empresa[]
): Empresa[] {
  const base =
    filtro === "TUDO" && empresasPermitidas?.length
      ? empresasPermitidas
      : DASHBOARD_EMPRESA_FILTROS[filtro]?.empresas ?? ["NEWSHOP"];

  if (!empresasPermitidas?.length) {
    return normalizarEmpresas(base);
  }

  const permitidas = new Set(normalizarEmpresas(empresasPermitidas));
  return normalizarEmpresas(base).filter((empresa) => permitidas.has(empresa));
}

export function getDashboardFiltrosPermitidos(empresasPermitidas: Empresa[]): DashboardEmpresaFiltroKey[] {
  const set = new Set(normalizarEmpresas(empresasPermitidas));
  const filtros: DashboardEmpresaFiltroKey[] = [];

  if (set.has("NEWSHOP")) filtros.push("NEWSHOP");
  if (set.has("FACIL")) filtros.push("SO_FACIL");
  if (set.has("SOYE")) filtros.push("SO_SOYE");
  if (set.has("SOYE") && set.has("FACIL")) filtros.push("SOYE_FACIL");
  if (set.has("NEWSHOP") && set.has("SOYE") && set.has("FACIL")) filtros.push("TUDO");

  return filtros.length > 0 ? filtros : ["NEWSHOP"];
}

export async function listarDashboardDiario(params: DashboardConsultaParams): Promise<DashboardDiarioRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardDiarioRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_diario")
        .select("empresa,flag,data,total_conferencias,total_itens,separado,nao_tem,parcial,pendente")
        .order("data", { ascending: true })
        .order("empresa", { ascending: true }),
      params,
      "data"
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    data: toText(row.data, ""),
    total_conferencias: toNumber(row.total_conferencias),
    total_itens: toNumber(row.total_itens),
    separado: toNumber(row.separado),
    nao_tem: toNumber(row.nao_tem),
    parcial: toNumber(row.parcial),
    pendente: toNumber(row.pendente),
  }));
}

export async function listarDashboardSemanal(params: DashboardConsultaParams): Promise<DashboardSemanalRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardSemanalRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_semanal")
        .select("empresa,flag,semana_inicio,total_conferencias,total_itens,separado,nao_tem,parcial,pendente")
        .order("semana_inicio", { ascending: true })
        .order("empresa", { ascending: true }),
      params
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    semana_inicio: toText(row.semana_inicio, ""),
    total_conferencias: toNumber(row.total_conferencias),
    total_itens: toNumber(row.total_itens),
    separado: toNumber(row.separado),
    nao_tem: toNumber(row.nao_tem),
    parcial: toNumber(row.parcial),
    pendente: toNumber(row.pendente),
  }));
}

export async function listarDashboardPedidosStatus(
  params: DashboardConsultaParams
): Promise<DashboardPedidosStatusRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardPedidosStatusRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_pedidos_status")
        .select("empresa,flag,pendentes,analisados,em_andamento,concluidos")
        .order("empresa", { ascending: true }),
      params
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    pendentes: toNumber(row.pendentes),
    analisados: toNumber(row.analisados),
    em_andamento: toNumber(row.em_andamento),
    concluidos: toNumber(row.concluidos),
  }));
}

export async function listarDashboardPorConferente(
  params: DashboardConsultaParams
): Promise<DashboardPorConferenteRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardPorConferenteRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_por_conferente")
        .select(
          "empresa,flag,data,conferente,conferencias,total_itens,separado,nao_tem,parcial,pendente,tempo_segundos"
        )
        .order("data", { ascending: true })
        .order("conferente", { ascending: true }),
      params,
      "data"
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    data: toText(row.data, ""),
    conferente: toText(row.conferente, "Sem conferente"),
    conferencias: toNumber(row.conferencias),
    total_itens: toNumber(row.total_itens),
    separado: toNumber(row.separado),
    nao_tem: toNumber(row.nao_tem),
    parcial: toNumber(row.parcial),
    pendente: toNumber(row.pendente),
    tempo_segundos: toNumber(row.tempo_segundos),
  }));
}

export async function listarDashboardPorSecao(
  params: DashboardConsultaParams
): Promise<DashboardPorSecaoRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardPorSecaoRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_por_secao")
        .select("empresa,flag,data,secao,total,separado,nao_tem,parcial,pendente,total_pedido,total_real")
        .order("data", { ascending: true })
        .order("secao", { ascending: true }),
      params,
      "data"
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    data: toText(row.data, ""),
    secao: toText(row.secao, "Sem secao"),
    total: toNumber(row.total),
    separado: toNumber(row.separado),
    nao_tem: toNumber(row.nao_tem),
    parcial: toNumber(row.parcial),
    pendente: toNumber(row.pendente),
    total_pedido: toNumber(row.total_pedido),
    total_real: toNumber(row.total_real),
  }));
}

export async function listarDashboardItemFrequencia(
  params: DashboardConsultaParams
): Promise<DashboardItemFrequenciaRow[]> {
  if (!canQuery(params)) return [];

  const rows = await selectAll<DashboardItemFrequenciaRowRaw>(() =>
    withBaseFilters(
      supabase
        .from("dashboard_item_frequencia")
        .select("empresa,flag,data,codigo,sku,secao,vezes,total_pedido,total_real,foto_url")
        .order("data", { ascending: true })
        .order("vezes", { ascending: false }),
      params,
      "data"
    )
  );

  return rows.map((row) => ({
    empresa: normalizarEmpresa(row.empresa),
    flag: normalizarFlag(row.flag),
    data: toText(row.data, ""),
    codigo: toText(row.codigo, ""),
    sku: toText(row.sku, "Sem SKU"),
    secao: toText(row.secao, "Sem secao"),
    vezes: toNumber(row.vezes),
    total_pedido: toNumber(row.total_pedido),
    total_real: toNumber(row.total_real),
    foto_url: row.foto_url || null,
  }));
}
