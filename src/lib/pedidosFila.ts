import { isSupabaseConfigured, supabase } from './supabaseClient';

const TRIGGER_API_KEY = import.meta.env.VITE_TRIGGER_API_KEY as string;
const STORAGE_URL_MARKER = '/storage/v1/object/public/';
const ERP_FOTO_SYNC_TASK_ID = 'erp-foto-sync';
const EXPEDICAO_SYNC_TASK_ID = 'expedicao-sync';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type EmpresaKey = 'NEWSHOP' | 'SOYE' | 'FACIL';
export type FlagKey = 'loja' | 'cd';

interface PedidoFilaRow {
  id: string;
  titulo: string | null;
  listeiro: string | null;
  pessoa: string | null;
  status: string;
  created_at: string | null;
  clickup_task_id: string | null;
}

interface MeuPedidoRow {
  id: string;
  titulo: string | null;
  pessoa: string | null;
  listeiro: string | null;
  conferente: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  data_conferencia: string | null;
  total_itens: number | null;
  resumo_separado: number | null;
  resumo_nao_tem: number | null;
  resumo_parcial: number | null;
  resumo_pendente: number | null;
}

interface PedidoFilaItemRow {
  id: string;
  pedido_id: string;
  codigo: string;
  sku: string | null;
  secao: string | null;
  quantidade_pedida: number | null;
  quantidade_real: number | null;
  status: 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente';
  foto_url: string | null;
  ordem: number | null;
}

export interface PedidoParaConferencia {
  id: string;
  name: string;
  listeiro: string;
  date_created: string;
  emAndamento: boolean;
  clickupTaskId: string | null;
  description?: string;
  attachments?: any[];
}

export interface PedidoFilaItem {
  id: string;
  pedidoId: string;
  codigo: string;
  sku: string;
  secao: string | null;
  quantidadePedida: number;
  quantidadeReal: number | null;
  status: 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente';
  photo: string | null;
  ordem: number;
}

export interface MeuPedidoResumo {
  id: string;
  titulo: string;
  pessoa: string;
  listeiro: string;
  conferente: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  dataConferencia: string | null;
  totalItens: number;
  resumoSeparado: number;
  resumoNaoTem: number;
  resumoParcial: number;
  resumoPendente: number;
}

export interface FecharConferenciaItemPayload {
  codigo: string;
  sku?: string | null;
  secao?: string | null;
  quantidadePedida: number;
  quantidadeReal: number | null;
  status: 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente' | 'aguardando';
  photo?: string | null;
}

export interface FecharConferenciaPayload {
  empresa: string;
  conferente: string;
  tempoSegundos?: number | null;
  itens: FecharConferenciaItemPayload[];
}

export interface PedidoFilaProduto {
  barcode: string;
  sku: string;
  quantidade: number;
  removeTag: boolean;
  secao?: string | null;
  photo: string | null;
  description?: string;
  erpProdutoId?: string;
  appPhotoWithoutErp?: boolean;
}

export interface EnviarListaParaConferenciaPayload {
  flag: string;
  empresa: string;
  pessoa: string;
  titulo: string;
  totalItens: number;
  dataCriacao: string;
  conferenceId?: string;
  produtos: PedidoFilaProduto[];
}

export interface EnviarListaParaConferenciaResult {
  pedidoId: string;
  conferenceId: string;
  created: boolean;
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

function isStorageUrl(value: string | null | undefined): boolean {
  return Boolean(value && value.includes(STORAGE_URL_MARKER));
}

function isFotoBase64(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith('data:image/'));
}

function dataUrlParaBlob(dataUrl: string): { blob: Blob; contentType: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

const FOTO_CONFERENCIA_BUCKET = 'compras-fotos';

// Sobe a foto tirada no app (data URL) pro Storage e devolve a URL publica.
// Best-effort: se falhar, loga e devolve null (o item so fica sem foto, nao
// derruba o envio/fechamento da conferencia).
async function uploadFotoConferencia(empresa: EmpresaKey, codigo: string, photo: string): Promise<string | null> {
  const conv = dataUrlParaBlob(photo);
  if (!conv) return null;

  const safeCodigo = String(codigo ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '_') || 'sem-codigo';
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `conferencia/${empresa}/${safeCodigo}-${sufixo}.jpg`;

  try {
    const up = await supabase.storage.from(FOTO_CONFERENCIA_BUCKET).upload(path, conv.blob, {
      contentType: conv.contentType,
      upsert: true,
    });
    if (up.error) throw up.error;
    return supabase.storage.from(FOTO_CONFERENCIA_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (error) {
    console.warn('[pedidosFila] Falha ao subir foto pro Storage (item fica sem foto):', codigo, error);
    return null;
  }
}

// Resolve a foto de um item pra uma URL de Storage: se ja for URL, usa direto;
// se for base64 (foto tirada agora no app), sobe pro Storage; senao, null.
async function resolverFotoParaStorage(
  empresa: EmpresaKey,
  codigo: string,
  photo: string | null | undefined
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (isStorageUrl(photo)) return photo as string;
  if (isFotoBase64(photo)) return uploadFotoConferencia(empresa, codigo, photo as string);
  return null;
}

async function resolverFotosEmLote<T>(
  empresa: EmpresaKey,
  itens: T[],
  getCodigo: (item: T) => string,
  getFoto: (item: T) => string | null | undefined
): Promise<Array<string | null>> {
  return Promise.all(itens.map((item) => resolverFotoParaStorage(empresa, getCodigo(item), getFoto(item))));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function resolveConferenceId(payload: EnviarListaParaConferenciaPayload): string {
  const explicit = String(payload.conferenceId ?? '').trim();
  if (explicit) return explicit;

  const key = [
    normalizarEmpresa(payload.empresa),
    normalizarFlag(payload.flag),
    String(payload.pessoa ?? '').trim(),
    String(payload.titulo ?? '').trim(),
    String(payload.dataCriacao ?? '').trim(),
  ].join('|');

  return `lista-${hashString(key)}`;
}

function buildProdutoCatalogoPayload(
  produtos: PedidoFilaProduto[],
  fotosResolvidas: Array<string | null>
): Array<Record<string, string | null>> {
  return produtos
    .map((produto, index) => ({
      codigo: String(produto.barcode ?? '').trim() || null,
      sku: String(produto.sku ?? '').trim() || null,
      descricao: String(produto.description ?? '').trim() || null,
      secao: String(produto.secao ?? '').trim() || null,
      foto_url: fotosResolvidas[index] ?? null,
    }))
    .filter((produto) => produto.codigo || produto.sku);
}

function toStatusConferencia(
  value: FecharConferenciaItemPayload['status']
): 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente' {
  if (value === 'separado' || value === 'nao_tem' || value === 'nao_tem_tudo' || value === 'pendente') {
    return value;
  }
  return 'pendente';
}

async function buildPedidoItemRows(
  empresa: EmpresaKey,
  pedidoId: string,
  itens: FecharConferenciaItemPayload[]
): Promise<Array<{
  pedido_id: string;
  codigo: string;
  sku: string | null;
  secao: string | null;
  quantidade_pedida: number;
  quantidade_real: number | null;
  status: 'separado' | 'nao_tem' | 'nao_tem_tudo' | 'pendente';
  foto_url: string | null;
  ordem: number;
}>> {
  const fotosResolvidas = await resolverFotosEmLote(
    empresa,
    itens,
    (item) => String(item.codigo ?? '').trim(),
    (item) => item.photo
  );

  return itens
    .map((item, index) => ({
      pedido_id: pedidoId,
      codigo: String(item.codigo ?? '').trim(),
      sku: String(item.sku ?? '').trim() || null,
      secao: String(item.secao ?? '').trim() || null,
      quantidade_pedida: toInt(item.quantidadePedida),
      quantidade_real: item.quantidadeReal == null ? null : toInt(item.quantidadeReal),
      status: toStatusConferencia(item.status),
      foto_url: fotosResolvidas[index] ?? null,
      ordem: index + 1,
    }))
    .filter((item) => item.codigo);
}

export async function listarPedidosParaConferencia(
  empresa: string,
  flag: string
): Promise<PedidoParaConferencia[]> {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('pedidos')
    .select('id,titulo,listeiro,pessoa,status,created_at,clickup_task_id')
    .eq('empresa', normalizarEmpresa(empresa))
    .eq('flag', normalizarFlag(flag))
    .in('status', ['analisado', 'em_andamento'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  return ((data ?? []) as PedidoFilaRow[]).map((pedido) => ({
    id: pedido.id,
    name: String(pedido.titulo ?? pedido.id).trim() || pedido.id,
    listeiro: String(pedido.listeiro ?? pedido.pessoa ?? '').trim(),
    date_created: pedido.created_at ? String(new Date(pedido.created_at).getTime()) : '',
    emAndamento: pedido.status === 'em_andamento',
    clickupTaskId: pedido.clickup_task_id ?? null,
  }));
}

function mapMeuPedido(row: MeuPedidoRow): MeuPedidoResumo {
  return {
    id: row.id,
    titulo: String(row.titulo ?? row.id).trim() || row.id,
    pessoa: String(row.pessoa ?? '').trim(),
    listeiro: String(row.listeiro ?? '').trim(),
    conferente: String(row.conferente ?? '').trim(),
    status: String(row.status ?? '').trim() || 'pendente',
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    dataConferencia: row.data_conferencia ?? null,
    totalItens: toInt(row.total_itens),
    resumoSeparado: toInt(row.resumo_separado),
    resumoNaoTem: toInt(row.resumo_nao_tem),
    resumoParcial: toInt(row.resumo_parcial),
    resumoPendente: toInt(row.resumo_pendente),
  };
}

export async function listarMeusPedidos(
  empresa: string,
  flag: string,
  pessoa: string
): Promise<MeuPedidoResumo[]> {
  if (!isSupabaseConfigured) return [];

  const pessoaNormalizada = String(pessoa ?? '').trim();
  if (!pessoaNormalizada) return [];

  const selectColumns = [
    'id',
    'titulo',
    'pessoa',
    'listeiro',
    'conferente',
    'status',
    'created_at',
    'updated_at',
    'data_conferencia',
    'total_itens',
    'resumo_separado',
    'resumo_nao_tem',
    'resumo_parcial',
    'resumo_pendente',
  ].join(',');

  const criarQuery = () =>
    supabase
      .from('pedidos')
      .select(selectColumns)
      .eq('empresa', normalizarEmpresa(empresa))
      .eq('flag', normalizarFlag(flag))
      .order('created_at', { ascending: false });

  const [{ data: porPessoa, error: errorPessoa }, { data: porListeiro, error: errorListeiro }] = await Promise.all([
    criarQuery().eq('pessoa', pessoaNormalizada),
    criarQuery().eq('listeiro', pessoaNormalizada),
  ]);

  if (errorPessoa) throw errorPessoa;
  if (errorListeiro) throw errorListeiro;

  const pedidos = [...((porPessoa ?? []) as MeuPedidoRow[]), ...((porListeiro ?? []) as MeuPedidoRow[])]
    .reduce<Map<string, MeuPedidoResumo>>((acc, row) => {
      acc.set(row.id, mapMeuPedido(row));
      return acc;
    }, new Map());

  return Array.from(pedidos.values()).sort((a, b) => {
    const timeA = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0;
    const timeB = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0;
    return timeB - timeA;
  });
}

export async function reservarPedido(
  pedidoId: string,
  pessoa: string,
  forcar = false
): Promise<void> {
  if (!isSupabaseConfigured || !pedidoId) return;

  const { data, error } = await supabase.rpc('reservar_pedido_conferencia', {
    p_pedido_id: pedidoId,
    p_pessoa: String(pessoa ?? '').trim() || 'Sem conferente',
    p_forcar: forcar,
  });

  if (error) throw error;
  if (data !== true) {
    throw new Error('Pedido ja esta em andamento e nao pode ser reservado agora.');
  }
}

export async function liberarPedido(pedidoId: string): Promise<void> {
  if (!isSupabaseConfigured || !pedidoId) return;

  const { error } = await supabase.rpc('liberar_pedido_conferencia', {
    p_pedido_id: pedidoId,
  });

  if (error) throw error;
}

export function liberarPedidoEmSegundoPlano(pedidoId: string): void {
  if (!pedidoId || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  void fetch(`${SUPABASE_URL}/rest/v1/rpc/liberar_pedido_conferencia`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ p_pedido_id: pedidoId }),
  }).catch(() => undefined);
}

export async function carregarItensDoPedido(pedidoId: string): Promise<PedidoFilaItem[]> {
  if (!isSupabaseConfigured || !pedidoId) return [];

  const { data, error } = await supabase
    .from('pedido_itens')
    .select('id,pedido_id,codigo,sku,secao,quantidade_pedida,quantidade_real,status,foto_url,ordem')
    .eq('pedido_id', pedidoId)
    .order('ordem', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as PedidoFilaItemRow[]).map((item, index) => ({
    id: item.id,
    pedidoId: item.pedido_id,
    codigo: String(item.codigo ?? '').trim(),
    sku: String(item.sku ?? '').trim(),
    secao: item.secao ?? null,
    quantidadePedida: toInt(item.quantidade_pedida),
    quantidadeReal: item.quantidade_real == null ? null : toInt(item.quantidade_real),
    status: item.status,
    photo: item.foto_url ?? null,
    ordem: item.ordem ?? index + 1,
  }));
}

export async function enviarListaParaConferencia(
  payload: EnviarListaParaConferenciaPayload
): Promise<EnviarListaParaConferenciaResult | null> {
  if (!isSupabaseConfigured) return null;
  if (!Array.isArray(payload.produtos) || payload.produtos.length === 0) return null;

  const empresa = normalizarEmpresa(payload.empresa);
  const flag = normalizarFlag(payload.flag);
  const conferenceId = resolveConferenceId(payload);

  const { data: existing, error: existingError } = await supabase
    .from('pedidos')
    .select('id')
    .eq('conference_id', conferenceId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) {
    return { pedidoId: existing.id, conferenceId, created: false };
  }

  const observacao = [`conferenceId=${conferenceId}`, 'origem=enviar-para-conferencia'].join(' | ');
  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .insert({
      empresa,
      flag,
      titulo: String(payload.titulo ?? '').trim() || `Lista ${payload.pessoa || 'sem nome'}`,
      pessoa: String(payload.pessoa ?? '').trim() || null,
      listeiro: String(payload.pessoa ?? '').trim() || null,
      conferente: null,
      status: 'analisado',
      total_itens: toInt(payload.totalItens, payload.produtos.length),
      resumo_separado: 0,
      resumo_nao_tem: 0,
      resumo_parcial: 0,
      resumo_pendente: payload.produtos.length,
      observacao,
      conference_id: conferenceId,
    })
    .select('id')
    .single();

  if (pedidoError) throw pedidoError;
  const pedidoId = String(pedido?.id ?? '').trim();
  if (!pedidoId) throw new Error('Supabase nao retornou o ID do pedido');

  try {
    const fotosResolvidas = await resolverFotosEmLote(
      empresa,
      payload.produtos,
      (produto) => String(produto.barcode ?? '').trim(),
      (produto) => produto.photo
    );

    const rows = payload.produtos
      .map((produto, index) => ({
        pedido_id: pedidoId,
        codigo: String(produto.barcode ?? '').trim(),
        sku: String(produto.sku ?? '').trim() || null,
        descricao: String(produto.description ?? '').trim() || null,
        secao: String(produto.secao ?? '').trim() || null,
        quantidade_pedida: toInt(produto.quantidade),
        quantidade_real: null,
        status: 'pendente',
        foto_url: fotosResolvidas[index] ?? null,
        ordem: index + 1,
      }))
      .filter((item) => item.codigo);

    if (rows.length === 0) {
      throw new Error('Nenhum item valido para gravar em pedido_itens');
    }

    for (const lote of chunk(rows, 500)) {
      const { error } = await supabase.from('pedido_itens').insert(lote);
      if (error) throw error;
    }

    const { error: rpcError } = await supabase.rpc('recalcular_resumo_pedido', { p_pedido_id: pedidoId });
    if (rpcError) throw rpcError;

    const produtosCatalogo = buildProdutoCatalogoPayload(payload.produtos, fotosResolvidas);
    if (produtosCatalogo.length > 0) {
      const { error: upsertError } = await supabase.rpc('upsert_produtos', { p: produtosCatalogo });
      if (upsertError) {
        console.warn('[pedidosFila] upsert_produtos falhou (best-effort):', upsertError);
      }
    }

    return { pedidoId, conferenceId, created: true };
  } catch (error) {
    await supabase.from('pedidos').delete().eq('id', pedidoId);
    throw error;
  }
}

export async function removerListaDaConferencia(pedidoId: string): Promise<void> {
  if (!isSupabaseConfigured || !pedidoId) return;
  const { error } = await supabase.from('pedidos').delete().eq('id', pedidoId);
  if (error) throw error;
}

export async function dispararErpFotoSyncLista(payload: EnviarListaParaConferenciaPayload): Promise<void> {
  const itens = (payload.produtos ?? [])
    .filter((produto) => produto.appPhotoWithoutErp && produto.erpProdutoId && produto.photo)
    .map((produto) => ({
      erpProdutoId: String(produto.erpProdutoId),
      photoBase64: String(produto.photo),
      barcode: String(produto.barcode ?? '').trim(),
    }));

  if (itens.length === 0) return;
  if (!TRIGGER_API_KEY) {
    console.warn('[pedidosFila] VITE_TRIGGER_API_KEY nao configurada. erp-foto-sync nao disparado.');
    return;
  }

  const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${ERP_FOTO_SYNC_TASK_ID}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TRIGGER_API_KEY}`,
    },
    body: JSON.stringify({
      payload: {
        empresa: normalizarEmpresa(payload.empresa),
        itens,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`[Trigger.dev] Erro ${response.status} ao disparar ${ERP_FOTO_SYNC_TASK_ID}: ${detail || 'sem detalhe'}`);
  }
}

export async function fecharConferenciaExistente(
  pedidoId: string,
  payload: FecharConferenciaPayload
): Promise<void> {
  if (!isSupabaseConfigured || !pedidoId) return;
  if (!Array.isArray(payload.itens) || payload.itens.length === 0) {
    throw new Error('Conferencia sem itens para concluir');
  }

  const empresa = normalizarEmpresa(payload.empresa);
  const novosItens = await buildPedidoItemRows(empresa, pedidoId, payload.itens);
  if (novosItens.length === 0) {
    throw new Error('Nenhum item valido para concluir pedido');
  }

  const itensOriginais = await carregarItensDoPedido(pedidoId);

  try {
    const { error: deleteError } = await supabase.from('pedido_itens').delete().eq('pedido_id', pedidoId);
    if (deleteError) throw deleteError;

    for (const lote of chunk(novosItens, 500)) {
      const { error } = await supabase.from('pedido_itens').insert(lote);
      if (error) throw error;
    }

    const { error: rpcError } = await supabase.rpc('recalcular_resumo_pedido', { p_pedido_id: pedidoId });
    if (rpcError) throw rpcError;

    const { error: updateError } = await supabase
      .from('pedidos')
      .update({
        conferente: String(payload.conferente ?? '').trim() || null,
        tempo_segundos: payload.tempoSegundos == null ? null : toInt(payload.tempoSegundos),
        status: 'concluido',
        em_conferencia_por: null,
        em_conferencia_em: null,
      })
      .eq('id', pedidoId);

    if (updateError) throw updateError;
  } catch (error) {
    try {
      const { error: restoreDeleteError } = await supabase.from('pedido_itens').delete().eq('pedido_id', pedidoId);
      if (restoreDeleteError) throw restoreDeleteError;

      const itensRestore = await buildPedidoItemRows(
        empresa,
        pedidoId,
        itensOriginais.map((item) => ({
          codigo: item.codigo,
          sku: item.sku,
          secao: item.secao,
          quantidadePedida: item.quantidadePedida,
          quantidadeReal: item.quantidadeReal,
          status: item.status,
          photo: item.photo,
        }))
      );

      for (const lote of chunk(itensRestore, 500)) {
        const { error: restoreInsertError } = await supabase.from('pedido_itens').insert(lote);
        if (restoreInsertError) throw restoreInsertError;
      }

      await supabase.rpc('recalcular_resumo_pedido', { p_pedido_id: pedidoId });
    } catch (restoreError) {
      console.error('[pedidosFila] Falha ao restaurar itens apos erro no fechamento:', restoreError);
    }

    throw error;
  }
}

export async function dispararExpedicaoConferencia(params: {
  conferente: string;
  empresa: string;
  dataConferencia?: string;
  itens: FecharConferenciaItemPayload[];
}): Promise<void> {
  const itens = (params.itens ?? [])
    .filter((item) => item.status === 'separado' || item.status === 'nao_tem_tudo')
    .map((item) => ({
      descricao: String(item.sku ?? item.codigo ?? '').trim() || String(item.codigo ?? '').trim(),
      ean: String(item.codigo ?? '').trim(),
      quantidadeReal: toInt(item.quantidadeReal),
    }))
    .filter((item) => item.ean && item.quantidadeReal > 0);

  if (itens.length === 0) return;
  if (!TRIGGER_API_KEY) {
    console.warn('[pedidosFila] VITE_TRIGGER_API_KEY nao configurada. expedicao-sync nao disparado.');
    return;
  }

  const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${EXPEDICAO_SYNC_TASK_ID}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TRIGGER_API_KEY}`,
    },
    body: JSON.stringify({
      payload: {
        conferente: String(params.conferente ?? '').trim() || 'App Conferencia',
        empresa: normalizarEmpresa(params.empresa),
        dataConferencia: params.dataConferencia ?? new Date().toISOString(),
        itens,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`[Trigger.dev] Erro ${response.status} ao disparar ${EXPEDICAO_SYNC_TASK_ID}: ${detail || 'sem detalhe'}`);
  }
}
