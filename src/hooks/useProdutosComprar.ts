import { useState, useEffect, useCallback, useRef } from 'react';
import { obterLoginSalvo } from '@/hooks/useAuth';
import {
  upsertComprasFromClickup,
  fetchComprasSupabase,
  fetchPedidosFeitosSupabase,
  subscribeComprasSupabase,
  atualizarStatusPorId,
  atualizarSecaoPorId,
  atualizarSecaoPorClickup,
  atualizarDescricaoPorId,
  atualizarDescricaoPorClickup,
  marcarPedidoFeitoPorId,
  marcarPedidoFeitoPorClickup,
  persistirFotoCompra,
  isFotoStorage,
  type PedidoFeitoCompraRow,
} from '@/lib/comprasSupabase';
import { lerComprasCache, salvarComprasCache } from '@/lib/comprasCache';

// Fonte de dados da tela de Compras: 'clickup' (padrao atual) ou 'supabase' (piloto).
export type CompraFonte = 'clickup' | 'supabase';

export interface ProdutoComprar {
  id: string;
  codigo: string;
  sku: string | null;
  descricao: string;
  foto: string | null;
  status: CompraStatusApp;
  date_created: string;
  vezesPedido: number;
  // Secao do produto, quando ja persistida no Supabase (evita reconsultar o ERP).
  secao?: string | null;
  // true quando o pedido ao fornecedor ja foi feito (coluna pedido_feito).
  pedidoFeito?: boolean;
}

export type CompraStatusApp =
  | 'todo'
  | 'produto_bom'
  | 'produto_ruim'
  | 'fazer_pedido'
  | 'pedido_andamento'
  | 'compra_realizada'
  | 'concluido';

interface UseProdutosComprarReturn {
  produtos: ProdutoComprar[];
  loading: boolean;
  error: string | null;
  ultimaAtualizacao: Date | null;
  empresa: 'NEWSHOP' | 'SOYE' | 'FACIL';
  fonte: CompraFonte;
  setFonte: (fonte: CompraFonte) => void;
  persistirSecao: (produtoId: string, secao: string) => void;
  persistirDescricao: (produtoId: string, descricao: string) => void;
  persistirFoto: (produtoId: string, dataUrl: string) => void;
  marcarPedidoFeito: (produtoId: string) => Promise<void>;
  refetch: () => Promise<void>;
  like: (taskId: string) => Promise<void>;
  dislike: (taskId: string) => Promise<void>;
  fazerPedido: (taskId: string) => Promise<void>;
  pedidoAndamento: (taskId: string) => Promise<void>;
  compraRealizada: (taskId: string) => Promise<void>;
  concluir: (taskId: string) => Promise<void>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const FONTE_KEY = 'compras:fonte';

function getFonteSalva(): CompraFonte {
  // ClickUp removido: Supabase e a unica fonte. Mantido como funcao (em vez de
  // constante) so pra nao precisar tocar nos ~15 call-sites que chamam getFonteSalva().
  return 'supabase';
}

function setFonteSalva(fonte: CompraFonte) {
  try {
    window.localStorage.setItem(FONTE_KEY, fonte);
  } catch {
    // preferencia opcional
  }
}

function getEmpresaAtual(): 'NEWSHOP' | 'SOYE' | 'FACIL' {
  const login = obterLoginSalvo();
  if (login?.empresa === 'SOYE' || login?.empresa === 'FACIL') {
    return login.empresa;
  }
  return 'NEWSHOP';
}

// Prioridade de deduplicacao: quando o mesmo produto aparece em varias tasks,
// mantemos a de maior prioridade. `todo` (Pendente) fica ABAIXO de qualquer status
// que ja passou por analise — incluindo os finais (andamento/realizada/concluido) —
// para que uma re-importacao da planilha nao ressuscite como "pendente" um produto
// que ja foi analisado/comprado. So reaparece se nunca tiver sido analisado.
const STATUS_DUPLICADO_PRIORITY: Record<CompraStatusApp, number> = {
  fazer_pedido: 400,
  produto_bom: 300,
  produto_ruim: 200,
  pedido_andamento: 150,
  compra_realizada: 140,
  concluido: 130,
  todo: 100,
};

const STATUS_FINAIS = new Set<CompraStatusApp>(['compra_realizada', 'concluido']);

function normalizarProdutoKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function getProdutoKey(produto: ProdutoComprar): string {
  const codigo = normalizarProdutoKey(produto.codigo);
  const codigoNumerico = codigo.match(/\d{6,14}/)?.[0];
  if (codigoNumerico) return `COD:${codigoNumerico}`;

  const sku = normalizarProdutoKey(produto.sku);
  if (sku) return `SKU:${sku}`;

  return codigo ? `COD:${codigo}` : '';
}

function deveSubstituirProduto(mantido: ProdutoComprar, candidato: ProdutoComprar): boolean {
  const prioridadeMantido = STATUS_DUPLICADO_PRIORITY[mantido.status] ?? 0;
  const prioridadeCandidato = STATUS_DUPLICADO_PRIORITY[candidato.status] ?? 0;

  if (prioridadeCandidato !== prioridadeMantido) {
    return prioridadeCandidato > prioridadeMantido;
  }

  return Number(candidato.date_created || 0) > Number(mantido.date_created || 0);
}

function deduplicarProdutos(produtos: ProdutoComprar[]): ProdutoComprar[] {
  const porProduto = new Map<string, ProdutoComprar>();
  // Soma vezesPedido em vez de contar ocorrências brutas: o servidor já manda os
  // produtos deduplicados com a contagem real, então essa passagem precisa ser
  // idempotente (não pode "resetar" pra 1 quando já não há duplicado no array).
  const somaPorChave = new Map<string, number>();
  const semChave: ProdutoComprar[] = [];

  for (const produto of produtos) {
    const key = getProdutoKey(produto);
    const vezes = produto.vezesPedido ?? 1;
    if (!key) {
      semChave.push({ ...produto, vezesPedido: vezes });
      continue;
    }

    somaPorChave.set(key, (somaPorChave.get(key) ?? 0) + vezes);

    const mantido = porProduto.get(key);
    if (!mantido || deveSubstituirProduto(mantido, produto)) {
      porProduto.set(key, produto);
    }
  }

  const resultado = [...porProduto.entries()].map(([key, produto]) => ({
    ...produto,
    vezesPedido: somaPorChave.get(key) ?? 1,
  }));

  return [...semChave, ...resultado];
}

function aplicarPedidosFeitosSupabase(
  produtos: ProdutoComprar[],
  pedidosFeitos: PedidoFeitoCompraRow[]
): ProdutoComprar[] {
  if (pedidosFeitos.length === 0) return produtos;

  const porTaskId = new Map<string, PedidoFeitoCompraRow>();
  const porProdutoKey = new Map<string, PedidoFeitoCompraRow>();

  for (const row of pedidosFeitos) {
    if (row.clickup_task_id) porTaskId.set(row.clickup_task_id, row);
    if (row.produto_key) porProdutoKey.set(row.produto_key, row);
  }

  return produtos.map((produto) => {
    const row = porTaskId.get(produto.id) ?? porProdutoKey.get(getProdutoKey(produto));
    if (!row || row.pedido_feito !== 1) return produto;

    const status = STATUS_FINAIS.has(produto.status)
      ? produto.status
      : STATUS_FINAIS.has(row.status)
        ? row.status
        : 'pedido_andamento';

    return { ...produto, pedidoFeito: true, status };
  });
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

function getProdutosCacheKey(empresa: 'NEWSHOP' | 'SOYE' | 'FACIL'): string {
  return `compras:produtos:${empresa}`;
}

function readProdutosCache(empresa: 'NEWSHOP' | 'SOYE' | 'FACIL'): { produtos: ProdutoComprar[]; updatedAt: number } | null {
  try {
    const raw = window.localStorage.getItem(getProdutosCacheKey(empresa));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { produtos?: ProdutoComprar[]; updatedAt?: number };
    if (!Array.isArray(parsed.produtos) || typeof parsed.updatedAt !== 'number') return null;

    return {
      produtos: deduplicarProdutos(parsed.produtos),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function writeProdutosCache(empresa: 'NEWSHOP' | 'SOYE' | 'FACIL', produtos: ProdutoComprar[]) {
  try {
    window.localStorage.setItem(
      getProdutosCacheKey(empresa),
      JSON.stringify({ produtos, updatedAt: Date.now() })
    );
  } catch {
    // Cache local nao e obrigatorio para o fluxo funcionar.
  }
}

export const useProdutosComprar = (): UseProdutosComprarReturn => {
  const [produtos, setProdutos] = useState<ProdutoComprar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<Date | null>(null);
  const [empresa, setEmpresa] = useState<'NEWSHOP' | 'SOYE' | 'FACIL'>(() => getEmpresaAtual());
  const [fonte, setFonteState] = useState<CompraFonte>(() => getFonteSalva());
  const requestControllerRef = useRef<AbortController | null>(null);

  const fetchProdutos = useCallback(async (force = false) => {
    const empresaAtual = getEmpresaAtual();
    setEmpresa(empresaAtual);

    // Fonte Supabase: mostra o cache IndexedDB na hora e revalida em segundo plano
    // (stale-while-revalidate). Realtime atualiza depois via efeito abaixo.
    if (fonte === 'supabase') {
      const cacheKey = `supabase:${empresaAtual}`;
      const cache = await lerComprasCache(cacheKey);
      if (cache && cache.length > 0) {
        setProdutos(cache);
        setUltimaAtualizacao(new Date());
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const lista = await fetchComprasSupabase(empresaAtual);
        setProdutos(lista);
        setUltimaAtualizacao(new Date());
        void salvarComprasCache(cacheKey, lista);
      } catch (err: unknown) {
        console.error('[useProdutosComprar][supabase] Erro ao buscar:', err);
        if (!cache) setError(getErrorMessage(err, 'Falha ao carregar do Supabase'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const cache = readProdutosCache(empresaAtual);

    if (cache && !force) {
      // Cache so substitui o estado em carga normal; num refetch forcado
      // (apos mover status) ele e mais velho que a UI e revertia o status.
      setProdutos(cache.produtos);
      setUltimaAtualizacao(new Date(cache.updatedAt));
      setLoading(false);

      if (Date.now() - cache.updatedAt < CACHE_TTL_MS) {
        setError(null);
        return;
      }
    } else if (!cache) {
      setLoading(true);
    }

    setError(null);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch(`/api/clickup-compras-proxy?action=buscar-tasks&empresa=${empresaAtual}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = body.error ?? `Erro ${response.status}`;
        const context = body.empresa ? ` [empresa=${body.empresa}]` : '';
        throw new Error(`${detail}${context}`);
      }

      const data = await response.json();
      let produtosAtualizados = deduplicarProdutos(data.produtos ?? []);
      try {
        await upsertComprasFromClickup(produtosAtualizados, empresaAtual);
        const pedidosFeitos = await fetchPedidosFeitosSupabase(empresaAtual);
        produtosAtualizados = aplicarPedidosFeitosSupabase(produtosAtualizados, pedidosFeitos);
      } catch (err) {
        console.warn('[compras][supabase] pedido_feito/dual-write falhou (ignorado):', err);
      }
      setProdutos(produtosAtualizados);
      const updatedAt = new Date();
      setUltimaAtualizacao(updatedAt);
      writeProdutosCache(empresaAtual, produtosAtualizados);

    } catch (err: unknown) {
      if (isAbortError(err)) {
        return;
      }
      console.error('[useProdutosComprar] Erro ao buscar:', err);
      setError(getErrorMessage(err, 'Falha ao carregar produtos'));
    } finally {
      if (requestControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [fonte]);

  useEffect(() => {
    fetchProdutos();

    return () => {
      requestControllerRef.current?.abort();
    };
  }, [fetchProdutos]);

  // Realtime: quando a fonte e Supabase, assina mudancas da tabela e recarrega.
  useEffect(() => {
    if (fonte !== 'supabase') return;
    const empresaAtual = getEmpresaAtual();
    const unsubscribe = subscribeComprasSupabase(empresaAtual, () => {
      void fetchProdutos(true);
    });
    return unsubscribe;
  }, [fonte, fetchProdutos]);

  const executarAcao = useCallback(async (taskId: string, acao: string) => {
    const empresaAtual = getEmpresaAtual();
    const produtoAtual = produtos.find((p) => p.id === taskId);
    const statusAnterior = produtoAtual?.status;
    const pedidoFeitoAnterior = produtoAtual?.pedidoFeito;
    const previsao: Record<string, CompraStatusApp> = {
      LIKE: 'produto_bom',
      DISLIKE: 'produto_ruim',
      FAZER_PEDIDO: 'fazer_pedido',
      PEDIDO_ANDAMENTO: 'pedido_andamento',
      COMPRA_REALIZADA: 'compra_realizada',
      CONCLUIR: 'concluido',
    };
    const marcaPedidoFeito = acao === 'FAZER_PEDIDO';
    const statusPrevisto = marcaPedidoFeito ? 'pedido_andamento' : previsao[acao];

    if (statusPrevisto) {
      setProdutos((prev) =>
        prev.map((p) => (
          p.id === taskId
            ? { ...p, status: statusPrevisto, pedidoFeito: marcaPedidoFeito ? true : p.pedidoFeito }
            : p
        ))
      );
    }

    // Fonte Supabase: atualiza o status pelo UUID da linha. O realtime propaga a
    // mudanca; um refetch garante consistencia local.
    if (fonte === 'supabase') {
      try {
        if (marcaPedidoFeito) {
          await marcarPedidoFeitoPorId(taskId);
        } else if (statusPrevisto) {
          await atualizarStatusPorId(taskId, statusPrevisto);
        }
        await fetchProdutos(true);
      } catch (err: unknown) {
        if (statusAnterior) {
          setProdutos((prev) =>
            prev.map((p) => (
              p.id === taskId ? { ...p, status: statusAnterior, pedidoFeito: pedidoFeitoAnterior } : p
            ))
          );
        }
        console.error('[useProdutosComprar][supabase] Erro na acao:', err);
        throw err;
      }
      return;
    }

    try {
      const response = await fetch('/api/clickup-compras-proxy?action=mover-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          acao,
          empresa: empresaAtual,
          currentStatus: produtoAtual?.status ?? 'todo',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        await fetchProdutos(true);
        const detalhe = data.details ? `: ${data.details}` : '';
        const statusDisponiveis = Array.isArray(data.availableStatuses) && data.availableStatuses.length > 0
          ? ` | Status disponiveis: ${data.availableStatuses.join(', ')}`
          : '';
        const statusTentados = Array.isArray(data.attemptedStatuses) && data.attemptedStatuses.length > 0
          ? ` | Status tentados: ${data.attemptedStatuses.join(', ')}`
          : '';
        throw new Error((data.error ?? 'Erro ao executar acao') + detalhe + statusDisponiveis + statusTentados);
      }

      if (marcaPedidoFeito) {
        if (produtoAtual) {
          await upsertComprasFromClickup([{ ...produtoAtual, status: 'fazer_pedido' }], empresaAtual);
        }
        await marcarPedidoFeitoPorClickup(empresaAtual, taskId);
      }

      await fetchProdutos(true);
    } catch (err: unknown) {
      if (statusAnterior) {
        setProdutos((prev) =>
          prev.map((p) => (
            p.id === taskId ? { ...p, status: statusAnterior, pedidoFeito: pedidoFeitoAnterior } : p
          ))
        );
      }
      console.error('[useProdutosComprar] Erro na acao:', err);
      throw err;
    }
  }, [fonte, fetchProdutos, produtos]);

  const setFonte = useCallback((nova: CompraFonte) => {
    setFonteSalva(nova);
    setFonteState(nova);
  }, []);

  // Persiste a secao (vinda do ERP na primeira carga) no Supabase, para nao
  // precisar reconsultar o ERP so pela secao nas proximas vezes. Best-effort.
  const persistirSecao = useCallback((produtoId: string, secao: string) => {
    if (!secao) return;
    setProdutos((prev) =>
      prev.map((p) => (p.id === produtoId && p.secao !== secao ? { ...p, secao } : p))
    );
    const empresaAtual = getEmpresaAtual();
    const acao = fonte === 'supabase'
      ? atualizarSecaoPorId(produtoId, secao)
      : atualizarSecaoPorClickup(empresaAtual, produtoId, secao);
    void acao.catch((err) => {
      console.warn('[compras][supabase] persistir secao falhou (ignorado):', err);
    });
  }, [fonte]);

  // Persiste a descricao real vinda do ERP. Alguns itens antigos entraram no banco
  // com codigo de barras no lugar do nome do produto.
  const persistirDescricao = useCallback((produtoId: string, descricao: string) => {
    const descricaoLimpa = descricao.trim();
    if (!descricaoLimpa) return;
    setProdutos((prev) =>
      prev.map((p) => (p.id === produtoId && p.descricao !== descricaoLimpa ? { ...p, descricao: descricaoLimpa } : p))
    );
    const empresaAtual = getEmpresaAtual();
    const acao = fonte === 'supabase'
      ? atualizarDescricaoPorId(produtoId, descricaoLimpa)
      : atualizarDescricaoPorClickup(empresaAtual, produtoId, descricaoLimpa);
    void acao.catch((err) => {
      console.warn('[compras][supabase] persistir descricao falhou (ignorado):', err);
    });
  }, [fonte]);

  // Sobe a foto (data URL do ERP) no Storage e guarda a URL no Supabase, uma vez
  // por produto, para nao rebaixar do ERP nas proximas cargas. Best-effort.
  const persistirFoto = useCallback((produtoId: string, dataUrl: string) => {
    if (!dataUrl) return;
    const produto = produtos.find((p) => p.id === produtoId);
    if (!produto || isFotoStorage(produto.foto)) return;
    const empresaAtual = getEmpresaAtual();
    void persistirFotoCompra({
      produtoId,
      empresa: empresaAtual,
      codigo: produto.codigo,
      sku: produto.sku,
      dataUrl,
      porUuid: fonte === 'supabase',
    })
      .then((url) => {
        if (url) {
          setProdutos((prev) => prev.map((p) => (p.id === produtoId ? { ...p, foto: url } : p)));
        }
      })
      .catch((err) => {
        console.warn('[compras][supabase] persistir foto falhou (ignorado):', err);
      });
  }, [fonte, produtos]);

  // Marca "pedido feito" no Supabase (substitui o anexo de PDF na task do ClickUp).
  // O item vai automaticamente para 'pedido_andamento' (via trigger no banco),
  // menos se ja estiver em compra_realizada/concluido. Update otimista + revert.
  const marcarPedidoFeito = useCallback(async (produtoId: string) => {
    const empresaAtual = getEmpresaAtual();
    const anterior = produtos.find((p) => p.id === produtoId);
    const statusFinal = anterior && (anterior.status === 'compra_realizada' || anterior.status === 'concluido')
      ? anterior.status
      : 'pedido_andamento';
    setProdutos((prev) =>
      prev.map((p) => (p.id === produtoId ? { ...p, pedidoFeito: true, status: statusFinal } : p))
    );
    try {
      if (fonte === 'supabase') {
        await marcarPedidoFeitoPorId(produtoId);
      } else {
        if (anterior) {
          await upsertComprasFromClickup([anterior], empresaAtual);
        }
        await marcarPedidoFeitoPorClickup(empresaAtual, produtoId);
      }
    } catch (err) {
      if (anterior) {
        setProdutos((prev) =>
          prev.map((p) => (p.id === produtoId ? { ...p, pedidoFeito: anterior.pedidoFeito, status: anterior.status } : p))
        );
      }
      throw err;
    }
  }, [fonte, produtos]);

  const like = useCallback((id: string) => executarAcao(id, 'LIKE'), [executarAcao]);
  const dislike = useCallback((id: string) => executarAcao(id, 'DISLIKE'), [executarAcao]);
  const fazerPedido = useCallback((id: string) => executarAcao(id, 'FAZER_PEDIDO'), [executarAcao]);
  const pedidoAndamento = useCallback((id: string) => executarAcao(id, 'PEDIDO_ANDAMENTO'), [executarAcao]);
  const compraRealizada = useCallback((id: string) => executarAcao(id, 'COMPRA_REALIZADA'), [executarAcao]);
  const concluir = useCallback((id: string) => executarAcao(id, 'CONCLUIR'), [executarAcao]);

  return {
    produtos,
    loading,
    error,
    ultimaAtualizacao,
    empresa,
    fonte,
    setFonte,
    persistirSecao,
    persistirDescricao,
    persistirFoto,
    marcarPedidoFeito,
    refetch: () => fetchProdutos(true),
    like,
    dislike,
    fazerPedido,
    pedidoAndamento,
    compraRealizada,
    concluir,
  };
};
