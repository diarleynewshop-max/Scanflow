import { isSupabaseConfigured, supabase } from './supabaseClient';
import type { EmpresaKey, FlagKey } from './pedidosFila';

export interface RelatorioDiarioItem {
  codigo: string;
  sku: string;
  secao: string;
  pedido: number;
  real: number | null;
  status: "nao_tem" | "parcial" | string;
  conferente: string;
  taskId: string;
  photo?: string | null;
}

export interface RelatorioDiarioConferente {
  nome: string;
  conferencias: number;
  totalItens: number;
  separado: number;
  naoTem: number;
  parcial: number;
  pendente: number;
  tempoTotalMinutos?: number;
  tempoConfs?: number;
}

export interface RelatorioDiarioSecao {
  nome: string;
  total: number;
  naoTem: number;
  parcial: number;
}

export interface RelatorioDiario {
  type: "daily-conference-report";
  empresa: EmpresaKey;
  flag: FlagKey;
  data: string;
  geradoEm: string;
  totalConferencias: number;
  resumo: {
    totalItens: number;
    separado: number;
    naoTem: number;
    parcial: number;
    pendente: number;
  };
  porConferente: RelatorioDiarioConferente[];
  porSecao: RelatorioDiarioSecao[];
  itens?: RelatorioDiarioItem[];
  itensCriticos: RelatorioDiarioItem[];
  conferencias: Array<{ taskId: string; name: string; conferente: string; totalItens: number }>;
  ignoradas: Array<{ taskId: string; name: string; motivo: string }>;
  clickupTaskId: string | null;
}

export interface RelatorioDataOption {
  data: string;
  label: string;
  total: number;
  relatorioGerado: boolean;
}

type ConferenceStatusSupabase = 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente';

export type DashboardEmpresaFiltroKey = 'NEWSHOP' | 'SO_FACIL' | 'SO_SOYE' | 'SOYE_FACIL' | 'TUDO';

export const DASHBOARD_EMPRESA_FILTROS: Record<DashboardEmpresaFiltroKey, { label: string; empresas: EmpresaKey[] }> = {
  NEWSHOP: { label: 'NEWSHOP', empresas: ['NEWSHOP'] },
  SO_FACIL: { label: 'SO FACIL', empresas: ['FACIL'] },
  SO_SOYE: { label: 'SO SOYE', empresas: ['SOYE'] },
  SOYE_FACIL: { label: 'SOYE+FACIL', empresas: ['SOYE', 'FACIL'] },
  TUDO: { label: 'TUDO', empresas: ['NEWSHOP', 'SOYE', 'FACIL'] },
};

interface ConferenciaSupabaseItem {
  codigo: string;
  sku?: string | null;
  secao?: string | null;
  quantidadePedida: number;
  quantidadeReal: number | null;
  status: string;
  photo?: string | null;
}

export interface EnviarConferenciaSupabasePayload {
  empresa: string;
  flag?: string;
  conferenceId?: string;
  clickupTaskId?: string | null;
  taskOrigemIds?: string[];
  conferente: string;
  listeiro?: string | null;
  tempo?: string;
  tempoSegundos?: number;
  totalItens?: number;
  resumo?: {
    separado?: number;
    naoTem?: number;
    parcial?: number;
    pendente?: number;
  };
  itens: ConferenciaSupabaseItem[];
}

interface PedidoRow {
  id: string;
  empresa: EmpresaKey;
  flag: FlagKey;
  titulo: string | null;
  pessoa: string | null;
  listeiro: string | null;
  conferente: string | null;
  status: string;
  data_conferencia: string;
  tempo_segundos: number | null;
  total_itens: number | null;
  resumo_separado: number | null;
  resumo_nao_tem: number | null;
  resumo_parcial: number | null;
  resumo_pendente: number | null;
  clickup_task_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PedidoItemRow {
  id: string;
  pedido_id: string;
  codigo: string;
  sku: string | null;
  secao: string | null;
  quantidade_pedida: number | null;
  quantidade_real: number | null;
  status: ConferenceStatusSupabase;
  foto_url: string | null;
  ordem: number | null;
}

function normalizarEmpresa(value: unknown): EmpresaKey {
  const empresa = String(value ?? 'NEWSHOP').trim().toUpperCase();
  if (empresa.includes('SOYE')) return 'SOYE';
  if (empresa.includes('FACIL')) return 'FACIL';
  return 'NEWSHOP';
}

function normalizarFlag(value: unknown): FlagKey {
  return String(value ?? 'loja').trim().toLowerCase() === 'cd' ? 'cd' : 'loja';
}

function hojeSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function secondsFromTime(value: string | null | undefined): number | null {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function isStorageUrl(value: string | null | undefined): boolean {
  return Boolean(value && value.includes('/storage/v1/object/public/'));
}

function toStatusSupabase(value: string): ConferenceStatusSupabase {
  if (value === 'separado' || value === 'nao_tem' || value === 'nao_tem_tudo' || value === 'pendente') {
    return value;
  }
  return 'pendente';
}

function toReportStatus(value: string): string {
  return value === 'nao_tem_tudo' ? 'parcial' : value;
}

function labelData(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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

export function getDashboardEmpresasFiltro(filtro: DashboardEmpresaFiltroKey): EmpresaKey[] {
  return DASHBOARD_EMPRESA_FILTROS[filtro]?.empresas ?? ['NEWSHOP'];
}

export function getDashboardEmpresaFiltroLabel(filtro: DashboardEmpresaFiltroKey): string {
  return DASHBOARD_EMPRESA_FILTROS[filtro]?.label ?? 'NEWSHOP';
}

export function getDashboardFiltrosPermitidos(empresasPermitidas: EmpresaKey[]): DashboardEmpresaFiltroKey[] {
  const set = new Set(empresasPermitidas);
  const filtros: DashboardEmpresaFiltroKey[] = [];
  if (set.has('NEWSHOP')) filtros.push('NEWSHOP');
  if (set.has('FACIL')) filtros.push('SO_FACIL');
  if (set.has('SOYE')) filtros.push('SO_SOYE');
  if (set.has('SOYE') && set.has('FACIL')) filtros.push('SOYE_FACIL');
  if (set.has('NEWSHOP') && set.has('SOYE') && set.has('FACIL')) filtros.push('TUDO');
  return filtros.length > 0 ? filtros : ['NEWSHOP'];
}

export async function enviarConferenciaParaSupabase(payload: EnviarConferenciaSupabasePayload): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (!Array.isArray(payload.itens) || payload.itens.length === 0) return;

  const empresa = normalizarEmpresa(payload.empresa);
  const flag = normalizarFlag(payload.flag);
  const dataConferencia = hojeSaoPaulo();
  const tempoSegundos = payload.tempoSegundos ?? secondsFromTime(payload.tempo);
  const resumo = payload.resumo ?? {};
  const totalItens = payload.totalItens ?? payload.itens.length;
  const observacoes = [
    payload.conferenceId ? `conferenceId=${payload.conferenceId}` : null,
    payload.taskOrigemIds?.length ? `origem=${payload.taskOrigemIds.join(',')}` : null,
  ].filter(Boolean).join(' | ');

  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .insert({
      empresa,
      flag,
      titulo: `Conferencia ${payload.conferente || 'sem conferente'} - ${labelData(dataConferencia)}`,
      pessoa: payload.listeiro || payload.conferente || null,
      listeiro: payload.listeiro || null,
      conferente: payload.conferente || null,
      status: 'concluido',
      data_conferencia: dataConferencia,
      tempo_segundos: tempoSegundos,
      total_itens: totalItens,
      resumo_separado: resumo.separado ?? 0,
      resumo_nao_tem: resumo.naoTem ?? 0,
      resumo_parcial: resumo.parcial ?? 0,
      resumo_pendente: resumo.pendente ?? 0,
      clickup_task_id: payload.clickupTaskId ?? null,
      observacao: observacoes || null,
      concluido_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (pedidoError) throw pedidoError;
  const pedidoId = pedido?.id as string | undefined;
  if (!pedidoId) throw new Error('Supabase nao retornou o ID do pedido');

  try {
    const rows = payload.itens.map((item, index) => ({
      pedido_id: pedidoId,
      codigo: String(item.codigo ?? '').trim(),
      sku: item.sku || null,
      secao: item.secao || null,
      quantidade_pedida: Number(item.quantidadePedida ?? 0),
      quantidade_real: item.quantidadeReal == null ? null : Number(item.quantidadeReal),
      status: toStatusSupabase(String(item.status ?? 'pendente')),
      foto_url: isStorageUrl(item.photo) ? item.photo : null,
      ordem: index + 1,
    })).filter((item) => item.codigo);

    for (const lote of chunk(rows, 500)) {
      const { error } = await supabase.from('pedido_itens').insert(lote);
      if (error) throw error;
    }

    const { error: rpcError } = await supabase.rpc('recalcular_resumo_pedido', { p_pedido_id: pedidoId });
    if (rpcError) throw rpcError;
  } catch (error) {
    await supabase.from('pedidos').delete().eq('id', pedidoId);
    throw error;
  }
}

export async function listarDatasComConferencia(
  empresas: EmpresaKey[],
  flag: FlagKey
): Promise<RelatorioDataOption[]> {
  if (!isSupabaseConfigured) return [];

  const rows = await selectAll<any>(() => supabase
    .from('dashboard_diario')
    .select('data,total_conferencias')
    .in('empresa', empresas)
    .eq('flag', flag)
    .order('data', { ascending: false }));

  const porData = new Map<string, number>();
  for (const row of rows) {
    const data = String(row.data ?? '');
    if (!data) continue;
    porData.set(data, (porData.get(data) ?? 0) + Number(row.total_conferencias ?? 0));
  }

  return Array.from(porData.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([data, total]) => ({
      data,
      label: labelData(data),
      total,
      relatorioGerado: true,
    }));
}

async function fetchPedidosConcluidos(params: {
  empresas: EmpresaKey[];
  flag: FlagKey;
  datas?: string[];
  de?: string;
  ate?: string;
}): Promise<PedidoRow[]> {
  if (!isSupabaseConfigured) return [];

  return await selectAll<PedidoRow>(() => {
    let query = supabase
      .from('pedidos')
      .select('*')
      .in('empresa', params.empresas)
      .eq('flag', params.flag)
      .eq('status', 'concluido')
      .not('data_conferencia', 'is', null);

    if (params.datas?.length) query = query.in('data_conferencia', params.datas);
    if (params.de) query = query.gte('data_conferencia', params.de);
    if (params.ate) query = query.lte('data_conferencia', params.ate);

    return query.order('data_conferencia', { ascending: true });
  });
}

async function fetchItensPedidos(pedidoIds: string[]): Promise<PedidoItemRow[]> {
  if (!isSupabaseConfigured || pedidoIds.length === 0) return [];

  const rows: PedidoItemRow[] = [];
  for (const ids of chunk(pedidoIds, 200)) {
    rows.push(...await selectAll<PedidoItemRow>(() => supabase
      .from('pedido_itens')
      .select('*')
      .in('pedido_id', ids)
      .order('ordem', { ascending: true })));
  }
  return rows;
}

function montarRelatorios(pedidos: PedidoRow[], itens: PedidoItemRow[], empresaBase: EmpresaKey, flag: FlagKey): RelatorioDiario[] {
  const itensPorPedido = new Map<string, PedidoItemRow[]>();
  for (const item of itens) {
    const lista = itensPorPedido.get(item.pedido_id) ?? [];
    lista.push(item);
    itensPorPedido.set(item.pedido_id, lista);
  }

  const datas = Array.from(new Set(pedidos.map((pedido) => pedido.data_conferencia).filter(Boolean))).sort();

  return datas.map((data) => {
    const pedidosDia = pedidos.filter((pedido) => pedido.data_conferencia === data);
    const itensDia: RelatorioDiarioItem[] = [];
    const conferenteMap = new Map<string, RelatorioDiarioConferente>();
    const secaoMap = new Map<string, RelatorioDiarioSecao>();

    const resumo = pedidosDia.reduce(
      (acc, pedido) => {
        acc.totalItens += Number(pedido.total_itens ?? 0);
        acc.separado += Number(pedido.resumo_separado ?? 0);
        acc.naoTem += Number(pedido.resumo_nao_tem ?? 0);
        acc.parcial += Number(pedido.resumo_parcial ?? 0);
        acc.pendente += Number(pedido.resumo_pendente ?? 0);

        const nome = pedido.conferente || pedido.pessoa || 'Sem conferente';
        const atual = conferenteMap.get(nome) ?? {
          nome,
          conferencias: 0,
          totalItens: 0,
          separado: 0,
          naoTem: 0,
          parcial: 0,
          pendente: 0,
          tempoTotalMinutos: 0,
          tempoConfs: 0,
        };
        atual.conferencias += 1;
        atual.totalItens += Number(pedido.total_itens ?? 0);
        atual.separado += Number(pedido.resumo_separado ?? 0);
        atual.naoTem += Number(pedido.resumo_nao_tem ?? 0);
        atual.parcial += Number(pedido.resumo_parcial ?? 0);
        atual.pendente += Number(pedido.resumo_pendente ?? 0);
        if (pedido.tempo_segundos && pedido.tempo_segundos > 0) {
          atual.tempoTotalMinutos = (atual.tempoTotalMinutos ?? 0) + pedido.tempo_segundos / 60;
          atual.tempoConfs = (atual.tempoConfs ?? 0) + 1;
        }
        conferenteMap.set(nome, atual);

        return acc;
      },
      { totalItens: 0, separado: 0, naoTem: 0, parcial: 0, pendente: 0 }
    );

    for (const pedido of pedidosDia) {
      const conferente = pedido.conferente || pedido.pessoa || 'Sem conferente';
      for (const item of itensPorPedido.get(pedido.id) ?? []) {
        const status = toReportStatus(item.status);
        const reportItem: RelatorioDiarioItem = {
          codigo: item.codigo,
          sku: item.sku ?? '',
          secao: item.secao || 'Sem categoria',
          pedido: Number(item.quantidade_pedida ?? 0),
          real: item.quantidade_real == null ? null : Number(item.quantidade_real),
          status,
          conferente,
          taskId: pedido.clickup_task_id || pedido.id,
          photo: item.foto_url,
        };
        itensDia.push(reportItem);

        if (status === 'nao_tem' || status === 'parcial') {
          const secao = reportItem.secao || 'Sem categoria';
          const atual = secaoMap.get(secao) ?? { nome: secao, total: 0, naoTem: 0, parcial: 0 };
          atual.total += 1;
          if (status === 'nao_tem') atual.naoTem += 1;
          if (status === 'parcial') atual.parcial += 1;
          secaoMap.set(secao, atual);
        }
      }
    }

    return {
      type: 'daily-conference-report',
      empresa: empresaBase,
      flag,
      data,
      geradoEm: new Date().toISOString(),
      totalConferencias: pedidosDia.length,
      resumo,
      porConferente: Array.from(conferenteMap.values()).sort((a, b) => b.totalItens - a.totalItens),
      porSecao: Array.from(secaoMap.values()).sort((a, b) => b.total - a.total),
      itens: itensDia,
      itensCriticos: itensDia.filter((item) => item.status === 'nao_tem' || item.status === 'parcial'),
      conferencias: pedidosDia.map((pedido) => ({
        taskId: pedido.clickup_task_id || pedido.id,
        name: pedido.titulo || pedido.id,
        conferente: pedido.conferente || pedido.pessoa || 'Sem conferente',
        totalItens: Number(pedido.total_itens ?? 0),
      })),
      ignoradas: [],
      clickupTaskId: null,
    };
  });
}

export async function buscarRelatoriosPorDatas(
  empresas: EmpresaKey[],
  flag: FlagKey,
  datas: string[]
): Promise<RelatorioDiario[]> {
  const datasValidas = Array.from(new Set(datas.filter(Boolean))).sort();
  if (!isSupabaseConfigured || datasValidas.length === 0) return [];

  const pedidos = await fetchPedidosConcluidos({ empresas, flag, datas: datasValidas });
  const itens = await fetchItensPedidos(pedidos.map((pedido) => pedido.id));
  return montarRelatorios(pedidos, itens, empresas[0] ?? 'NEWSHOP', flag);
}

export async function buscarResumoPeriodo(
  empresas: EmpresaKey[],
  flag: FlagKey,
  de: string,
  ate: string
): Promise<RelatorioDiario[]> {
  if (!isSupabaseConfigured || !de || !ate) return [];
  const pedidos = await fetchPedidosConcluidos({ empresas, flag, de, ate });
  const itens = await fetchItensPedidos(pedidos.map((pedido) => pedido.id));
  return montarRelatorios(pedidos, itens, empresas[0] ?? 'NEWSHOP', flag);
}

export async function buscarResumoSemanal(empresas: EmpresaKey[], flag: FlagKey): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  return await selectAll<any>(() => supabase
    .from('dashboard_semanal')
    .select('*')
    .in('empresa', empresas)
    .eq('flag', flag)
    .order('semana_inicio', { ascending: false }));
}

export async function buscarFrequenciaItens(empresas: EmpresaKey[], flag: FlagKey, de: string, ate: string): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  return await selectAll<any>(() => supabase
    .from('dashboard_item_frequencia')
    .select('*')
    .in('empresa', empresas)
    .eq('flag', flag)
    .gte('data', de)
    .lte('data', ate)
    .order('data', { ascending: true }));
}

export async function buscarPorConferente(empresas: EmpresaKey[], flag: FlagKey, de: string, ate: string): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  return await selectAll<any>(() => supabase
    .from('dashboard_por_conferente')
    .select('*')
    .in('empresa', empresas)
    .eq('flag', flag)
    .gte('data', de)
    .lte('data', ate)
    .order('data', { ascending: true }));
}

export async function buscarPorSecao(empresas: EmpresaKey[], flag: FlagKey, de: string, ate: string): Promise<any[]> {
  if (!isSupabaseConfigured) return [];
  return await selectAll<any>(() => supabase
    .from('dashboard_por_secao')
    .select('*')
    .in('empresa', empresas)
    .eq('flag', flag)
    .gte('data', de)
    .lte('data', ate)
    .order('data', { ascending: true }));
}
