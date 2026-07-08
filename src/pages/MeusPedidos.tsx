import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  Package,
  PackageCheck,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  carregarItensDoPedido,
  listarPedidos,
  type MeuPedidoResumo,
  type PedidoFilaItem,
} from "@/lib/pedidosFila";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const ITEM_STATUS_META: Record<string, { label: string; classes: string }> = {
  separado: { label: "Separado", classes: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  nao_tem: { label: "Nao tem", classes: "border-rose-200 bg-rose-50 text-rose-800" },
  nao_tem_tudo: { label: "Parcial", classes: "border-amber-200 bg-amber-50 text-amber-800" },
  pendente: { label: "Pendente", classes: "border-slate-200 bg-slate-50 text-slate-700" },
};

type EscopoPessoa = "todos" | "meus";
type PeriodoFiltro = "total" | "7" | "15" | "30" | "intervalo";
type StatusKey = "pendente" | "analisado" | "em_andamento" | "concluido";

const STATUS_META: Record<StatusKey, { label: string; classes: string }> = {
  pendente: {
    label: "Pendente",
    classes: "border-slate-300 bg-slate-100 text-slate-700",
  },
  analisado: {
    label: "Analisado",
    classes: "border-amber-300 bg-amber-100 text-amber-800",
  },
  em_andamento: {
    label: "Em andamento",
    classes: "border-sky-300 bg-sky-100 text-sky-800",
  },
  concluido: {
    label: "Concluido",
    classes: "border-emerald-300 bg-emerald-100 text-emerald-800",
  },
};

const PERIODO_OPCOES: Array<{ value: PeriodoFiltro; label: string }> = [
  { value: "total", label: "Total" },
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "intervalo", label: "Intervalo" },
];

function getItemStatusMeta(status: string) {
  return ITEM_STATUS_META[status] ?? ITEM_STATUS_META.pendente;
}

function getStatusMeta(status: string) {
  return STATUS_META[(status as StatusKey) ?? "pendente"] ?? STATUS_META.pendente;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolverDatas(periodo: PeriodoFiltro, dataInicio: string, dataFim: string): { dataInicio?: string; dataFim?: string } {
  if (periodo === "intervalo") {
    return {
      dataInicio: dataInicio || undefined,
      dataFim: dataFim || undefined,
    };
  }

  if (periodo === "total") return {};

  const dias = Number(periodo);
  if (!Number.isFinite(dias) || dias <= 0) return {};

  const data = new Date();
  data.setDate(data.getDate() - dias);
  return { dataInicio: formatDateInputValue(data) };
}

function useDebouncedValue(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, value]);

  return debounced;
}

function getFiltroButtonClasses(active: boolean, disabled = false): string {
  const base =
    "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition";

  if (disabled) {
    return `${base} cursor-not-allowed border-border bg-muted/60 text-muted-foreground opacity-60`;
  }

  if (active) {
    return `${base} border-primary bg-primary text-primary-foreground shadow-sm`;
  }

  return `${base} border-border bg-background text-foreground hover:bg-accent`;
}

function ResumoChip(props: { label: string; value: number; classes: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${props.classes}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">{props.label}</div>
      <div className="mt-1 text-lg font-bold">{props.value}</div>
    </div>
  );
}

function itemCombinaProduto(item: PedidoFilaItem, termo: string): boolean {
  const t = termo.trim().toLowerCase();
  if (!t) return false;
  return (
    item.codigo.toLowerCase().includes(t) ||
    item.descricao.toLowerCase().includes(t) ||
    item.sku.toLowerCase().includes(t) ||
    (item.secao ?? "").toLowerCase().includes(t)
  );
}

export default function MeusPedidos() {
  const { loginSalvo } = useAuth();
  const [pedidos, setPedidos] = useState<MeuPedidoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [itensPorPedido, setItensPorPedido] = useState<Record<string, PedidoFilaItem[]>>({});
  const [carregandoItensId, setCarregandoItensId] = useState<string | null>(null);
  const [erroItensId, setErroItensId] = useState<string | null>(null);
  const [escopoPessoa, setEscopoPessoa] = useState<EscopoPessoa>("todos");
  const [buscaProduto, setBuscaProduto] = useState("");
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("total");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const buscaProdutoDebounced = useDebouncedValue(buscaProduto);
  const buscaPessoaDebounced = useDebouncedValue(buscaPessoa);
  const carregamentoRef = useRef(0);
  const carregarRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);

  const empresa = loginSalvo?.empresa ?? "NEWSHOP";
  const flag = loginSalvo?.flag ?? "loja";
  const nomeLogado = String(loginSalvo?.nomePessoa ?? "").trim();
  const pessoaBadgeAtiva = escopoPessoa === "todos";
  const filtrosAtivos =
    escopoPessoa === "meus" ||
    (escopoPessoa === "todos" && Boolean(buscaPessoa.trim())) ||
    Boolean(buscaProduto.trim()) ||
    periodo !== "total";

  const carregar = async (silent = false) => {
    const requestId = ++carregamentoRef.current;

    if (!loginSalvo) {
      setPedidos([]);
      setError("Login nao encontrado.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setPedidos([]);
      setError("Supabase nao configurado neste ambiente.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (escopoPessoa === "meus" && !nomeLogado) {
      setPedidos([]);
      setError("Login sem nome de operador para filtrar meus pedidos.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const pessoaFiltro = escopoPessoa === "meus" ? nomeLogado || undefined : buscaPessoa.trim() || undefined;
      const produtoBusca = buscaProduto.trim() || undefined;
      const datas = resolverDatas(periodo, dataInicio, dataFim);

      const data = await listarPedidos({
        empresa,
        flag,
        pessoa: pessoaFiltro,
        produtoBusca,
        ...datas,
      });

      if (requestId !== carregamentoRef.current) return;

      setPedidos(data);
      setError(null);
    } catch (err) {
      if (requestId !== carregamentoRef.current) return;
      console.error("[MeusPedidos] Falha ao listar pedidos:", err);
      setError("Nao foi possivel carregar os pedidos agora.");
    } finally {
      if (requestId === carregamentoRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  carregarRef.current = carregar;

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa, flag, nomeLogado, escopoPessoa, buscaProdutoDebounced, buscaPessoaDebounced, periodo, dataInicio, dataFim]);

  // Ao buscar por produto, abre o primeiro pedido que casou pra ja mostrar o item em laranja.
  useEffect(() => {
    const termo = buscaProdutoDebounced.trim();
    if (!termo || pedidos.length === 0) return;
    const primeiro = pedidos[0];
    setExpandidoId(primeiro.id);
    if (itensPorPedido[primeiro.id]) return;
    setCarregandoItensId(primeiro.id);
    setErroItensId(null);
    carregarItensDoPedido(primeiro.id)
      .then((itens) => setItensPorPedido((prev) => ({ ...prev, [primeiro.id]: itens })))
      .catch((err) => {
        console.error("[MeusPedidos] Falha ao carregar itens do pedido:", err);
        setErroItensId(primeiro.id);
      })
      .finally(() => setCarregandoItensId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaProdutoDebounced, pedidos]);

  const toggleItens = async (pedidoId: string) => {
    if (expandidoId === pedidoId) {
      setExpandidoId(null);
      return;
    }

    setExpandidoId(pedidoId);
    if (itensPorPedido[pedidoId]) return;

    setCarregandoItensId(pedidoId);
    setErroItensId(null);
    try {
      const itens = await carregarItensDoPedido(pedidoId);
      setItensPorPedido((prev) => ({ ...prev, [pedidoId]: itens }));
    } catch (err) {
      console.error("[MeusPedidos] Falha ao carregar itens do pedido:", err);
      setErroItensId(pedidoId);
    } finally {
      setCarregandoItensId(null);
    }
  };

  useEffect(() => {
    if (!loginSalvo || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`pedidos:${empresa}:${flag}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos", filter: `empresa=eq.${empresa}` },
        () => {
          void carregarRef.current(true);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [empresa, flag, loginSalvo]);

  const stats = useMemo(
    () => ({
      total: pedidos.length,
      abertos: pedidos.filter((pedido) => pedido.status !== "concluido").length,
      concluidos: pedidos.filter((pedido) => pedido.status === "concluido").length,
    }),
    [pedidos]
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-8">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <ClipboardList className="h-4 w-4" />
              Pedidos
            </div>
            <h1 className="mt-2 text-2xl font-black text-foreground md:text-3xl">
              Acompanhe os pedidos da sua empresa
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Operador: <span className="font-semibold text-foreground">{nomeLogado || "-"}</span> · {empresa} · {flag.toUpperCase()}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void carregar(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total</div>
            <div className="mt-2 text-3xl font-black text-foreground">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Abertos</div>
            <div className="mt-2 text-3xl font-black text-sky-700">{stats.abertos}</div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Concluidos</div>
            <div className="mt-2 text-3xl font-black text-emerald-700">{stats.concluidos}</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-background p-4">
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_1.2fr]">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pessoa</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEscopoPessoa("todos")}
                  className={getFiltroButtonClasses(escopoPessoa === "todos")}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setEscopoPessoa("meus")}
                  disabled={!nomeLogado}
                  className={getFiltroButtonClasses(escopoPessoa === "meus", !nomeLogado)}
                >
                  Meus pedidos
                </button>
              </div>
              <Input
                value={buscaPessoa}
                onChange={(event) => setBuscaPessoa(event.target.value)}
                placeholder="Filtrar por pessoa"
                disabled={escopoPessoa === "meus"}
                className="h-11 rounded-xl border-border"
              />
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Produto</div>
              <Input
                value={buscaProduto}
                onChange={(event) => setBuscaProduto(event.target.value)}
                placeholder="Buscar produto"
                className="h-11 rounded-xl border-border"
              />
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Periodo</div>
              <div className="flex flex-wrap gap-2">
                {PERIODO_OPCOES.map((opcao) => (
                  <button
                    key={opcao.value}
                    type="button"
                    onClick={() => setPeriodo(opcao.value)}
                    className={getFiltroButtonClasses(periodo === opcao.value)}
                  >
                    {opcao.label}
                  </button>
                ))}
              </div>

              {periodo === "intervalo" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(event) => setDataInicio(event.target.value)}
                    className="h-11 rounded-xl border-border"
                  />
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(event) => setDataFim(event.target.value)}
                    className="h-11 rounded-xl border-border"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </section>
      )}

      <section className="grid gap-4">
        {loading && pedidos.length === 0 ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <div className="h-5 w-40 animate-pulse rounded bg-muted" />
              <div className="mt-4 h-4 w-full animate-pulse rounded bg-muted" />
              <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ))
        ) : pedidos.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-10 text-center shadow-sm">
            <PackageCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-bold text-foreground">Nenhum pedido encontrado</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {filtrosAtivos
                ? "Ajuste os filtros e tente novamente."
                : "Assim que houver pedidos neste escopo, eles aparecem aqui."}
            </p>
          </div>
        ) : (
          pedidos.map((pedido) => {
            const status = getStatusMeta(pedido.status);
            const responsavel = pedido.listeiro || pedido.pessoa || "-";

            return (
              <article key={pedido.id} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-black text-foreground">{pedido.titulo}</h2>
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${status.classes}`}>
                        {status.label}
                      </span>
                      {pessoaBadgeAtiva && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">
                          <UserRound className="h-3.5 w-3.5" />
                          {responsavel}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:flex-wrap md:items-center md:gap-4">
                      <span className="inline-flex items-center gap-2">
                        <Clock3 className="h-4 w-4" />
                        Criado em {formatDateTime(pedido.createdAt)}
                      </span>
                      {!pessoaBadgeAtiva && (
                        <span className="inline-flex items-center gap-2">
                          <UserRound className="h-4 w-4" />
                          Listeiro {responsavel}
                        </span>
                      )}
                      {pedido.status === "concluido" && (
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Fechado em {formatDate(pedido.dataConferencia)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Itens</div>
                    <div className="mt-1 text-2xl font-black text-foreground">{pedido.totalItens}</div>
                  </div>
                </div>

                {pedido.status === "concluido" ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-5">
                    <ResumoChip label="Separado" value={pedido.resumoSeparado} classes="border-emerald-200 bg-emerald-50 text-emerald-800" />
                    <ResumoChip label="Nao tem" value={pedido.resumoNaoTem} classes="border-rose-200 bg-rose-50 text-rose-800" />
                    <ResumoChip label="Parcial" value={pedido.resumoParcial} classes="border-amber-200 bg-amber-50 text-amber-800" />
                    <ResumoChip label="Pendente" value={pedido.resumoPendente} classes="border-slate-200 bg-slate-50 text-slate-800" />
                    <div className="rounded-xl border border-border bg-background px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Conferente</div>
                      <div className="mt-1 text-sm font-bold text-foreground">{pedido.conferente || "-"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    {pedido.status === "analisado" && "Pedido pronto para conferencia."}
                    {pedido.status === "em_andamento" && "Pedido reservado em outra sessao ou em conferencia agora."}
                    {pedido.status === "pendente" && "Pedido ainda nao foi liberado para conferencia."}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void toggleItens(pedido.id)}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  {expandidoId === pedido.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {expandidoId === pedido.id ? "Ocultar itens" : `Ver itens (${pedido.totalItens})`}
                </button>

                {expandidoId === pedido.id && (
                  <div className="mt-3 rounded-2xl border border-border bg-background p-3">
                    {carregandoItensId === pedido.id ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div key={index} className="h-10 animate-pulse rounded-lg bg-muted" />
                        ))}
                      </div>
                    ) : erroItensId === pedido.id ? (
                      <p className="text-sm text-destructive">Nao foi possivel carregar os itens deste pedido.</p>
                    ) : (itensPorPedido[pedido.id]?.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
                    ) : (
                      <div className="space-y-2">
                        {itensPorPedido[pedido.id].map((item) => {
                          const itemStatus = getItemStatusMeta(item.status);
                          const destacado = itemCombinaProduto(item, buscaProdutoDebounced);
                          return (
                            <div
                              key={item.id}
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                                destacado
                                  ? "border-orange-400 bg-orange-50 ring-1 ring-orange-300 dark:bg-orange-500/10"
                                  : "border-border"
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {item.photo ? (
                                  <img src={item.photo} alt={item.codigo} className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" />
                                ) : (
                                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                                    <Package className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  {item.descricao && (
                                    <div className="truncate text-xs font-bold text-foreground">{item.descricao}</div>
                                  )}
                                  <div className="truncate font-mono text-[11px] text-muted-foreground">{item.codigo}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">{item.sku || item.secao || "-"}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground">
                                  {item.quantidadeReal ?? "-"} / {item.quantidadePedida}
                                </span>
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${itemStatus.classes}`}>
                                  {itemStatus.label}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
