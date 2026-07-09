import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  listarMeusPedidos,
  type MeuPedidoResumo,
} from "@/lib/pedidosFila";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

type StatusKey = "pendente" | "analisado" | "em_andamento" | "concluido";

const STATUS_META: Record<StatusKey, { label: string; classes: string }> = {
  pendente: {
    label: "Pendente",
    classes: "border-slate-300 bg-slate-100 text-slate-700",
  },
  analisado: {
    label: "Analisado",
    classes: "border-sky-300 bg-sky-100 text-sky-800",
  },
  em_andamento: {
    label: "Em andamento",
    classes: "border-amber-300 bg-amber-100 text-amber-800",
  },
  concluido: {
    label: "Concluido",
    classes: "border-emerald-300 bg-emerald-100 text-emerald-800",
  },
};

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

function ResumoChip(props: { label: string; value: number; classes: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${props.classes}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">
        {props.label}
      </div>
      <div className="mt-1 text-lg font-bold">{props.value}</div>
    </div>
  );
}

export default function MeusPedidos() {
  const { loginSalvo } = useAuth();
  const [pedidos, setPedidos] = useState<MeuPedidoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const carregamentoRef = useRef(0);
  const carregarRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);

  const empresa = loginSalvo?.empresa ?? "NEWSHOP";
  const flag = loginSalvo?.flag ?? "loja";
  const nomeLogado = String(loginSalvo?.nomePessoa ?? "").trim();

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

    if (!nomeLogado) {
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
      const data = await listarMeusPedidos(empresa, flag, nomeLogado);
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
  }, [empresa, flag, nomeLogado, loginSalvo]);

  useEffect(() => {
    if (!loginSalvo || !isSupabaseConfigured || !nomeLogado) return;

    const channel = supabase
      .channel(`meus-pedidos:${empresa}:${flag}:${nomeLogado}`)
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
  }, [empresa, flag, loginSalvo, nomeLogado]);

  const stats = useMemo(
    () => ({
      total: pedidos.length,
      abertos: pedidos.filter((pedido) => pedido.status !== "concluido").length,
      concluidos: pedidos.filter((pedido) => pedido.status === "concluido").length,
    }),
    [pedidos]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <ClipboardList className="h-4 w-4" />
              Meus Pedidos
            </div>
            <h1 className="mt-2 text-2xl font-black text-foreground md:text-3xl">
              Acompanhe os pedidos que voce enviou
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Operador: <span className="font-semibold text-foreground">{nomeLogado || "-"}</span> | {empresa} | {flag.toUpperCase()}
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Total
            </div>
            <div className="mt-2 text-3xl font-black text-foreground">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Abertos
            </div>
            <div className="mt-2 text-3xl font-black text-sky-700">{stats.abertos}</div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Concluidos
            </div>
            <div className="mt-2 text-3xl font-black text-emerald-700">{stats.concluidos}</div>
          </div>
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
              Assim que voce enviar pedidos com este login, eles aparecem aqui.
            </p>
          </div>
        ) : (
          pedidos.map((pedido) => {
            const status = getStatusMeta(pedido.status);

            return (
              <article key={pedido.id} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-black text-foreground">{pedido.titulo}</h2>
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${status.classes}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Clock3 className="h-4 w-4" />
                        Criado em {formatDateTime(pedido.createdAt)}
                      </span>
                      {pedido.status === "concluido" && (
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Conferido em {formatDateTime(pedido.dataConferencia)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Itens
                    </div>
                    <div className="mt-1 text-2xl font-black text-foreground">{pedido.totalItens}</div>
                  </div>
                </div>

                {pedido.status === "concluido" ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <ResumoChip
                      label="Separado"
                      value={pedido.resumoSeparado}
                      classes="border-emerald-200 bg-emerald-50 text-emerald-800"
                    />
                    <ResumoChip
                      label="Nao tem"
                      value={pedido.resumoNaoTem}
                      classes="border-rose-200 bg-rose-50 text-rose-800"
                    />
                    <ResumoChip
                      label="Parcial"
                      value={pedido.resumoParcial}
                      classes="border-amber-200 bg-amber-50 text-amber-800"
                    />
                    <ResumoChip
                      label="Pendente"
                      value={pedido.resumoPendente}
                      classes="border-slate-200 bg-slate-50 text-slate-800"
                    />
                    <div className="rounded-xl border border-border bg-background px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Conferente
                      </div>
                      <div className="mt-1 text-sm font-bold text-foreground">{pedido.conferente || "-"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    {pedido.status === "analisado" && "Pedido pronto para conferencia."}
                    {pedido.status === "em_andamento" && "Pedido em conferencia agora."}
                    {pedido.status === "pendente" && "Pedido ainda nao foi liberado para conferencia."}
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
