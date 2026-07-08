import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock3,
  Layers3,
  Package,
  PackageCheck,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { useAuth, type Empresa, type LoginFlag } from "@/hooks/useAuth";
import {
  getDashboardEmpresaFiltroLabel,
  getDashboardEmpresasFiltro,
  getDashboardFiltrosPermitidos,
  listarDashboardDiario,
  listarDashboardItemFrequencia,
  listarDashboardPedidosStatus,
  listarDashboardPorConferente,
  listarDashboardPorSecao,
  listarDashboardSemanal,
  type DashboardConsultaParams,
  type DashboardDiarioRow,
  type DashboardEmpresaFiltroKey,
  type DashboardFlagFiltro,
  type DashboardItemFrequenciaRow,
  type DashboardPedidosStatusRow,
  type DashboardPorConferenteRow,
  type DashboardPorSecaoRow,
  type DashboardSemanalRow,
} from "@/lib/dashboardSupabase";
import {
  PERIODO_OPCOES,
  resolverDatasPeriodo,
  type PeriodoFiltro,
} from "@/lib/periodoFiltro";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const COLORS = {
  separado: "#16a34a",
  naoTem: "#e11d48",
  parcial: "#f59e0b",
  pendente: "#64748b",
  itens: "#2563eb",
  acumulado: "#7c3aed",
  secoes: "#0f766e",
  tempo: "#ea580c",
};

const FLAG_OPCOES: Array<{ value: DashboardFlagFiltro; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "loja", label: "Loja" },
  { value: "cd", label: "CD" },
];

interface DashboardPayload {
  diario: DashboardDiarioRow[];
  semanal: DashboardSemanalRow[];
  pedidosStatus: DashboardPedidosStatusRow[];
  porConferente: DashboardPorConferenteRow[];
  porSecao: DashboardPorSecaoRow[];
  itemFrequencia: DashboardItemFrequenciaRow[];
}

interface DashboardResumo {
  totalConferencias: number;
  totalItens: number;
  separado: number;
  naoTem: number;
  parcial: number;
  pendente: number;
}

interface DashboardStatusResumo {
  pendentes: number;
  analisados: number;
  emAndamento: number;
  concluidos: number;
}

interface DashboardItemResumo {
  codigo: string;
  sku: string;
  secao: string;
  vezes: number;
  totalPedido: number;
  totalReal: number;
  fotoUrl: string | null;
}

const EMPTY_DATA: DashboardPayload = {
  diario: [],
  semanal: [],
  pedidosStatus: [],
  porConferente: [],
  porSecao: [],
  itemFrequencia: [],
};

function formatDateLabel(value: string): string {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatDuration(totalSegundos: number): string {
  const totalMinutos = Math.max(0, Math.round(totalSegundos / 60));
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}:${String(minutos).padStart(2, "0")}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function truncateLabel(value: string, limit = 18): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function getFlagLabel(flag: DashboardFlagFiltro): string {
  if (flag === "cd") return "CD";
  if (flag === "loja") return "Loja";
  return "Todos";
}

function getPeriodoResumo(periodo: PeriodoFiltro, dataInicio: string, dataFim: string): string {
  if (periodo === "intervalo") {
    if (dataInicio && dataFim) return `${formatDateLabel(dataInicio)} a ${formatDateLabel(dataFim)}`;
    if (dataInicio) return `Desde ${formatDateLabel(dataInicio)}`;
    if (dataFim) return `Até ${formatDateLabel(dataFim)}`;
    return "Intervalo aberto";
  }

  if (periodo === "total") return "Todo o histórico";
  return `Últimos ${periodo} dias`;
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

function preferirFiltroMaisAbrangente(
  filtros: DashboardEmpresaFiltroKey[],
  empresasPermitidas: Empresa[]
): DashboardEmpresaFiltroKey {
  return (
    [...filtros].sort(
      (a, b) =>
        getDashboardEmpresasFiltro(b, empresasPermitidas).length -
        getDashboardEmpresasFiltro(a, empresasPermitidas).length
    )[0] ?? "NEWSHOP"
  );
}

function somarResumoDiario(rows: DashboardDiarioRow[]): DashboardResumo {
  return rows.reduce(
    (acc, row) => {
      acc.totalConferencias += row.total_conferencias;
      acc.totalItens += row.total_itens;
      acc.separado += row.separado;
      acc.naoTem += row.nao_tem;
      acc.parcial += row.parcial;
      acc.pendente += row.pendente;
      return acc;
    },
    {
      totalConferencias: 0,
      totalItens: 0,
      separado: 0,
      naoTem: 0,
      parcial: 0,
      pendente: 0,
    }
  );
}

function somarResumoStatus(rows: DashboardPedidosStatusRow[]): DashboardStatusResumo {
  return rows.reduce(
    (acc, row) => {
      acc.pendentes += row.pendentes;
      acc.analisados += row.analisados;
      acc.emAndamento += row.em_andamento;
      acc.concluidos += row.concluidos;
      return acc;
    },
    {
      pendentes: 0,
      analisados: 0,
      emAndamento: 0,
      concluidos: 0,
    }
  );
}

function montarSeriePorDia(rows: DashboardDiarioRow[]) {
  const porData = new Map<
    string,
    { data: string; label: string; totalItens: number; totalConferencias: number }
  >();

  for (const row of rows) {
    const atual = porData.get(row.data) ?? {
      data: row.data,
      label: formatDateLabel(row.data),
      totalItens: 0,
      totalConferencias: 0,
    };

    atual.totalItens += row.total_itens;
    atual.totalConferencias += row.total_conferencias;
    porData.set(row.data, atual);
  }

  return Array.from(porData.values()).sort((a, b) => a.data.localeCompare(b.data));
}

function montarSecoes(rows: DashboardPorSecaoRow[]) {
  const porSecao = new Map<
    string,
    {
      secao: string;
      label: string;
      separado: number;
      naoTem: number;
      parcial: number;
      total: number;
    }
  >();

  for (const row of rows) {
    const atual = porSecao.get(row.secao) ?? {
      secao: row.secao,
      label: truncateLabel(row.secao, 20),
      separado: 0,
      naoTem: 0,
      parcial: 0,
      total: 0,
    };

    atual.separado += row.separado;
    atual.naoTem += row.nao_tem;
    atual.parcial += row.parcial;
    atual.total += row.total;
    porSecao.set(row.secao, atual);
  }

  return Array.from(porSecao.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function montarConferentes(rows: DashboardPorConferenteRow[]) {
  const porConferente = new Map<
    string,
    {
      conferente: string;
      label: string;
      conferencias: number;
      tempoSegundos: number;
      tempoHoras: number;
      totalItens: number;
    }
  >();

  for (const row of rows) {
    const atual = porConferente.get(row.conferente) ?? {
      conferente: row.conferente,
      label: truncateLabel(row.conferente, 18),
      conferencias: 0,
      tempoSegundos: 0,
      tempoHoras: 0,
      totalItens: 0,
    };

    atual.conferencias += row.conferencias;
    atual.tempoSegundos += row.tempo_segundos;
    atual.tempoHoras = Number((atual.tempoSegundos / 3600).toFixed(2));
    atual.totalItens += row.total_itens;
    porConferente.set(row.conferente, atual);
  }

  return Array.from(porConferente.values())
    .sort((a, b) => b.conferencias - a.conferencias || b.tempoSegundos - a.tempoSegundos)
    .slice(0, 10);
}

function montarItensFrequentes(rows: DashboardItemFrequenciaRow[]): DashboardItemResumo[] {
  const porItem = new Map<string, DashboardItemResumo>();

  for (const row of rows) {
    const key = `${row.codigo}::${row.sku}`;
    const atual = porItem.get(key) ?? {
      codigo: row.codigo,
      sku: row.sku,
      secao: row.secao,
      vezes: 0,
      totalPedido: 0,
      totalReal: 0,
      fotoUrl: row.foto_url,
    };

    atual.vezes += row.vezes;
    atual.totalPedido += row.total_pedido;
    atual.totalReal += row.total_real;
    if (!atual.fotoUrl && row.foto_url) atual.fotoUrl = row.foto_url;
    porItem.set(key, atual);
  }

  return Array.from(porItem.values()).sort(
    (a, b) => b.vezes - a.vezes || b.totalPedido - a.totalPedido
  );
}

function montarPareto(items: DashboardItemResumo[]) {
  const totalVezes = items.reduce((acc, item) => acc + item.vezes, 0);
  let acumulado = 0;

  return items.slice(0, 12).map((item) => {
    acumulado += item.vezes;
    return {
      codigo: item.codigo,
      label: truncateLabel(item.codigo, 14),
      vezes: item.vezes,
      acumulado: totalVezes > 0 ? Number(((acumulado / totalVezes) * 100).toFixed(1)) : 0,
    };
  });
}

function KpiCard(props: {
  label: string;
  value: number;
  hint: string;
  accentClass: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {props.label}
        </div>
        <div className={`rounded-xl border px-2 py-2 ${props.accentClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-3xl font-black text-foreground">{formatNumber(props.value)}</div>
      <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div>
    </div>
  );
}

function SectionCard(props: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-border bg-card p-5 shadow-sm ${props.className ?? ""}`}>
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {props.title}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{props.description}</div>
      </div>
      {props.children}
    </section>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-border bg-background text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export default function Dashboard() {
  const { loginSalvo } = useAuth();
  const [dados, setDados] = useState<DashboardPayload>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empresasPermitidas = useMemo<Empresa[]>(() => {
    const base: Empresa[] =
      loginSalvo?.empresasPermitidas && loginSalvo.empresasPermitidas.length > 0
        ? loginSalvo.empresasPermitidas
        : loginSalvo?.empresa
          ? [loginSalvo.empresa]
          : ["NEWSHOP"];

    return Array.from(new Set<Empresa>(base));
  }, [loginSalvo?.empresa, (loginSalvo?.empresasPermitidas ?? []).join("|")]);

  const filtrosEmpresaPermitidos = useMemo(
    () => getDashboardFiltrosPermitidos(empresasPermitidas),
    [empresasPermitidas]
  );

  const [empresaFiltro, setEmpresaFiltro] = useState<DashboardEmpresaFiltroKey>(() =>
    preferirFiltroMaisAbrangente(
      getDashboardFiltrosPermitidos(["NEWSHOP"]),
      ["NEWSHOP"]
    )
  );
  const [flagFiltro, setFlagFiltro] = useState<DashboardFlagFiltro>("todos");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("30");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const carregamentoRef = useRef(0);
  const carregarRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (filtrosEmpresaPermitidos.includes(empresaFiltro)) return;
    setEmpresaFiltro(preferirFiltroMaisAbrangente(filtrosEmpresaPermitidos, empresasPermitidas));
  }, [empresaFiltro, empresasPermitidas, filtrosEmpresaPermitidos]);

  const empresasSelecionadas = useMemo(
    () => getDashboardEmpresasFiltro(empresaFiltro, empresasPermitidas),
    [empresaFiltro, empresasPermitidas]
  );

  const carregar = async (silent = false) => {
    const requestId = ++carregamentoRef.current;

    if (!loginSalvo) {
      setDados(EMPTY_DATA);
      setError("Login nao encontrado.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setDados(EMPTY_DATA);
      setError("Supabase nao configurado neste ambiente.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (periodo === "intervalo" && dataInicio && dataFim && dataInicio > dataFim) {
      setError("Intervalo invalido: a data inicial precisa ser menor ou igual a final.");
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
      const datas = resolverDatasPeriodo(periodo, dataInicio, dataFim);
      const params: DashboardConsultaParams = {
        empresas: empresasSelecionadas,
        flag: flagFiltro,
        ...datas,
      };

      const [diario, semanal, pedidosStatus, porConferente, porSecao, itemFrequencia] =
        await Promise.all([
          listarDashboardDiario(params),
          listarDashboardSemanal(params),
          listarDashboardPedidosStatus({
            empresas: params.empresas,
            flag: params.flag,
          }),
          listarDashboardPorConferente(params),
          listarDashboardPorSecao(params),
          listarDashboardItemFrequencia(params),
        ]);

      if (requestId !== carregamentoRef.current) return;

      setDados({
        diario,
        semanal,
        pedidosStatus,
        porConferente,
        porSecao,
        itemFrequencia,
      });
      setError(null);
    } catch (err) {
      if (requestId !== carregamentoRef.current) return;
      console.error("[Dashboard] Falha ao carregar dashboard:", err);
      setError("Nao foi possivel carregar o dashboard agora.");
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
  }, [loginSalvo?.usuarioId, empresaFiltro, flagFiltro, periodo, dataInicio, dataFim, empresasSelecionadas.join("|")]);

  useEffect(() => {
    if (!loginSalvo || !isSupabaseConfigured) return;

    const channel = supabase
      .channel(`dashboard:${empresasSelecionadas.join("-")}:${flagFiltro}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
        void carregarRef.current(true);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => {
        void carregarRef.current(true);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [empresasSelecionadas, flagFiltro, loginSalvo]);

  const resumo = useMemo(() => somarResumoDiario(dados.diario), [dados.diario]);
  const statusAtual = useMemo(() => somarResumoStatus(dados.pedidosStatus), [dados.pedidosStatus]);
  const seriePorDia = useMemo(() => montarSeriePorDia(dados.diario), [dados.diario]);
  const secoes = useMemo(() => montarSecoes(dados.porSecao), [dados.porSecao]);
  const conferentes = useMemo(
    () => montarConferentes(dados.porConferente),
    [dados.porConferente]
  );
  const itensFrequentes = useMemo(
    () => montarItensFrequentes(dados.itemFrequencia),
    [dados.itemFrequencia]
  );
  const pareto = useMemo(() => montarPareto(itensFrequentes), [itensFrequentes]);
  const semConferencias = dados.diario.length === 0;
  const resumoPeriodo = getPeriodoResumo(periodo, dataInicio, dataFim);
  const empresaLabel = getDashboardEmpresaFiltroLabel(empresaFiltro);

  const donutData = [
    { key: "separado", label: "Separado", valor: resumo.separado, color: COLORS.separado },
    { key: "naoTem", label: "Nao tem", valor: resumo.naoTem, color: COLORS.naoTem },
    { key: "parcial", label: "Parcial", valor: resumo.parcial, color: COLORS.parcial },
    { key: "pendente", label: "Pendente", valor: resumo.pendente, color: COLORS.pendente },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 pb-8">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </div>
            <h1 className="mt-2 text-2xl font-black text-foreground md:text-3xl">
              Conferências ao vivo no Supabase
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {empresaLabel} · {getFlagLabel(flagFiltro)} · {resumoPeriodo}
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

        <div className="mt-4 rounded-2xl border border-border bg-background p-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.8fr_1.1fr]">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Empresa
              </div>
              <div className="flex flex-wrap gap-2">
                {filtrosEmpresaPermitidos.map((filtro) => (
                  <button
                    key={filtro}
                    type="button"
                    onClick={() => setEmpresaFiltro(filtro)}
                    className={getFiltroButtonClasses(empresaFiltro === filtro)}
                  >
                    {getDashboardEmpresaFiltroLabel(filtro)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Flag
              </div>
              <div className="flex flex-wrap gap-2">
                {FLAG_OPCOES.map((opcao) => (
                  <button
                    key={opcao.value}
                    type="button"
                    onClick={() => setFlagFiltro(opcao.value)}
                    className={getFiltroButtonClasses(flagFiltro === opcao.value)}
                  >
                    {opcao.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Periodo
              </div>
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

      {loading ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-4 h-8 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-3 w-32 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </section>
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-48 animate-pulse rounded bg-muted" />
                <div className="mt-5 h-[280px] animate-pulse rounded-2xl bg-muted" />
              </div>
            ))}
          </section>
        </>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Conferências"
              value={resumo.totalConferencias}
              hint="Fechadas no período"
              accentClass="border-emerald-200 bg-emerald-50 text-emerald-700"
              icon={PackageCheck}
            />
            <KpiCard
              label="Itens"
              value={resumo.totalItens}
              hint="Itens consolidados"
              accentClass="border-sky-200 bg-sky-50 text-sky-700"
              icon={Package}
            />
            <KpiCard
              label="Separado"
              value={resumo.separado}
              hint="Conferido sem divergência"
              accentClass="border-emerald-200 bg-emerald-50 text-emerald-700"
              icon={CheckCircle2}
            />
            <KpiCard
              label="Nao tem"
              value={resumo.naoTem}
              hint="Itens faltantes"
              accentClass="border-rose-200 bg-rose-50 text-rose-700"
              icon={XCircle}
            />
            <KpiCard
              label="Parcial"
              value={resumo.parcial}
              hint="Quantidade divergente"
              accentClass="border-amber-200 bg-amber-50 text-amber-700"
              icon={Layers3}
            />
            <KpiCard
              label="Pendente"
              value={resumo.pendente}
              hint="Ainda sem status final"
              accentClass="border-slate-200 bg-slate-50 text-slate-700"
              icon={Clock3}
            />
            <KpiCard
              label="Em andamento"
              value={statusAtual.emAndamento}
              hint="Status atual dos pedidos"
              accentClass="border-orange-200 bg-orange-50 text-orange-700"
              icon={Activity}
            />
            <KpiCard
              label="Concluidos"
              value={statusAtual.concluidos}
              hint="Status atual dos pedidos"
              accentClass="border-indigo-200 bg-indigo-50 text-indigo-700"
              icon={BarChart3}
            />
          </section>

          <section className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            Status atual fora do recorte de conferência: pendentes {formatNumber(statusAtual.pendentes)} · analisados{" "}
            {formatNumber(statusAtual.analisados)}
          </section>

          {semConferencias ? (
            <section className="rounded-3xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-sm">
              <PackageCheck className="mx-auto h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-bold text-foreground">
                Sem conferências concluídas no período
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                As views `dashboard_*` responderam sem erro, mas o recorte atual não retornou dados.
              </p>
            </section>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <SectionCard
                  title="Distribuição"
                  description="Separado, não tem, parcial e pendente no período."
                >
                  <ChartContainer
                    config={{
                      separado: { label: "Separado", color: COLORS.separado },
                      naoTem: { label: "Nao tem", color: COLORS.naoTem },
                      parcial: { label: "Parcial", color: COLORS.parcial },
                      pendente: { label: "Pendente", color: COLORS.pendente },
                    }}
                    className="h-[280px] w-full !aspect-auto"
                  >
                    <PieChart>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => (
                              <>
                                <span className="text-muted-foreground">{String(name)}</span>
                                <span className="font-mono font-medium text-foreground">
                                  {formatNumber(Number(value ?? 0))}
                                </span>
                              </>
                            )}
                          />
                        }
                      />
                      <Pie
                        data={donutData}
                        dataKey="valor"
                        nameKey="label"
                        innerRadius={70}
                        outerRadius={100}
                        paddingAngle={3}
                      >
                        {donutData.map((item) => (
                          <Cell key={item.key} fill={item.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {donutData.map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="text-muted-foreground">{item.label}</span>
                        </div>
                        <span className="font-semibold text-foreground">
                          {formatNumber(item.valor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Itens por dia"
                  description="Soma diária de itens fechados na conferência."
                >
                  {seriePorDia.length === 0 ? (
                    <ChartEmpty label="Sem dias para o recorte atual." />
                  ) : (
                    <ChartContainer
                      config={{
                        totalItens: { label: "Itens", color: COLORS.itens },
                      }}
                      className="h-[280px] w-full !aspect-auto"
                    >
                      <BarChart data={seriePorDia}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value) => (
                                <span className="font-mono font-medium text-foreground">
                                  {formatNumber(Number(value ?? 0))}
                                </span>
                              )}
                            />
                          }
                        />
                        <Bar dataKey="totalItens" fill="var(--color-totalItens)" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </SectionCard>

                <SectionCard
                  title="Pareto de itens"
                  description="Top itens mais recorrentes com acumulado percentual."
                >
                  {pareto.length === 0 ? (
                    <ChartEmpty label="Sem itens frequentes no período." />
                  ) : (
                    <ChartContainer
                      config={{
                        vezes: { label: "Ocorrências", color: COLORS.itens },
                        acumulado: { label: "Acumulado", color: COLORS.acumulado },
                      }}
                      className="h-[320px] w-full !aspect-auto"
                    >
                      <ComposedChart data={pareto}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={-22}
                          textAnchor="end"
                          height={64}
                        />
                        <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                          tickLine={false}
                          axisLine={false}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name) => (
                                <>
                                  <span className="text-muted-foreground">
                                    {name === "acumulado" ? "Acumulado" : "Ocorrências"}
                                  </span>
                                  <span className="font-mono font-medium text-foreground">
                                    {name === "acumulado"
                                      ? formatPercent(Number(value ?? 0))
                                      : formatNumber(Number(value ?? 0))}
                                  </span>
                                </>
                              )}
                            />
                          }
                        />
                        <Bar yAxisId="left" dataKey="vezes" fill="var(--color-vezes)" radius={[8, 8, 0, 0]} />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="acumulado"
                          stroke="var(--color-acumulado)"
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ChartContainer>
                  )}
                </SectionCard>

                <SectionCard
                  title="Por seção"
                  description="Volume empilhado de separado, não tem e parcial."
                >
                  {secoes.length === 0 ? (
                    <ChartEmpty label="Sem seções para o recorte atual." />
                  ) : (
                    <ChartContainer
                      config={{
                        separado: { label: "Separado", color: COLORS.separado },
                        naoTem: { label: "Nao tem", color: COLORS.naoTem },
                        parcial: { label: "Parcial", color: COLORS.parcial },
                      }}
                      className="w-full !aspect-auto"
                      style={{ height: Math.max(280, secoes.length * 42) }}
                    >
                      <BarChart data={secoes} layout="vertical" margin={{ left: 16, right: 16 }}>
                        <CartesianGrid horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={100}
                          tickLine={false}
                          axisLine={false}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name) => (
                                <>
                                  <span className="text-muted-foreground">{String(name)}</span>
                                  <span className="font-mono font-medium text-foreground">
                                    {formatNumber(Number(value ?? 0))}
                                  </span>
                                </>
                              )}
                            />
                          }
                        />
                        <Bar dataKey="separado" stackId="secao" fill="var(--color-separado)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="naoTem" stackId="secao" fill="var(--color-naoTem)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="parcial" stackId="secao" fill="var(--color-parcial)" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </SectionCard>

                <SectionCard
                  title="Por conferente"
                  description="Conferências concluídas com tempo total agregado."
                  className="xl:col-span-2"
                >
                  {conferentes.length === 0 ? (
                    <ChartEmpty label="Sem conferentes para o recorte atual." />
                  ) : (
                    <ChartContainer
                      config={{
                        conferencias: { label: "Conferências", color: COLORS.secoes },
                        tempoHoras: { label: "Tempo", color: COLORS.tempo },
                      }}
                      className="h-[340px] w-full !aspect-auto"
                    >
                      <ComposedChart data={conferentes}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={-18}
                          textAnchor="end"
                          height={58}
                        />
                        <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, name, _item, _index, payload) => {
                                if (name === "tempoHoras") {
                                  return (
                                    <>
                                      <span className="text-muted-foreground">Tempo</span>
                                      <span className="font-mono font-medium text-foreground">
                                        {formatDuration(Number(payload?.tempoSegundos ?? 0))}
                                      </span>
                                    </>
                                  );
                                }

                                return (
                                  <>
                                    <span className="text-muted-foreground">Conferências</span>
                                    <span className="font-mono font-medium text-foreground">
                                      {formatNumber(Number(value ?? 0))}
                                    </span>
                                  </>
                                );
                              }}
                            />
                          }
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="conferencias"
                          fill="var(--color-conferencias)"
                          radius={[10, 10, 0, 0]}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="tempoHoras"
                          stroke="var(--color-tempoHoras)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      </ComposedChart>
                    </ChartContainer>
                  )}
                </SectionCard>
              </div>

              <SectionCard
                title="Itens frequentes"
                description="Fotos, código, SKU, seção e volume consolidado do período."
              >
                {itensFrequentes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
                    Sem itens frequentes neste recorte.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {itensFrequentes.slice(0, 12).map((item) => (
                      <article
                        key={`${item.codigo}-${item.sku}`}
                        className="rounded-2xl border border-border bg-background p-3"
                      >
                        <div className="flex items-start gap-3">
                          {item.fotoUrl ? (
                            <img
                              src={item.fotoUrl}
                              alt={item.codigo}
                              className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                              <Package className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-foreground">{item.sku}</div>
                            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                              {item.codigo}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{item.secao}</div>
                          </div>

                          <div className="rounded-xl border border-border px-3 py-2 text-right">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              Vezes
                            </div>
                            <div className="mt-1 text-lg font-black text-foreground">
                              {formatNumber(item.vezes)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              Total pedido
                            </div>
                            <div className="mt-1 text-sm font-bold text-foreground">
                              {formatNumber(item.totalPedido)}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border px-3 py-2">
                            <div className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              Total real
                            </div>
                            <div className="mt-1 text-sm font-bold text-foreground">
                              {formatNumber(item.totalReal)}
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  );
}
