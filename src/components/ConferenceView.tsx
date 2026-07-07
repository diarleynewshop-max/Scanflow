import { useState, useRef, useEffect } from "react";
import { buscarProdutoVarejoFacil } from "@/lib/varejoFacilIntegration";
import {
  FileInput,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Play,
  Flag,
  Timer,
  ChevronLeft,
  ChevronRight,
  Package,
  FileInput as FileJson,
  Share2,
  Lock,
  RefreshCw,
  ClipboardList,
  PackageSearch,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import JSZip from "jszip";
import {
  carregarItensDoPedido,
  dispararExpedicaoConferencia,
  fecharConferenciaExistente,
  liberarPedido,
  liberarPedidoEmSegundoPlano,
  listarPedidosParaConferencia,
  reservarPedido,
  type EmpresaKey,
  type FlagKey,
  type PedidoParaConferencia,
} from "@/lib/pedidosFila";
import { enviarConferenciaParaSupabase } from "@/lib/pedidosSupabase";
import { obterLoginSalvo } from "@/hooks/useAuth";
import { obterSenhaPadrao, validarSenha } from "@/lib/senhaConferencia";
import { z } from "zod";

export type ConferenceStatus =
  | "separado"
  | "nao_tem"
  | "nao_tem_tudo"
  | "pendente"
  | "aguardando";

export interface ConferenceItem {
  id: string;
  codigo: string;
  sku: string;
  secao?: string | null;
  quantidadePedida: number;
  quantidadeReal: number | null;
  status: ConferenceStatus;
  photo?: string | null;
  digito?: "S" | "M" | null;
}

interface ConferenceViewProps {
  onBack: () => void;
  empresa?: string;
  flag?: string;
  modoDesktop?: boolean;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

type Phase = "import" | "pickTask" | "ready" | "running" | "finished";

const ConferenceFileSchemaPadrao = z.object({
  type: z.literal("conference-file", {
    errorMap: () => ({ message: "Arquivo não é do tipo conference-file. Use o export JSON da aba Lista." }),
  }),
  empresa: z.string().optional(),
  flag: z.string().optional(),
  items: z.array(
    z.object({
      codigo: z.string().min(1, "Código do produto não pode ser vazio."),
      sku: z.string().optional().default(""),
      secao: z.string().nullable().optional(),
      quantidade: z.number().int().positive("Quantidade deve ser um número inteiro positivo."),
      photo: z.string().nullable().optional(),
    })
  ).min(1, "A lista de itens está vazia."),
});

// JSON da task de PENDENTES gerada pelo Trigger.dev (formato diferente do export normal).
// Estrutura: { isPendentesReprocessamento: true, itens: [{ codigo, sku, secao, quantidadePedida, ... }] }
const PendentesSchema = z.object({
  isPendentesReprocessamento: z.literal(true),
  empresa: z.string().optional(),
  flag: z.string().optional(),
  itens: z.array(
    z.object({
      codigo: z.string().min(1),
      sku: z.string().optional().default(""),
      secao: z.string().nullable().optional(),
      quantidadePedida: z.number().int().positive(),
    })
  ).min(1),
});

// Parse unificado: aceita tanto o formato padrão (export da Lista) quanto o de Pendentes.
// Retorna no formato do schema padrão pra não quebrar o consumidor.
function parseConferenceJson(raw: unknown):
  | { success: true; data: z.infer<typeof ConferenceFileSchemaPadrao> }
  | { success: false; error: { issues: { message: string }[] } } {
  const padrao = ConferenceFileSchemaPadrao.safeParse(raw);
  if (padrao.success) return { success: true, data: padrao.data };

  const pendentes = PendentesSchema.safeParse(raw);
  if (pendentes.success) {
    return {
      success: true,
      data: {
        type: "conference-file",
        empresa: pendentes.data.empresa,
        flag: pendentes.data.flag,
        items: pendentes.data.itens.map((i) => ({
          codigo: i.codigo,
          sku: i.sku,
          secao: i.secao,
          quantidade: i.quantidadePedida,
          photo: null,
        })),
      },
    };
  }

  return { success: false, error: padrao.error };
}

const ConferenceFileSchema = { safeParse: parseConferenceJson };

// Reconstrucao on-the-fly de JSON de PENDENTES a partir da descricao da task.
// Usado quando a task de pendentes ficou sem JSON anexado (versoes antigas do
// trigger, antes do fix do ATTCH_045). A descricao tem todos os dados:
//   Conferente: X
//   Listeiro: Y
//   Empresa: NEWSHOP
//   Tipo: LOJA
//   Data: 18/05/2026
//   ...
//   1. Codigo: 7898... | SKU: PISO... | Pedido: 360 | Real: - | ⏳ Pendente
function reconstruirJsonPendentesDeDescricao(
  description: string,
  taskName: string
): { isPendentesReprocessamento: true; empresa?: string; flag?: string; itens: { codigo: string; sku: string; secao: string | null; quantidadePedida: number }[] } | null {
  if (!description) return null;

  const empresaMatch = description.match(/Empresa:\s*(\S+)/i);
  const tipoMatch = description.match(/Tipo:\s*(CD|LOJA)/i);
  const flag = tipoMatch ? (tipoMatch[1].toUpperCase() === "CD" ? "cd" : "loja") : undefined;

  const itens: { codigo: string; sku: string; secao: string | null; quantidadePedida: number }[] = [];
  let secaoAtual: string | null = null;
  for (const linha of description.split("\n")) {
    const t = linha.trim();
    if (!t) continue;
    if (t === "{S}") { secaoAtual = "S"; continue; }
    if (t === "{M}") { secaoAtual = "M"; continue; }
    if (/^Sem categoria$/i.test(t)) { secaoAtual = null; continue; }

    const m = t.match(/^\d+\.\s*Codigo:\s*(\S+)\s*\|\s*SKU:\s*(.+?)\s*\|\s*Pedido:\s*(\d+)/i);
    if (m) {
      itens.push({
        codigo: m[1],
        sku: m[2] === "-" ? "" : m[2],
        secao: secaoAtual,
        quantidadePedida: parseInt(m[3], 10),
      });
    }
  }

  if (itens.length === 0) return null;
  if (!taskName.includes("PENDENTES") && !taskName.startsWith("⏳")) return null;

  return {
    isPendentesReprocessamento: true,
    empresa: empresaMatch?.[1],
    flag,
    itens,
  };
}

const ConferenceView = ({ onBack, empresa: empresaProp, flag: flagProp, modoDesktop = false }: ConferenceViewProps) => {
  const loginSalvo = obterLoginSalvo();
  const empresaInicial = empresaProp ?? loginSalvo?.empresa ?? "NEWSHOP";
  const flagInicial = flagProp ?? loginSalvo?.flag ?? "loja";
  const conferenteInicial = loginSalvo?.nomePessoa ?? "";
  const [items, setItems] = useState<ConferenceItem[]>([]);
  const [phase, setPhase] = useState<Phase>("import");
  const [importError, setImportError] = useState<string | null>(null);
  const [conferente, setConferente] = useState(conferenteInicial);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [flag, setFlag] = useState(flagInicial);
  const [conferenceId] = useState(() => crypto.randomUUID());
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [senha, setSenha] = useState(() => obterSenhaPadrao(empresaInicial as EmpresaKey, flagInicial as FlagKey));
  const [senhaErro, setSenhaErro] = useState(false);
  const [tasks, setTasks] = useState<PedidoParaConferencia[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksErro, setTasksErro] = useState<string | null>(null);
  const [taskSelecionada, setTaskSelecionada] = useState<PedidoParaConferencia | null>(null);
  const [loadingJson, setLoadingJson] = useState(false);
  const [pedidoOrigemIds, setPedidoOrigemIds] = useState<string[]>([]);
  const [taskOrigemIds, setTaskOrigemIds] = useState<string[]>([]);
  const pedidoOrigemIdsRef = useRef<string[]>([]);
  const pedidoReservadoIdsRef = useRef<string[]>([]);
  const taskOrigemIdsRef = useRef<string[]>([]);
  const [listeiro, setListeiro] = useState<string>("");
  const [apenasVisualizar, setApenasVisualizar] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "lista">("card");
  const [modalModoAberturaTask, setModalModoAberturaTask] = useState<PedidoParaConferencia | null>(null);
  const [modalConfirmAndamento, setModalConfirmAndamento] = useState<PedidoParaConferencia | null>(null);
  // true quando o usuario confirmou "continuar mesmo assim" no modal de andamento.
  // Faz o backend pular a verificacao de lock e aceitar a reserva.
  const [forcarReservaAndamento, setForcarReservaAndamento] = useState(false);
  const [rascunhoDisponivel, setRascunhoDisponivel] = useState(false);
  const empresaRef = useRef(empresaInicial);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // ── Rascunho automático ────────────────────────────────────────────────────
  const DRAFT_KEY = "conferencia_draft_v1";
  const DRAFT_TTL = 8 * 60 * 60 * 1000; // 8 horas

  function salvarRascunho() {
    if (phase !== "ready" && phase !== "running") return;
    try {
      const draft = {
        phase, empresa, flag, conferente, listeiro,
        // Preserva URLs normais (proxy ERP, pequenas); strip apenas data: URLs (blobs grandes)
        items: items.map(({ photo, ...rest }) => ({
          ...rest,
          photo: photo && !photo.startsWith("data:") ? photo : null,
        })),
        currentIndex, pedidoOrigemIds, taskOrigemIds, elapsedSeconds, apenasVisualizar,
        savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* localStorage cheio — ignora */ }
  }

  function limparRascunho() {
    localStorage.removeItem(DRAFT_KEY);
    setRascunhoDisponivel(false);
  }

  function restaurarRascunho() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Date.now() - d.savedAt > DRAFT_TTL) { limparRascunho(); return; }
      setPhase(d.phase);
      setEmpresa(d.empresa);
      setFlag(d.flag);
      setConferente(d.conferente);
      setListeiro(d.listeiro ?? "");
      setItems(d.items ?? []);
      setCurrentIndex(d.currentIndex ?? 0);
      setPedidoOrigemIds(d.pedidoOrigemIds ?? []);
      pedidoOrigemIdsRef.current = d.pedidoOrigemIds ?? [];
      setTaskOrigemIds(d.taskOrigemIds ?? []);
      taskOrigemIdsRef.current = d.taskOrigemIds ?? [];
      setElapsedSeconds(d.elapsedSeconds ?? 0);
      setApenasVisualizar(d.apenasVisualizar ?? false);
      setRascunhoDisponivel(false);
      toast({ title: "Conferência restaurada!", description: `${(d.items ?? []).length} itens recuperados.` });
    } catch { limparRascunho(); }
  }

  // Salva rascunho sempre que items ou fase mudarem (running/ready)
  useEffect(() => {
    salvarRascunho();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, phase, currentIndex, elapsedSeconds]);

  // Verifica rascunho no mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Date.now() - d.savedAt > DRAFT_TTL) { localStorage.removeItem(DRAFT_KEY); return; }
      if (d.items?.length > 0 && (d.phase === "ready" || d.phase === "running")) {
        setRascunhoDisponivel(true);
      }
    } catch { localStorage.removeItem(DRAFT_KEY); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const STORAGE_KEY = "clickup_sent_ids";


  const jaFoiEnviado = (): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      return ids.includes(conferenceId);
    } catch { return false; }
  };

  const marcarComoEnviado = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      const novos = [...ids, conferenceId].slice(-200);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(novos));
    } catch {}
  };

  const liberarPedidoAtual = async () => {
    const ids = pedidoReservadoIdsRef.current;
    setApenasVisualizar(false);
    limparRascunho();
    if (ids.length > 0) {
      await Promise.all(ids.map((pedidoId) => liberarPedido(pedidoId)));
    }

    pedidoReservadoIdsRef.current = [];
    pedidoOrigemIdsRef.current = [];
    taskOrigemIdsRef.current = [];
    setPedidoOrigemIds([]);
    setTaskOrigemIds([]);
  };

  const voltarLiberandoPedido = async () => {
    try {
      await liberarPedidoAtual();
    } catch (e: any) {
      toast({
        title: "Nao foi possivel liberar o pedido",
        description: e?.message ?? "Tente liberar o pedido novamente.",
        variant: "destructive",
      });
      return;
    }

    onBack();
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    pedidoOrigemIdsRef.current = pedidoOrigemIds;
  }, [pedidoOrigemIds]);

  useEffect(() => {
    taskOrigemIdsRef.current = taskOrigemIds;
  }, [taskOrigemIds]);

  useEffect(() => {
    empresaRef.current = empresa;
  }, [empresa]);

  useEffect(() => {
    const liberarAoFechar = () => {
      const ids = pedidoReservadoIdsRef.current;
      if (ids.length === 0) return;

      ids.forEach((pedidoId) => liberarPedidoEmSegundoPlano(pedidoId));
    };

    window.addEventListener("beforeunload", liberarAoFechar);
    return () => window.removeEventListener("beforeunload", liberarAoFechar);
  }, []);

  useEffect(() => {
    setSenha(obterSenhaPadrao(empresa as EmpresaKey, flag as FlagKey));
    setSenhaErro(false);
  }, [empresa, flag]);

  const confirmarSenha = async () => {
    const ok = validarSenha(empresa as EmpresaKey, senha, flag as FlagKey);
    if (!ok) { setSenhaErro(true); return; }
    setSenhaErro(false);
    setLoadingTasks(true);
    setTasksErro(null);
    try {
      const lista = await listarPedidosParaConferencia(empresa, flag);
      setTasks(lista);
      setPhase("pickTask");
    } catch (e: any) {
      setTasksErro(e.message ?? "Erro ao buscar tasks");
    } finally {
      setLoadingTasks(false);
    }
  };

  const recarregarTasks = async () => {
    setLoadingTasks(true);
    setTasksErro(null);
    try {
      const lista = await listarPedidosParaConferencia(empresa, flag);
      setTasks(lista);
    } catch (e: any) {
      setTasksErro(e.message ?? "Erro ao buscar tasks");
    } finally {
      setLoadingTasks(false);
    }
  };

  const abrirTaskComModo = async (task: PedidoParaConferencia, modo: "visualizar" | "separacao", forcar = false) => {
    setModalModoAberturaTask(null);
    setApenasVisualizar(modo === "visualizar");
    await abrirTask(task, modo === "visualizar", forcar);
  };

  const abrirTask = async (task: PedidoParaConferencia, soVisualizar = false, forcar = false) => {
    setLoadingJson(true);
    setTaskSelecionada(task);
    let reservouPedido = false;
    try {
      if (!soVisualizar) {
        await reservarPedido(task.id, conferente || conferenteInicial, forcar);
        reservouPedido = true;
      }

      const itensPedido = await carregarItensDoPedido(task.id);
      if (itensPedido.length === 0) {
        if (reservouPedido) await liberarPedido(task.id).catch(() => undefined);
        toast({ title: "Pedido sem itens no Supabase", variant: "destructive" });
        setLoadingJson(false);
        setTaskSelecionada(null);
        return;
      }

      const parsedSupabase: ConferenceItem[] = itensPedido.map((item) => ({
        id: item.id || crypto.randomUUID(),
        codigo: item.codigo,
        sku: item.sku ?? "",
        secao: item.secao ?? null,
        quantidadePedida: item.quantidadePedida,
        quantidadeReal: item.quantidadeReal,
        status: item.status === "pendente" && item.quantidadeReal == null ? "aguardando" : item.status,
        photo: item.photo ?? null,
        digito: null,
      }));

      setListeiro(task.listeiro || "");
      setItems(parsedSupabase);
      setPedidoOrigemIds([task.id]);
      pedidoOrigemIdsRef.current = [task.id];
      pedidoReservadoIdsRef.current = reservouPedido ? [task.id] : [];
      const clickupOrigemIds = task.clickupTaskId ? [task.clickupTaskId] : [];
      setTaskOrigemIds(clickupOrigemIds);
      taskOrigemIdsRef.current = clickupOrigemIds;
      setPhase("ready");
      toast({ title: `${parsedSupabase.length} itens carregados do pedido!` });

      const empresaCtxFoto = empresa;
      const flagCtxFoto = flag;
      const itensSemFoto = parsedSupabase.filter((it) => !it.photo);
      if (itensSemFoto.length > 0) {
        (async () => {
          const enriched = await Promise.all(
            itensSemFoto.map(async (it) => {
              try {
                const timeout4s = new Promise<null>((res) => setTimeout(() => res(null), 4000));
                const produto = await Promise.race([
                  buscarProdutoVarejoFacil(it.codigo, { empresa: empresaCtxFoto, flag: flagCtxFoto }),
                  timeout4s,
                ]);
                return { id: it.id, photo: produto?.imagem ?? null };
              } catch { return { id: it.id, photo: null }; }
            })
          );
          const fotoMap = new Map(enriched.filter((e) => e.photo).map((e) => [e.id, e.photo!]));
          if (fotoMap.size > 0) {
            setItems((prev) => prev.map((it) => fotoMap.has(it.id) ? { ...it, photo: fotoMap.get(it.id)! } : it));
          }
        })().catch(() => undefined);
      }

    } catch (e: any) {
      if (reservouPedido) {
        await liberarPedido(task.id).catch(() => undefined);
      }
      toast({ title: "Erro ao carregar task", description: e.message, variant: "destructive" });
      await recarregarTasks().catch(() => undefined);
      setTaskSelecionada(null);
    } finally {
      setLoadingJson(false);
    }
  };

  const processJsonText = (text: string): boolean => {
    try {
      const raw = JSON.parse(text);

      // Formato de lista legado: { produtos: [{ barcode, sku, quantidade, secao, photo }] }
      if (Array.isArray(raw.produtos) && raw.produtos.length > 0 && raw.produtos[0]?.barcode) {
        if (raw.empresa) setEmpresa(raw.empresa);
        if (raw.flag)    setFlag(raw.flag);

        const validos = (raw.produtos as any[]).filter(
          (p) => p?.barcode && String(p.barcode).trim() &&
                 Number.isFinite(Number(p.quantidade)) && Number(p.quantidade) > 0
        );

        if (validos.length === 0) {
          setImportError("Nenhum produto válido no arquivo (barcode ou quantidade inválidos).");
          return true;
        }

        const parsed: ConferenceItem[] = validos.map((p) => ({
          id: crypto.randomUUID(),
          codigo: String(p.barcode).trim(),
          sku: p.sku ?? "",
          secao: p.secao ?? null,
          quantidadePedida: Number(p.quantidade),
          quantidadeReal: null,
          status: "aguardando" as ConferenceStatus,
          photo: p.photo ?? null,
          digito: null,
        }));

        setItems(parsed);
        setPedidoOrigemIds([]);
        pedidoOrigemIdsRef.current = [];
        pedidoReservadoIdsRef.current = [];
        setTaskOrigemIds([]);
        taskOrigemIdsRef.current = [];
        setPhase("ready");
        setCurrentIndex(0);
        toast({ title: `${parsed.length} itens importados!` });
        return true;
      }

      const result = ConferenceFileSchema.safeParse(raw);
      if (!result.success) {
        setImportError("Arquivo inválido: " + result.error.issues[0]?.message);
        return false;
      }

      if (result.data.empresa) setEmpresa(result.data.empresa);
      if (result.data.flag)    setFlag(result.data.flag);

      const digitoMap: Record<string, "S" | "M"> = raw._meta?.digitoMap ?? {};

      const parsed: ConferenceItem[] = result.data.items.map((item) => ({
        id: crypto.randomUUID(),
        codigo: item.codigo,
        sku: item.sku ?? "",
        secao: item.secao ?? null,
        quantidadePedida: item.quantidade,
        quantidadeReal: null,
        status: "aguardando" as ConferenceStatus,
        photo: item.photo ?? null,
        digito: digitoMap[item.codigo] ?? null,
      }));

      setItems(parsed);
      setPedidoOrigemIds([]);
      pedidoOrigemIdsRef.current = [];
      pedidoReservadoIdsRef.current = [];
      setTaskOrigemIds([]);
      taskOrigemIdsRef.current = [];
      setPhase("ready");
      setCurrentIndex(0);
      toast({ title: `${parsed.length} itens importados!` });
      return true;
    } catch {
      return false;
    }
  };

  const processCsvText = (text: string, itemsOriginais?: ConferenceItem[]): boolean => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) { setImportError("Arquivo vazio."); return false; }

    const erpMap = new Map<string, { qtdErp: number; digito: "S" | "M" | null }>();
    const erros: string[] = [];

    lines.forEach((line, i) => {
      const parts = line.split(";");
      const codigo = parts[0]?.trim() ?? "";
      const qtdStr = parts[1]?.trim() ?? "";
      const digitoRaw = parts[2]?.trim().toUpperCase() ?? "";

      if (!codigo || !/^\d+$/.test(qtdStr)) {
        erros.push(`Linha ${i + 1}: formato inválido`);
        return;
      }

      const digito: "S" | "M" | null =
        digitoRaw === "S" ? "S" : digitoRaw === "M" ? "M" : null;

      erpMap.set(codigo, { qtdErp: parseInt(qtdStr, 10), digito });
    });

    if (erpMap.size === 0) {
      setImportError("Nenhum item válido. Formato: CODIGO;QUANTIDADE;S ou CODIGO;QUANTIDADE;M");
      return false;
    }

    if (erros.length > 0) {
      toast({ title: `${erros.length} linha(s) ignoradas`, variant: "destructive" });
    }

    if (itemsOriginais && itemsOriginais.length > 0) {
      const parsed: ConferenceItem[] = [];

      itemsOriginais.forEach((item) => {
        const erp = erpMap.get(item.codigo);

        if (!erp) {
          parsed.push({ ...item, digito: item.digito ?? null });
          return;
        }

        const { qtdErp, digito } = erp;

        if (qtdErp === 0) {
          return;
        } else if (qtdErp >= item.quantidadePedida) {
          parsed.push({ ...item, status: "separado", quantidadeReal: item.quantidadePedida, digito });
        } else {
          parsed.push({ ...item, status: "nao_tem_tudo", quantidadeReal: qtdErp, digito });
        }
      });

      if (parsed.length === 0) {
        setImportError("Todos os itens foram zerados pelo ERP.");
        return false;
      }

      const removidos = itemsOriginais.length - parsed.length;
      if (removidos > 0) {
        toast({ title: `${removidos} item(ns) removido(s) por quantidade zero` });
      }

      setItems(parsed);
      setPedidoOrigemIds([]);
      pedidoOrigemIdsRef.current = [];
      pedidoReservadoIdsRef.current = [];
      setTaskOrigemIds([]);
      taskOrigemIdsRef.current = [];
      setPhase("ready");
      setCurrentIndex(0);
      toast({ title: `${parsed.length} itens prontos após cruzamento com ERP!` });
      return true;
    }

    const parsed: ConferenceItem[] = [];
    erpMap.forEach(({ qtdErp, digito }, codigo) => {
      if (qtdErp === 0) return;
      parsed.push({
        id: crypto.randomUUID(),
        codigo,
        sku: "",
        quantidadePedida: qtdErp,
        quantidadeReal: null,
        status: "aguardando",
        photo: null,
        digito,
      });
    });

    if (parsed.length === 0) {
      setImportError("Todos os itens estão com quantidade zero.");
      return false;
    }

    setItems(parsed);
    setPedidoOrigemIds([]);
    pedidoOrigemIdsRef.current = [];
    pedidoReservadoIdsRef.current = [];
    setTaskOrigemIds([]);
    taskOrigemIdsRef.current = [];
    setPhase("ready");
    setCurrentIndex(0);
    toast({ title: `${parsed.length} itens importados!` });
    return true;
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);

    const detectarPeloNome = (nome: string) => {
      const n = nome.toUpperCase();
      let empresaDetectada: string | null = null;
      let flagDetectada: string | null = null;

      if (n.includes("NEWSHOP")) empresaDetectada = "NEWSHOP";
      else if (n.includes("FACIL"))   empresaDetectada = "FACIL";
      else if (n.includes("SOYE"))    empresaDetectada = "SOYE";

      if (n.includes("_LOJA_") || n.startsWith("LOJA_") || n.endsWith("_LOJA") || n.includes("-LOJA-"))
        flagDetectada = "loja";
      else if (n.includes("_CD_") || n.startsWith("CD_") || n.endsWith("_CD") || n.includes("-CD-"))
        flagDetectada = "cd";

      return { empresaDetectada, flagDetectada };
    };

    if (file.name.endsWith(".zip")) {
      try {
        const zip = await JSZip.loadAsync(file);
        const jsonFileName = Object.keys(zip.files).find((n) => n.endsWith(".json"));
        const txtFileName = Object.keys(zip.files).find((n) => n.endsWith(".txt"));

        if (jsonFileName && txtFileName) {
          const jsonText = await zip.files[jsonFileName].async("string");
          let raw: unknown;
          try {
            raw = JSON.parse(jsonText);
          } catch {
            setImportError("O JSON dentro do .zip está corrompido ou malformado.");
            e.target.value = "";
            return;
          }
          const result = ConferenceFileSchema.safeParse(raw);

          if (!result.success) {
            setImportError("Arquivo inválido dentro do ZIP: " + (result.error.issues[0]?.message ?? "estrutura incorreta."));
            e.target.value = "";
            return;
          }

          if (result.data.empresa) {
            setEmpresa(result.data.empresa);
          } else {
            const { empresaDetectada, flagDetectada } = detectarPeloNome(file.name);
            if (empresaDetectada) setEmpresa(empresaDetectada);
            if (flagDetectada)    setFlag(flagDetectada);
          }
          if (result.data.flag) setFlag(result.data.flag);

          const digitoMap: Record<string, "S" | "M"> = (raw as any)._meta?.digitoMap ?? {};

          const itemsOriginais: ConferenceItem[] = result.data.items.map((item) => ({
            id: crypto.randomUUID(),
            codigo: item.codigo,
            sku: item.sku ?? "",
            secao: item.secao ?? null,
            quantidadePedida: item.quantidade,
            quantidadeReal: null,
            status: "aguardando" as ConferenceStatus,
            photo: item.photo ?? null,
            digito: digitoMap[item.codigo] ?? null,
          }));

          const txtText = await zip.files[txtFileName].async("string");
          processCsvText(txtText, itemsOriginais);
          e.target.value = "";
          return;
        }

        if (jsonFileName) {
          const text = await zip.files[jsonFileName].async("string");
          const { empresaDetectada, flagDetectada } = detectarPeloNome(file.name);
          if (empresaDetectada) setEmpresa(empresaDetectada);
          if (flagDetectada)    setFlag(flagDetectada);
          if (!processJsonText(text)) {
            setImportError("O JSON dentro do .zip não é um arquivo de conferência válido.");
          }
          e.target.value = "";
          return;
        }

        setImportError("Nenhum arquivo .json encontrado dentro do .zip");
      } catch {
        setImportError("Erro ao descompactar o arquivo .zip");
      }
      e.target.value = "";
      return;
    }

    const { empresaDetectada, flagDetectada } = detectarPeloNome(file.name);
    if (empresaDetectada) setEmpresa(empresaDetectada);
    if (flagDetectada)    setFlag(flagDetectada);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (file.name.endsWith(".json") || text.trim().startsWith("{")) {
          if (processJsonText(text)) return;
        }
        processCsvText(text);
      } catch {
        setImportError("Erro ao ler o arquivo.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const startConference = () => {
    setPhase("running");
    setCurrentIndex(0);
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
  };

  const finishConference = () => {
    if (items.some((i) => i.status === "aguardando")) {
      toast({ title: "Todos os itens precisam ter um status", variant: "destructive" });
      return;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setPhase("finished");
  };

  const setStatus = (id: string, status: ConferenceStatus, quantidadeReal?: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (status === "separado") return { ...item, status, quantidadeReal: item.quantidadePedida };
        if (status === "nao_tem") return { ...item, status, quantidadeReal: 0 };
        if (status === "pendente") return { ...item, status, quantidadeReal: null };
        if (status === "nao_tem_tudo") return { ...item, status, quantidadeReal: quantidadeReal ?? null };
        return { ...item, status, quantidadeReal: quantidadeReal ?? null };
      })
    );
  };

  const handleQuantityChange = (id: string, value: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (value === "") {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantidadeReal: null } : i)));
      return;
    }
    const num = parseInt(value, 10);
    if (isNaN(num) || !Number.isInteger(num)) return;
    if (num <= 0) {
      toast({ title: "Quantidade deve ser maior que 0", variant: "destructive" });
      return;
    }
    if (num >= item.quantidadePedida) {
      toast({ title: "Use 'Separado' se tem tudo", description: `Pedido: ${item.quantidadePedida}`, variant: "destructive" });
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantidadeReal: num, status: "nao_tem_tudo" } : i)));
  };

  const getResumo = () => ({
    separado: items.filter((i) => i.status === "separado").length,
    naoTem: items.filter((i) => i.status === "nao_tem").length,
    parcial: items.filter((i) => i.status === "nao_tem_tudo").length,
    pendente: items.filter((i) => i.status === "pendente").length,
  });

  const getPayloadClickUp = () => ({
    conferente,
    listeiro: listeiro || undefined,
    tempo: formatTime(elapsedSeconds),
    totalItens: items.length,
    resumo: getResumo(),
    itens: items.map((i) => ({
      codigo: i.codigo,
      sku: i.sku,
      secao: i.secao ?? null,
      quantidadePedida: i.quantidadePedida,
      quantidadeReal: i.quantidadeReal,
      status: i.status,
      digito: i.digito ?? null,
      photo: i.photo ?? null,
    })),
  });

  const enviarClickUp = async () => {
    // Verifica se a conferência tem itens antes de enviar
    if (items.length === 0) {
      toast({
        title: "❌ Conferência vazia",
        description: "Não é possível concluir conferências com 0 itens.",
        variant: "destructive",
      });
      return;
    }

    if (jaFoiEnviado() || sendStatus === "sent") {
      toast({ title: "⚠️ Já enviado!", description: "Esta conferência já foi concluída.", variant: "destructive" });
      return;
    }
    if (sendStatus === "sending") return;

    setSendStatus("sending");
    const pedidoId = pedidoReservadoIdsRef.current[0];
    const itensFechamento = items.map((i) => ({
      codigo: i.codigo,
      sku: i.sku,
      secao: i.secao ?? null,
      quantidadePedida: i.quantidadePedida,
      quantidadeReal: i.quantidadeReal,
      status: i.status,
      photo: i.photo ?? null,
    }));

    try {
      if (pedidoId) {
        // Conferência veio da fila (Supabase): conclui o MESMO pedido reservado.
        await fecharConferenciaExistente(pedidoId, {
          conferente,
          tempoSegundos: elapsedSeconds,
          itens: itensFechamento,
        });
      } else {
        // Conferência veio de arquivo importado (sem pedido no banco): cria um já concluído.
        await enviarConferenciaParaSupabase({
          ...getPayloadClickUp(),
          empresa,
          flag,
          conferenceId,
          tempoSegundos: elapsedSeconds,
          taskOrigemIds,
        });
      }

      try {
        await dispararExpedicaoConferencia({
          conferente,
          empresa,
          dataConferencia: new Date().toISOString(),
          itens: itensFechamento,
        });
      } catch (expedicaoErr) {
        console.error("[conferencia] Falha ao disparar expedicao (nao bloqueia fechamento):", expedicaoErr);
      }

      marcarComoEnviado();
      limparRascunho();
      setSendStatus("sent");
      setPedidoOrigemIds([]);
      pedidoOrigemIdsRef.current = [];
      pedidoReservadoIdsRef.current = [];
      setTaskOrigemIds([]);
      taskOrigemIdsRef.current = [];
      toast({ title: "✅ Conferência concluída!", description: `Pedido de ${conferente} enviado com sucesso.` });
    } catch (err) {
      setSendStatus("error");
      toast({
        title: "❌ Falha no envio",
        description: err instanceof Error ? err.message : "Verifique sua conexão e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const currentItem = items[currentIndex];
  const isCurrentComplete =
    currentItem &&
    currentItem.status !== "aguardando" &&
    (currentItem.status !== "nao_tem_tudo" ||
      (currentItem.quantidadeReal !== null && currentItem.quantidadeReal > 0));
  const isLastItem = currentIndex === items.length - 1;
  const allDone =
    items.length > 0 &&
    items.every(
      (i) =>
        i.status !== "aguardando" &&
        (i.status !== "nao_tem_tudo" ||
          (i.quantidadeReal !== null && i.quantidadeReal > 0))
    );

  const goNext = () => {
    if (!apenasVisualizar && !isCurrentComplete) {
      toast({ title: "Defina o status antes de avançar", variant: "destructive" });
      return;
    }
    if (!isLastItem) setCurrentIndex((i) => i + 1);
  };
  const goPrev = () => { if (currentIndex > 0) setCurrentIndex((i) => i - 1); };

  const getStatusColor = (status: ConferenceStatus) => {
    switch (status) {
      case "separado": return "border-l-4 border-l-[hsl(var(--success))] bg-[hsl(var(--success)/0.08)]";
      case "nao_tem": return "border-l-4 border-l-destructive bg-destructive/5";
      case "nao_tem_tudo": return "border-l-4 border-l-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)]";
      case "pendente": return "border-l-4 border-l-muted-foreground bg-muted/50";
      default: return "border-l-4 border-l-border bg-card";
    }
  };

  const getStatusLabel = (status: ConferenceStatus) => {
    switch (status) {
      case "separado": return { text: "Separado", icon: CheckCircle2, color: "text-[hsl(var(--success))]" };
      case "nao_tem": return { text: "Não tem", icon: XCircle, color: "text-destructive" };
      case "nao_tem_tudo": return { text: "Parcial", icon: AlertTriangle, color: "text-[hsl(var(--warning))]" };
      case "pendente": return { text: "Pendente", icon: Timer, color: "text-muted-foreground" };
      default: return { text: "Sem status", icon: AlertTriangle, color: "text-muted-foreground" };
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    doc.setFillColor(20, 20, 20);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("Conferência de Lista", 14, 12);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`${empresa} · ${flag.toUpperCase()}`, 14, 19);
    doc.text(`Conferente: ${conferente}`, 14, 24);
    doc.text(`Data: ${new Date().toLocaleDateString("pt-BR")}  |  Tempo: ${formatTime(elapsedSeconds)}  |  Total: ${items.length} itens`, pageW - 14, 24, { align: "right" });

    const resumo = getResumo();
    const resumoY = 36;
    const cols = [
      { label: "✅ Separado", val: resumo.separado, r: 34,  g: 197, b: 94  },
      { label: "⚠️ Parcial",  val: resumo.parcial,  r: 234, g: 179, b: 8   },
      { label: "❌ Não tem",  val: resumo.naoTem,   r: 239, g: 68,  b: 68  },
      { label: "⏳ Pendente", val: resumo.pendente, r: 156, g: 163, b: 175 },
    ];
    const colW = (pageW - 28) / 4;
    cols.forEach((c, i) => {
      const x = 14 + i * colW;
      doc.setFillColor(c.r, c.g, c.b);
      doc.roundedRect(x, resumoY, colW - 4, 14, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(String(c.val), x + (colW - 4) / 2, resumoY + 8, { align: "center" });
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.text(c.label, x + (colW - 4) / 2, resumoY + 13, { align: "center" });
    });

    const statusColors: Record<ConferenceStatus, [number, number, number]> = {
      separado:     [34,  197, 94 ],
      nao_tem:      [239, 68,  68 ],
      nao_tem_tudo: [234, 179, 8  ],
      pendente:     [156, 163, 175],
      aguardando:   [156, 163, 175],
    };
    const statusLabels: Record<ConferenceStatus, string> = {
      separado: "SEPARADO", nao_tem: "NÃO TEM", nao_tem_tudo: "PARCIAL", pendente: "PENDENTE", aguardando: "SEM STATUS",
    };

    let y = resumoY + 22;

    items.forEach((item, idx) => {
      const hasPhoto = !!item.photo;
      const itemH   = hasPhoto ? 36 : 20;

      if (y + itemH > pageH - 14) { doc.addPage(); y = 14; }

      const [r, g, b] = statusColors[item.status];

      if (idx % 2 === 0) {
        doc.setFillColor(248, 248, 248);
        doc.rect(14, y - 2, pageW - 28, itemH, "F");
      }

      doc.setFillColor(r, g, b);
      doc.rect(14, y - 2, 3, itemH, "F");

      if (hasPhoto) {
        try {
          doc.addImage(item.photo!, "JPEG", 20, y, 28, 28);
        } catch {}
      }

      const tx = hasPhoto ? 52 : 20;

      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(150, 150, 150);
      doc.text(`#${idx + 1}`, tx, y + 4);

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(20, 20, 20);
      doc.text(item.codigo, tx + 8, y + 4);

      if (item.sku) {
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(`SKU: ${item.sku}`, tx, y + 10);
      }

      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(`Pedido: ${item.quantidadePedida}  |  Real: ${item.quantidadeReal ?? "-"}`, tx, y + (item.sku ? 16 : 10));

      doc.setFillColor(r, g, b);
      doc.roundedRect(pageW - 42, y + 2, 28, 8, 2, 2, "F");
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(statusLabels[item.status], pageW - 28, y + 7, { align: "center" });

      y += itemH + 2;
    });

    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFillColor(240, 240, 240);
      doc.rect(0, pageH - 10, pageW, 10, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`${empresa} · Gerado em ${new Date().toLocaleString("pt-BR")}`, 14, pageH - 3);
      doc.text(`Página ${i} de ${totalPages}`, pageW - 14, pageH - 3, { align: "right" });
    }

    doc.save(`conferencia_${empresa}_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast({ title: "PDF exportado!" });
  };

  const exportJSON = async () => {
    const statusMap: Record<ConferenceStatus, string> = {
      separado: "separado", nao_tem: "nao_tem", nao_tem_tudo: "parcial", pendente: "pendente", aguardando: "pendente",
    };

    const data = {
      type: "conference-file",
      conferente,
      data: new Date().toISOString(),
      tempo: formatTime(elapsedSeconds),
      items: items.map((i) => ({
        codigo: i.codigo,
        sku: i.sku,
        secao: i.secao ?? null,
        quantidade: i.quantidadePedida,
        quantidadeReal: i.quantidadeReal,
        status: statusMap[i.status],
        photo: i.photo || null,
      })),
    };

    const fileName = `conferencia_${new Date().toISOString().slice(0, 10)}`;
    const zip = new JSZip();
    zip.file(`${fileName}.json`, JSON.stringify(data, null, 2));
    const zipBlob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ title: "ZIP baixado!" });

    const zipFile = new File([zipBlob], `${fileName}.zip`, { type: "application/zip" });
    if (navigator.share) {
      try { await navigator.share({ files: [zipFile], title: `Conferência - ${conferente}` }); } catch {}
    }
  };

  const EmpresaBadge = () => {
    const empresaColors: Record<string, { bg: string; border: string; text: string }> = {
      NEWSHOP: { bg: "hsl(var(--primary)/0.12)", border: "hsl(var(--primary)/0.4)", text: "hsl(var(--primary))" },
      SOYE:    { bg: "hsl(142 72% 29%/0.12)",    border: "hsl(142 72% 29%/0.4)",    text: "hsl(142 72% 29%)"    },
      FACIL:   { bg: "hsl(30 95% 50%/0.12)",     border: "hsl(30 95% 50%/0.4)",     text: "hsl(30 95% 50%)"    },
    };
    const colors = empresaColors[empresa] ?? empresaColors["NEWSHOP"];
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: colors.bg, border: `1px solid ${colors.border}`, fontSize: 12, fontWeight: 700, color: colors.text, fontFamily: "var(--font-mono)" }}>
        <span style={{ opacity: 0.7 }}>{flag.toUpperCase()}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{empresa}</span>
      </div>
    );
  };

  if (phase === "import") {
    const flagOptions: { value: string; label: string }[] = [
      { value: "loja", label: "LOJA" },
      { value: "cd", label: "CD" },
    ];
    const empresaOptions: { value: string; label: string; color: string }[] = [
      { value: "NEWSHOP", label: "NEWSHOP", color: "hsl(var(--primary))"  },
      { value: "SOYE",    label: "SOYE",    color: "hsl(142 72% 29%)"     },
      { value: "FACIL",   label: "FACIL",   color: "hsl(30 95% 50%)"      },
    ];

    return (
      <div className="p-4 space-y-4">
        <button onClick={voltarLiberandoPedido} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>

        {/* Banner de recuperação de rascunho */}
        {rascunhoDisponivel && (() => {
          let info = "";
          try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) {
              const d = JSON.parse(raw);
              const feitos = (d.items ?? []).filter((i: any) => i.status !== "aguardando").length;
              const total = (d.items ?? []).length;
              const mins = Math.round((Date.now() - d.savedAt) / 60000);
              info = `${d.conferente} · ${feitos}/${total} itens · há ${mins < 1 ? "menos de 1 min" : `${mins} min`}`;
            }
          } catch { /**/ }
          return (
            <div style={{ background: "hsl(var(--warning) / 0.1)", border: "1.5px solid hsl(var(--warning) / 0.35)", borderRadius: 14, padding: "14px 16px" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 4 }}>📋 Conferência não finalizada</p>
              {info && <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>{info}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={restaurarRascunho}
                  style={{ flex: 1, height: 40, borderRadius: 10, border: "none", background: "hsl(var(--warning))", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                >
                  Continuar
                </button>
                <button
                  onClick={limparRascunho}
                  style={{ flex: 1, height: 40, borderRadius: 10, border: "1.5px solid hsl(var(--border))", background: "transparent", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "hsl(var(--muted-foreground))" }}
                >
                  Descartar
                </button>
              </div>
            </div>
          );
        })()}

        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Tipo</p>
            <div className="flex gap-2">
              {flagOptions.map((opt) => (
                <button key={opt.value} onClick={() => setFlag(opt.value)}
                  className="flex-1 h-11 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                  style={{
                    background: flag === opt.value ? "hsl(var(--primary))" : "hsl(var(--muted))",
                    color: flag === opt.value ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                    border: flag === opt.value ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Empresa</p>
            <div className="flex gap-2">
              {empresaOptions.map((opt) => (
                <button key={opt.value} onClick={() => { setEmpresa(opt.value); setSenha(""); setSenhaErro(false); }}
                  className="flex-1 h-11 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                  style={{
                    background: empresa === opt.value ? opt.color : "hsl(var(--muted))",
                    color: empresa === opt.value ? "#fff" : "hsl(var(--muted-foreground))",
                    border: empresa === opt.value ? `2px solid ${opt.color}` : "2px solid transparent",
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-foreground mb-1.5 block flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> Senha
            </label>
            <input
              type="password"
              placeholder="••••"
              value={senha}
              onChange={(e) => { setSenha(e.target.value); setSenhaErro(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && senha.trim()) confirmarSenha(); }}
              className={`w-full h-12 px-4 rounded-xl border bg-card text-foreground text-base font-bold text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-ring transition-all ${senhaErro ? "border-destructive ring-1 ring-destructive" : "border-input"}`}
            />
            {senhaErro && <p className="text-xs text-destructive mt-1">Senha incorreta para {empresa}</p>}
          </div>

          <div>
            <label className="text-sm font-semibold text-foreground mb-1.5 block">Nome do Conferente</label>
            <input
              type="text"
              placeholder="Ex: João Silva"
              value={conferente}
              onChange={(e) => setConferente(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-input bg-card text-foreground placeholder:text-muted-foreground text-base font-semibold focus:outline-none focus:ring-2 focus:ring-ring transition-all"
            />
          </div>

          <div className="flex justify-center pt-1"><EmpresaBadge /></div>

          {tasksErro && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">{tasksErro}</div>
          )}

          <button
            onClick={() => {
              if (!conferente.trim()) { toast({ title: "Informe o nome do conferente", variant: "destructive" }); return; }
              if (!senha.trim())      { toast({ title: "Informe a senha",               variant: "destructive" }); return; }
              confirmarSenha();
            }}
            disabled={loadingTasks}
            className="w-full h-13 bg-primary text-primary-foreground rounded-xl font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-primary/25 disabled:opacity-60"
          >
            {loadingTasks
              ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> Buscando...</>
              : <><ClipboardList className="w-5 h-5" /> Buscar Pedidos do Supabase</>}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {importError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">{importError}</div>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.json,.zip" onChange={handleFileImport} className="hidden" />
          <button
            onClick={() => {
              if (!conferente.trim()) { toast({ title: "Informe o nome do conferente", variant: "destructive" }); return; }
              fileInputRef.current?.click();
            }}
            className="w-full h-11 bg-muted text-muted-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border border-border"
          >
            <FileInput className="w-4 h-4" /> Selecionar Arquivo Manualmente
          </button>
        </div>
      </div>
    );
  }

  if (phase === "pickTask") {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setPhase("import")} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <div className="flex items-center gap-3">
            <button onClick={recarregarTasks} disabled={loadingTasks}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTasks ? "animate-spin" : ""}`} /> Atualizar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">Pedidos — Analisado</p>
            <p className="text-xs text-muted-foreground">{tasks.length} pedido(s) encontrado(s)</p>
          </div>
          <EmpresaBadge />
        </div>

        {tasksErro && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">{tasksErro}</div>
        )}

        {loadingTasks && (
          <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground">
            <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Carregando pedidos...</span>
          </div>
        )}

        {!loadingTasks && tasks.length === 0 && (
          <div className="text-center py-10">
            <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">Nenhum pedido no status Analisado</p>
            <p className="text-xs text-muted-foreground mt-1">Verifique o Supabase ou aguarde novas listas</p>
          </div>
        )}

        {/* Modal: confirmar task em andamento */}
        {modalConfirmAndamento && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-bold text-foreground text-sm">Pedido já em andamento</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Outra pessoa pode estar separando este pedido. Quer continuar mesmo assim?</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setModalConfirmAndamento(null); setForcarReservaAndamento(false); }} className="flex-1 h-11 rounded-xl border border-border bg-transparent text-sm font-700 cursor-pointer">Não</button>
                <button onClick={() => { setForcarReservaAndamento(true); const t = modalConfirmAndamento; setModalConfirmAndamento(null); setModalModoAberturaTask(t); }} className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground border-none text-sm font-bold cursor-pointer">Sim, continuar</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: escolher modo de abertura */}
        {modalModoAberturaTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
              <p className="font-bold text-foreground text-base text-center">Como deseja abrir este pedido?</p>
              <p className="text-xs text-muted-foreground text-center truncate">{modalModoAberturaTask.name}</p>
              <div className="flex flex-col gap-3 pt-1">
                <button
                  onClick={() => { const f = forcarReservaAndamento; setForcarReservaAndamento(false); abrirTaskComModo(modalModoAberturaTask, "visualizar", f); }}
                  className="w-full h-14 rounded-xl border-2 border-border bg-card text-sm font-bold cursor-pointer flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="text-base">👁️ Apenas Visualizar</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Abre sem reservar o pedido</span>
                </button>
                <button
                  onClick={() => { const f = forcarReservaAndamento; setForcarReservaAndamento(false); abrirTaskComModo(modalModoAberturaTask, "separacao", f); }}
                  className="w-full h-14 rounded-xl border-2 border-primary bg-primary/5 text-sm font-bold cursor-pointer flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="text-base text-primary">📦 Fazer Separação</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Reserva o pedido para separação</span>
                </button>
              </div>
              <button onClick={() => { setModalModoAberturaTask(null); setForcarReservaAndamento(false); }} className="w-full text-xs text-muted-foreground underline cursor-pointer bg-transparent border-none pt-1">Cancelar</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {tasks.map((task) => {
            const isLoading = loadingJson && taskSelecionada?.id === task.id;
            const emAndamento = task.emAndamento === true;
            const data = task.date_created
              ? new Date(Number(task.date_created)).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
              : "";
            return (
              <button
                key={task.id}
                onClick={() => {
                  if (emAndamento) setModalConfirmAndamento(task);
                  else setModalModoAberturaTask(task);
                }}
                disabled={loadingJson}
                className={`w-full text-left rounded-xl border p-4 flex items-center justify-between gap-3 active:scale-[0.99] transition-all disabled:opacity-60 ${emAndamento ? "border-warning/40 bg-warning/5 hover:border-warning/60" : "border-border bg-card hover:border-primary/40 hover:bg-primary/5"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-foreground truncate">{task.name}</p>
                    {emAndamento && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/30 flex-shrink-0">🔒 EM ANDAMENTO</span>
                    )}
                  </div>
                  {data && <p className="text-xs text-muted-foreground mt-0.5">{data}</p>}
                </div>
                {isLoading
                  ? <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  : <Play className={`w-4 h-4 flex-shrink-0 ${emAndamento ? "text-warning" : "text-primary"}`} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="p-4 space-y-4">
        <button onClick={voltarLiberandoPedido} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="text-center py-10">
          <div className="mb-3"><EmpresaBadge /></div>
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--success)/0.15)] flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-[hsl(var(--success))]" />
          </div>
          <p className="text-foreground font-semibold text-lg mb-1">Lista Importada!</p>
          <p className="text-sm text-muted-foreground mb-4"><strong>{items.length}</strong> itens prontos para conferência</p>
          <button onClick={startConference} className="w-full max-w-xs mx-auto h-14 bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] rounded-xl font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-transform shadow-lg">
            <Play className="w-6 h-6" /> Começar
          </button>
        </div>
      </div>
    );
  }

  if (phase === "finished") {
    const separados = items.filter((i) => i.status === "separado").length;
    const naoTem = items.filter((i) => i.status === "nao_tem").length;
    const naoTemTudo = items.filter((i) => i.status === "nao_tem_tudo").length;
    const pendentes = items.filter((i) => i.status === "pendente").length;
    return (
      <div className="p-4 space-y-4">
        <button onClick={voltarLiberandoPedido} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--success)/0.15)] flex items-center justify-center mx-auto mb-3">
            <Flag className="w-8 h-8 text-[hsl(var(--success))]" />
          </div>
          <p className="text-foreground font-semibold text-lg mb-1">Conferência Finalizada!</p>
          <p className="text-sm text-muted-foreground mb-1">👤 Conferente: <strong>{conferente}</strong></p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
            <Timer className="w-4 h-4" /> Tempo: <strong>{formatTime(elapsedSeconds)}</strong>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 space-y-2">
          <p className="text-sm font-bold text-foreground">Resumo - {items.length} itens</p>
          <div className="flex gap-2 flex-wrap text-xs font-semibold">
            <span className="px-2 py-1 rounded-lg bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">✅ {separados}</span>
            <span className="px-2 py-1 rounded-lg bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]">⚠️ {naoTemTudo}</span>
            <span className="px-2 py-1 rounded-lg bg-destructive/10 text-destructive">❌ {naoTem}</span>
            <span className="px-2 py-1 rounded-lg bg-muted text-muted-foreground">Pendente {pendentes}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={exportPDF} className="h-11 rounded-xl bg-accent text-accent-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={exportJSON} className="h-11 rounded-xl bg-accent text-accent-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
            <FileJson className="w-4 h-4" /> JSON
          </button>
          {apenasVisualizar && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-11 rounded-xl bg-warning/10 border border-warning/30 flex items-center justify-center gap-2 px-3 text-xs font-bold text-warning">
                👁️ Modo Visualização
              </div>
              <div className="flex h-11 rounded-xl border border-border overflow-hidden text-xs font-bold">
                <button
                  onClick={() => setViewMode("card")}
                  className={`px-3 flex items-center gap-1.5 transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent"}`}
                >
                  <span>1a1</span>
                </button>
                <button
                  onClick={() => setViewMode("lista")}
                  className={`px-3 flex items-center gap-1.5 border-l border-border transition-colors ${viewMode === "lista" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent"}`}
                >
                  <span>Lista</span>
                </button>
              </div>
            </div>
          )}
          <button
            onClick={enviarClickUp}
            disabled={apenasVisualizar || sendStatus === "sending" || sendStatus === "sent"}
            title={apenasVisualizar ? "Abra em modo Separação para enviar" : undefined}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            style={{
              background:
                sendStatus === "sent"    ? "hsl(var(--success))"     :
                sendStatus === "error"   ? "hsl(var(--destructive))"  :
                sendStatus === "sending" ? "hsl(var(--muted))"        :
                "hsl(var(--primary))",
              color:
                sendStatus === "sent"    ? "hsl(var(--success-foreground))"     :
                sendStatus === "error"   ? "hsl(var(--destructive-foreground))" :
                sendStatus === "sending" ? "hsl(var(--muted-foreground))"       :
                "hsl(var(--primary-foreground))",
            }}
          >
            {sendStatus === "sending" && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {sendStatus === "sent"    && <CheckCircle2 className="w-4 h-4" />}
            {sendStatus === "error"   && <XCircle className="w-4 h-4" />}
            {sendStatus === "idle"    && <Share2 className="w-4 h-4" />}
            {sendStatus === "sending" ? "Enviando…" :
             sendStatus === "sent"    ? "Enviado!" :
             sendStatus === "error"   ? "Tentar de novo" :
             "ClickUp"}
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => {
            const label = getStatusLabel(item.status);
            const StatusIcon = label.icon;
            return (
              <div key={item.id} className={`rounded-xl p-3 shadow-sm flex gap-3 items-center ${getStatusColor(item.status)}`}>
                {item.photo && <img src={item.photo} alt={item.codigo} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">#{idx + 1}</p>
                  <p className="text-sm font-mono font-bold text-foreground">{item.codigo}</p>
                  {item.sku && <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>}
                  <p className="text-xs text-muted-foreground">
                    Pedido: <strong>{item.quantidadePedida}</strong> • Real: <strong>{item.quantidadeReal}</strong>
                  </p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-semibold ${label.color}`}>
                  <StatusIcon className="w-4 h-4" /> {label.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const separados = items.filter((i) => i.status === "separado").length;
  const naoTem = items.filter((i) => i.status === "nao_tem").length;
  const naoTemTudo = items.filter((i) => i.status === "nao_tem_tudo").length;
  const pendentes = items.filter((i) => i.status === "pendente").length;
  const aguardando = items.filter((i) => i.status === "aguardando").length;
  const doneCount = items.length - aguardando;
  const label = currentItem ? getStatusLabel(currentItem.status) : null;
  const StatusIcon = label?.icon;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={voltarLiberandoPedido} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="flex items-center gap-2 text-sm font-mono font-bold text-foreground bg-card border border-border rounded-lg px-3 py-1.5">
          <Timer className="w-4 h-4 text-primary" />
          {formatTime(elapsedSeconds)}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold text-foreground">Item {currentIndex + 1} de {items.length}</span>
          <span className="text-muted-foreground">{doneCount}/{items.length} conferidos</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
        <div className="flex gap-2 flex-wrap text-xs font-semibold">
          <span className="px-2 py-0.5 rounded-lg bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">✅ {separados}</span>
          <span className="px-2 py-0.5 rounded-lg bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]">⚠️ {naoTemTudo}</span>
          <span className="px-2 py-0.5 rounded-lg bg-destructive/10 text-destructive">❌ {naoTem}</span>
          {pendentes > 0 && <span className="px-2 py-0.5 rounded-lg bg-muted text-muted-foreground">⏳ {pendentes}</span>}
          {aguardando > 0 && <span className="px-2 py-0.5 rounded-lg bg-muted/70 text-muted-foreground">Sem status {aguardando}</span>}
        </div>
      </div>

      {/* Modo Lista (visualizar) */}
      {apenasVisualizar && viewMode === "lista" && (
        <div className="space-y-2">
          {items.map((item, idx) => {
            const lbl = getStatusLabel(item.status);
            const LIcon = lbl.icon;
            return (
              <div key={item.id}
                onClick={() => { setViewMode("card"); setCurrentIndex(idx); }}
                className={`rounded-xl p-3 flex gap-3 items-center cursor-pointer active:scale-[0.99] transition-transform ${getStatusColor(item.status)}`}
              >
                {item.photo && <img src={item.photo} alt={item.codigo} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground font-mono">#{idx + 1}</p>
                  <p className="text-sm font-mono font-bold text-foreground truncate">{item.codigo}</p>
                  {item.sku && <p className="text-[11px] text-muted-foreground">SKU: {item.sku}</p>}
                  <p className="text-[11px] text-muted-foreground">Pedido: <strong>{item.quantidadePedida}</strong>{item.quantidadeReal !== null ? ` · Real: ${item.quantidadeReal}` : ""}</p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-semibold flex-shrink-0 ${lbl.color}`}>
                  <LIcon className="w-4 h-4" /> {lbl.text}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(!apenasVisualizar || viewMode === "card") && currentItem && (
        <div className={`rounded-xl p-4 space-y-4 shadow-md ${getStatusColor(currentItem.status)}`}>
          {currentItem.photo ? (
            <div className="flex justify-center">
              <img src={currentItem.photo} alt={currentItem.codigo} className="w-40 h-40 rounded-xl object-cover shadow-sm border border-border" />
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="w-28 h-28 rounded-xl bg-muted/50 flex items-center justify-center border border-border">
                <Package className="w-10 h-10 text-muted-foreground/50" />
              </div>
            </div>
          )}
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground font-semibold">ITEM {currentIndex + 1}</p>
            <p className="text-2xl font-mono font-black text-foreground tracking-wider">{currentItem.codigo}</p>
            {currentItem.sku && <p className="text-sm text-muted-foreground">SKU: <strong className="text-foreground">{currentItem.sku}</strong></p>}
            <p className="text-sm text-muted-foreground">
              Quantidade pedida: <strong className="text-foreground text-lg">{currentItem.quantidadePedida}</strong>
            </p>
          </div>
          {currentItem.status !== "aguardando" && label && StatusIcon && (
            <div className={`flex items-center justify-center gap-2 text-sm font-bold ${label.color}`}>
              <StatusIcon className="w-5 h-5" /> {label.text}
              {currentItem.quantidadeReal !== null && currentItem.status === "nao_tem_tudo" && (
                <span className="text-foreground ml-1">({currentItem.quantidadeReal})</span>
              )}
            </div>
          )}
          {!apenasVisualizar && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setStatus(currentItem.id, "separado")}
              className={`flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all ${
                currentItem.status === "separado"
                  ? "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] ring-2 ring-[hsl(var(--success))] ring-offset-2"
                  : "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.25)]"
              }`}>
              <CheckCircle2 className="w-4 h-4" /> Separado
            </button>
            <button onClick={() => setStatus(currentItem.id, "nao_tem")}
              className={`flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all ${
                currentItem.status === "nao_tem"
                  ? "bg-destructive text-destructive-foreground ring-2 ring-destructive ring-offset-2"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/20"
              }`}>
              <XCircle className="w-4 h-4" /> Não tem
            </button>
            <button onClick={() => setStatus(currentItem.id, "nao_tem_tudo")}
              className={`flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all ${
                currentItem.status === "nao_tem_tudo"
                  ? "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))] ring-2 ring-[hsl(var(--warning))] ring-offset-2"
                  : "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning)/0.25)]"
              }`}>
              <AlertTriangle className="w-4 h-4" /> Parcial
            </button>
            <button onClick={() => setStatus(currentItem.id, "pendente")}
              className={`flex-1 h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all ${
                currentItem.status === "pendente"
                  ? "bg-muted-foreground text-background ring-2 ring-muted-foreground ring-offset-2"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}>
              <Timer className="w-4 h-4" /> Pendente
            </button>
          </div>
          )}
          {!apenasVisualizar && currentItem.status === "nao_tem_tudo" && (
            <div className="flex items-center gap-3 bg-card/50 rounded-lg p-3 border border-border">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Qtd disponível:</label>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max={currentItem.quantidadePedida - 1}
                placeholder="Qtd"
                value={currentItem.quantidadeReal ?? ""}
                onChange={(e) => handleQuantityChange(currentItem.id, e.target.value)}
                className="flex-1 h-10 px-3 rounded-lg border border-input bg-card text-foreground text-base font-bold text-center focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {(!apenasVisualizar || viewMode === "card") && <div className="flex gap-2">
        <button onClick={goPrev} disabled={currentIndex === 0}
          className="h-12 px-4 rounded-xl bg-accent text-accent-foreground font-semibold text-sm flex items-center justify-center gap-1 active:scale-[0.98] transition-transform disabled:opacity-30">
          <ChevronLeft className="w-5 h-5" /> Anterior
        </button>
        {isLastItem ? (
          apenasVisualizar ? (
            <button onClick={voltarLiberandoPedido}
              className="flex-1 h-12 rounded-xl bg-accent text-accent-foreground font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              <ArrowLeft className="w-5 h-5" /> Sair
            </button>
          ) : (
            <button onClick={finishConference} disabled={!allDone}
              className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-primary/25 disabled:opacity-40">
              <Flag className="w-5 h-5" /> Finalizar
            </button>
          )
        ) : (
          <button onClick={goNext} disabled={!apenasVisualizar && !isCurrentComplete}
            className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-primary/25 disabled:opacity-40">
            Próximo <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>}
    </div>
  );
};

export default ConferenceView;
