import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, RefreshCw, Check, ThumbsDown, ThumbsUp, Upload, Loader2, ShoppingCart, X, Filter, TrendingUp, FileDown, MoreVertical, Barcode } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useRef, useMemo, useEffect } from "react";
import { useProdutosComprar, type ProdutoComprar } from "@/hooks/useProdutosComprar";
import { obterLoginSalvo } from "@/hooks/useAuth";
import { getSecoesFixasPorEmpresa } from "@/lib/secoesCompras";
import { blobToDataUrl, isDataPhotoUrl } from "@/lib/photoUtils";
import { useToast } from "@/hooks/use-toast";
import {
  buscarProdutoVarejoFacil,
  buscarVelocidadeVendaProduto,
  buscarPedidosCompraAbertosPorProduto,
  buscarFornecedorPrincipalProduto,
  type VarejoFacilProduct,
  type VelocidadeVendaProduto,
  type PedidoCompraAberto,
} from "@/lib/varejoFacilIntegration";
import {
  gerarPdfPedidoFornecedor,
  baixarPdfNoNavegador,
  type ItemPedidoPdf,
} from "@/lib/pedidoFornecedorPdf";

const PAGE_SIZE = 10;
const ERP_BATCH_SIZE = 5;
const CACHE_TTL_MS = 30 * 60 * 1000;
const ERP_MISS_TTL_MS = 60 * 60 * 1000;
// Desativado por ora: a API do ERP nao aceita os nomes de campo que o swagger
// documenta pra filtrar/ordenar cupons fiscais (dataVenda e identificadorId deram
// erro/retorno vazio em producao). Reativar quando confirmarmos os campos reais
// com uma amostra da API (ver PROGRESSO.md).
const VELOCIDADE_VENDA_ATIVA = false;

type FotoFonte = "SUPABASE" | "ERP" | "CLICKUP_TASK" | "CLICKUP_LIST";

type FotoOpcao = {
  src: string;
  fonte: FotoFonte;
};

type StatusFiltro = "todos" | "todo" | "produto_ruim" | "produto_bom" | "fazer_pedido";

const STATUS_FILTROS: Array<{ value: StatusFiltro; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "fazer_pedido", label: "Fazer Pedido" },
  { value: "produto_bom", label: "Galpao" },
  { value: "produto_ruim", label: "Ruim" },
  { value: "todo", label: "Pendente" },
];

// Valor especial do filtro de secao: mostra apenas as secoes atribuidas ao
// comprador no perfil (login.secoesCompras). Se o comprador tiver secoes
// configuradas, o filtro ja abre nessa opcao.
const FILTRO_MINHAS_SECOES = "__minhas_secoes__";

const STATUS_PRIORITY: Record<string, number> = {
  fazer_pedido: 0,
  produto_bom: 1,
  produto_ruim: 2,
  todo: 3,
  pedido_andamento: 4,
  compra_realizada: 5,
  concluido: 6,
};

function getComprasCacheKey(empresa: string, tipo: "erp" | "fotos"): string {
  return `compras:${tipo}:${empresa}`;
}

function isComprasDesktop(): boolean {
  try {
    return localStorage.getItem('modoDesktop') === 'true' || window.innerWidth >= 1024;
  } catch { return false; }
}

function lerCacheLocal<T>(key: string): T | null {
  if (!isComprasDesktop()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { data?: T; updatedAt?: number };
    if (!parsed.data || typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > CACHE_TTL_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

function salvarCacheLocal<T>(key: string, data: T) {
  if (!isComprasDesktop()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ data, updatedAt: Date.now() }));
  } catch {
    // Cache local e opcional.
  }
}

const erpMissCache = new Map<string, number>();

function getErpMissCacheKey(empresa: string, codigo: string): string {
  return `compras:erp-miss:${empresa}:${codigo}`;
}

function isErpMissBloqueado(empresa: string, codigo: string): boolean {
  const key = getErpMissCacheKey(empresa, codigo);
  const mem = erpMissCache.get(key);
  if (mem && Date.now() - mem < ERP_MISS_TTL_MS) return true;
  if (mem) erpMissCache.delete(key);

  try {
    const raw = window.localStorage.getItem(key);
    const ts = raw ? Number(raw) : 0;
    if (ts && Date.now() - ts < ERP_MISS_TTL_MS) {
      erpMissCache.set(key, ts);
      return true;
    }
    if (raw) window.localStorage.removeItem(key);
  } catch {
    // Cache negativo e opcional.
  }

  return false;
}

function marcarErpMiss(empresa: string, codigo: string) {
  const key = getErpMissCacheKey(empresa, codigo);
  const ts = Date.now();
  erpMissCache.set(key, ts);
  try { window.localStorage.setItem(key, String(ts)); } catch { /* opcional */ }
}

function limparErpMiss(empresa: string, codigo: string) {
  const key = getErpMissCacheKey(empresa, codigo);
  erpMissCache.delete(key);
  try { window.localStorage.removeItem(key); } catch { /* opcional */ }
}

function isValidImageSrc(foto: string | null): boolean {
  if (!foto) return false;
  if (foto.startsWith("http://") || foto.startsWith("https://")) return true;
  return isDataPhotoUrl(foto);
}

async function baixarImagemParaDataUrl(src: string): Promise<string> {
  if (isDataPhotoUrl(src)) return src;

  const response = await fetch(src);
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const detail = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    throw new Error(`Falha ao baixar imagem (${response.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }

  if (contentType.includes("application/json")) {
    const data = await response.json();
    if (typeof data?.dataUrl === "string" && isDataPhotoUrl(data.dataUrl)) return data.dataUrl;
    throw new Error(data?.error || "Proxy retornou JSON sem dataUrl");
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Resposta nao e imagem (${blob.type || "sem content-type"})`);
  }

  return await blobToDataUrl(blob);
}

function getCodigoConsulta(codigo: string): string {
  const inicio = codigo.match(/^\s*(\d{6,14})(?=\D|$)/);
  if (inicio) return inicio[1];

  const qualquerCodigo = codigo.match(/\d{6,14}/);
  return qualquerCodigo?.[0] ?? codigo;
}

function isDescricaoRealProduto(produto: Pick<ProdutoComprar, "codigo" | "descricao">): boolean {
  const descricao = produto.descricao.trim();
  if (!descricao) return false;

  const codigo = produto.codigo.trim();
  const codigoConsulta = getCodigoConsulta(produto.codigo).trim();
  const descricaoNormalizada = normalizarFiltro(descricao);

  if (descricao === codigo || descricao === codigoConsulta) return false;
  if (/^\d{6,14}$/.test(descricao)) return false;
  if (descricao.includes("🛒")) return false;
  if (codigoConsulta && descricao.includes(codigoConsulta)) return false;
  if (descricaoNormalizada.includes("carlos")) return false;
  if (/\s[\u2014-]\s/.test(descricao) && /\d{6,14}/.test(descricao)) return false;

  return true;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getDescricaoExibicao(
  produto: ProdutoComprar,
  produtoErp: VarejoFacilProduct | null | undefined
): string {
  const descricaoErp = produtoErp?.descricao?.trim();
  if (descricaoErp) return descricaoErp;
  if (isDescricaoRealProduto(produto)) return produto.descricao.trim();
  return "Consultando descricao no ERP";
}

function formatarPreco(valor: number | undefined | null): string | null {
  if (!valor || valor <= 0) return null;
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Deixa a secao em Caixa de Titulo ("UTILIDADES DOMESTICAS" -> "Utilidades Domesticas").
function formatarSecao(secao: string | null | undefined): string | null {
  const limpo = secao?.trim();
  if (!limpo) return null;
  return limpo
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s/\-–—])(\p{L})/gu, (_, sep: string, letra: string) => sep + letra.toLocaleUpperCase("pt-BR"));
}

// Destaque do card: os primeiros N caracteres da descricao (nao o codigo de barras).
function truncarDescricao(descricao: string, max = 30): string {
  const limpo = (descricao || "").trim();
  if (limpo.length <= max) return limpo;
  return `${limpo.slice(0, max).trimEnd()}…`;
}

function formatarVelocidadeVenda(velocidade: VelocidadeVendaProduto | null | undefined): string | null {
  if (!velocidade) return null;
  // Erro na consulta ao ERP nao e a mesma coisa que "0 vendas" — nao mostra numero
  // confiante quando a busca falhou (ve detalhes em console "[VarejoFacil][Velocidade]").
  if (velocidade.erro) return "⚠️ erro ao consultar vendas";
  const porDia = velocidade.mediaPorDia;
  const unidadesPeriodo = velocidade.unidades;
  // "+" indica que a contagem bateu no limite de seguranca antes de cobrir o
  // periodo inteiro (loja com bastante movimento) — numero e um piso, nao exato.
  const sufixo = velocidade.parcial ? "+" : "";
  if (porDia >= 1) {
    return `~${porDia.toFixed(1)} un/dia${sufixo}`;
  }
  return `${unidadesPeriodo}${sufixo} un/${velocidade.dias}d`;
}

function normalizarFiltro(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function secaoCombinaFiltro(secao: string | null | undefined, filtro: string): boolean {
  if (filtro === "todos") return true;

  const secaoNormalizada = normalizarFiltro(secao);
  const filtroNormalizado = normalizarFiltro(filtro);
  if (!secaoNormalizada || !filtroNormalizado) return false;

  return (
    secaoNormalizada === filtroNormalizado ||
    secaoNormalizada.includes(filtroNormalizado) ||
    filtroNormalizado.includes(secaoNormalizada)
  );
}

// Aplica o filtro de secao considerando a opcao especial "Minhas secoes": nesse
// caso o produto entra se casar com QUALQUER uma das secoes do comprador.
function produtoCombinaSecao(
  secao: string | null | undefined,
  filtro: string,
  secoesCompras: string[]
): boolean {
  if (filtro === FILTRO_MINHAS_SECOES) {
    if (secoesCompras.length === 0) return true;
    // Item ainda SEM secao (recem-escaneado, nao enriquecido pelo ERP) precisa
    // aparecer para o comprador — e justamente o que ele tem que triar. Sem isso,
    // uma base recem-importada (secao=null) fica invisivel em "Minhas secoes".
    if (!normalizarFiltro(secao)) return true;
    return secoesCompras.some((minha) => secaoCombinaFiltro(secao, minha));
  }
  return secaoCombinaFiltro(secao, filtro);
}

function getImagemErroKey(produtoId: string, fonte: FotoFonte, foto: string | null): string {
  return `${produtoId}:${fonte}:${foto || "sem-foto"}`;
}

function montarOpcoesFoto(
  produto: ProdutoComprar,
  produtoErp: VarejoFacilProduct | null | undefined,
  fotosClickUp: Record<string, string | null>
): FotoOpcao[] {
  // Foto ja no Supabase Storage tem prioridade (rapida, sem consultar o ERP).
  const fotoStorage = Boolean(produto.foto && produto.foto.includes("/storage/v1/object/public/"));
  return [
    fotoStorage ? { src: produto.foto as string, fonte: "SUPABASE" as const } : null,
    produtoErp?.imagem ? { src: produtoErp.imagem, fonte: "ERP" as const } : null,
    fotosClickUp[produto.id] ? { src: fotosClickUp[produto.id] as string, fonte: "CLICKUP_TASK" as const } : null,
    !fotoStorage && produto.foto ? { src: produto.foto, fonte: "CLICKUP_LIST" as const } : null,
  ].filter((opcao): opcao is FotoOpcao => Boolean(opcao?.src && isValidImageSrc(opcao.src)));
}

function selecionarFotoProduto(
  produto: ProdutoComprar,
  produtoErp: VarejoFacilProduct | null | undefined,
  fotosClickUp: Record<string, string | null>,
  imagemComErro: Record<string, boolean>
): FotoOpcao | null {
  return montarOpcoesFoto(produto, produtoErp, fotosClickUp).find((opcao) => (
    !imagemComErro[getImagemErroKey(produto.id, opcao.fonte, opcao.src)]
  )) ?? null;
}

const Compras = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  // Secoes atribuidas ao comprador no perfil (login.secoesCompras). Lido uma vez:
  // trocar de perfil recarrega a pagina, entao nao muda durante o uso da tela.
  const secoesCompras = useMemo(() => obterLoginSalvo()?.secoesCompras ?? [], []);
  const temSecoesCompras = secoesCompras.length > 0;
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusFiltro>("todos");
  const [filtroSecao, setFiltroSecao] = useState(temSecoesCompras ? FILTRO_MINHAS_SECOES : "todos");
  const [filtroSecaoAnalise, setFiltroSecaoAnalise] = useState(temSecoesCompras ? FILTRO_MINHAS_SECOES : "todos");
  const [ordenarMaisPedidos, setOrdenarMaisPedidos] = useState(false);
  const [ordenarMaisVendidos, setOrdenarMaisVendidos] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [imagemComErro, setImagemComErro] = useState<Record<string, boolean>>({});
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<string | null>(null);
  const [produtosErp, setProdutosErp] = useState<Record<string, VarejoFacilProduct | null>>({});
  const [velocidadeVendas, setVelocidadeVendas] = useState<Record<string, VelocidadeVendaProduto | null>>({});
  const [fotosClickUp, setFotosClickUp] = useState<Record<string, string | null>>({});
  const [itensSelecionadosPedido, setItensSelecionadosPedido] = useState<Set<string>>(new Set());
  const [gerandoPedidos, setGerandoPedidos] = useState(false);
  const [baixandoPdfPedido, setBaixandoPdfPedido] = useState<string | null>(null);
  const [analiseAberta, setAnaliseAberta] = useState(false);
  // Item aberto no modal de detalhes (mostra codigo de barras + acoes).
  const [produtoDetalhe, setProdutoDetalhe] = useState<ProdutoComprar | null>(null);
  const [escolhaDireita, setEscolhaDireita] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const produtosErpRef = useRef<Record<string, VarejoFacilProduct | null>>({});
  const {
    produtos,
    loading,
    error,
    refetch,
    like,
    dislike,
    fazerPedido,
    pedidoAndamento,
    compraRealizada,
    concluir,
    ultimaAtualizacao,
    empresa,
    fonte,
    setFonte,
    persistirSecao,
    persistirDescricao,
    persistirFoto,
    marcarPedidoFeito,
  } = useProdutosComprar();

  useEffect(() => {
    produtosErpRef.current = produtosErp;
  }, [produtosErp]);

  useEffect(() => {
    const erpCache = lerCacheLocal<Record<string, VarejoFacilProduct | null>>(getComprasCacheKey(empresa, "erp")) ?? {};
    produtosErpRef.current = erpCache;
    setProdutosErp(erpCache);
    setFotosClickUp(lerCacheLocal<Record<string, string | null>>(getComprasCacheKey(empresa, "fotos")) ?? {});
    setVelocidadeVendas({});
    setImagemComErro({});
  }, [empresa]);

  const executarAcao = async (
    actionKey: string,
    action: () => Promise<void>,
    sucesso: string
  ) => {
    setAcaoEmAndamento(actionKey);
    try {
      await action();
      toast({ title: sucesso });
    } catch (err) {
      toast({
        title: "Erro em Compras",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setAcaoEmAndamento(null);
    }
  };

  // Antes de mandar "Fazer Pedido", confere no ERP se ja existe pedido de compra
  // aberto com algum fornecedor desse produto. Se a checagem falhar (ERP fora, sem
  // fornecedor cadastrado etc.), nao bloqueia o fluxo normal do app.
  const confirmarFazerPedido = async (produtoId: string): Promise<boolean> => {
    const produtoErpId = produtosErp[produtoId]?.id;
    if (!produtoErpId) return true;

    try {
      const pedidosAbertos = await buscarPedidosCompraAbertosPorProduto(produtoErpId, { empresa, flag: "loja" });
      if (pedidosAbertos.length === 0) return true;

      const resumo = pedidosAbertos
        .map((p: PedidoCompraAberto) => `Pedido #${p.pedidoId} — status ${p.status}${p.dataDeEmissao ? ` (${p.dataDeEmissao})` : ""} — ${p.quantidadePedida} un.`)
        .join("\n");

      return window.confirm(
        `Já existe pedido de compra aberto no ERP para esse produto:\n\n${resumo}\n\nMarcar mesmo assim como "Fazer Pedido"?`
      );
    } catch (err) {
      console.error("[Compras][PedidoAberto] Checagem falhou", { produtoId, erro: err instanceof Error ? err.message : String(err) });
      return true;
    }
  };

  const toggleSelecaoPedido = (produtoId: string) => {
    setItensSelecionadosPedido((prev) => {
      const next = new Set(prev);
      if (next.has(produtoId)) next.delete(produtoId);
      else next.add(produtoId);
      return next;
    });
  };

  const SEM_FORNECEDOR_KEY = "SEM_FORNECEDOR";

  // Pra cada item selecionado: resolve o fornecedor PRINCIPAL no ERP, agrupa por
  // fornecedor, gera 1 PDF (foto+codigo+descricao) por grupo, baixa no navegador
  // e marca pedido_feito no Supabase.
  const gerarPedidosPorFornecedor = async () => {
    const idsSelecionados = Array.from(itensSelecionadosPedido);
    if (idsSelecionados.length === 0) return;

    setGerandoPedidos(true);
    try {
      const selecionados = produtos.filter((p) => idsSelecionados.includes(p.id));
      const grupos = new Map<string, { nome: string; itens: ProdutoComprar[] }>();
      const semProdutoErp: ProdutoComprar[] = [];

      for (const produto of selecionados) {
        const produtoErpId = produtosErp[produto.id]?.id;
        if (!produtoErpId) {
          semProdutoErp.push(produto);
          continue;
        }

        let fornecedorId = SEM_FORNECEDOR_KEY;
        let fornecedorNome = "Sem Fornecedor Cadastrado";
        try {
          const fornecedor = await buscarFornecedorPrincipalProduto(produtoErpId, { empresa, flag: "loja" });
          if (fornecedor) {
            fornecedorId = fornecedor.fornecedorId;
            fornecedorNome = fornecedor.nome;
          }
        } catch (err) {
          console.error("[Compras][Pedido] Falha ao resolver fornecedor", {
            produtoId: produto.id,
            produtoErpId,
            erro: err instanceof Error ? err.message : String(err),
          });
        }

        const grupo = grupos.get(fornecedorId) ?? { nome: fornecedorNome, itens: [] };
        grupo.itens.push(produto);
        grupos.set(fornecedorId, grupo);
      }

      if (semProdutoErp.length > 0) {
        toast({
          title: "Alguns itens ficaram de fora",
          description: `${semProdutoErp.length} item(ns) ainda nao carregaram os dados do ERP — espera a foto/preco aparecer na tela e tenta de novo.`,
          variant: "destructive",
        });
      }

      let totalProcessado = 0;
      const erros: string[] = [];

      for (const [fornecedorId, grupo] of grupos) {
        const itensPdf: ItemPedidoPdf[] = grupo.itens.map((produto) => {
          const produtoErp = produtosErp[produto.id];
          const fotoSelecionada = selecionarFotoProduto(produto, produtoErp, fotosClickUp, imagemComErro);
          return {
            codigo: produto.codigo,
            descricao: getDescricaoExibicao(produto, produtoErp),
            foto: fotoSelecionada?.src ?? null,
          };
        });

        let pdf;
        try {
          pdf = await gerarPdfPedidoFornecedor(fornecedorId, grupo.nome, itensPdf);
          baixarPdfNoNavegador(pdf);
        } catch (err) {
          erros.push(`${grupo.nome}: falha ao gerar PDF (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }

        for (const produto of grupo.itens) {
          // Marca "pedido feito" no Supabase (pedido_feito = 1). O trigger no
          // banco ja move o item para "pedido feito" (pedido_andamento).
          try {
            await marcarPedidoFeito(produto.id);
            totalProcessado += 1;
          } catch (err) {
            console.error("[Compras][Pedido] Falha ao marcar pedido feito", {
              produtoId: produto.id,
              erro: err instanceof Error ? err.message : String(err),
            });
            erros.push(`${produto.codigo}: PDF baixado mas nao marcou pedido feito`);
          }
        }
      }

      setItensSelecionadosPedido(new Set());

      if (totalProcessado > 0) {
        toast({
          title: `${grupos.size} PDF(s) gerado(s)`,
          description: `${totalProcessado} item(ns) marcado(s) como Pedido Feito.`,
        });
      }
      if (erros.length > 0) {
        toast({ title: "Alguns itens tiveram problema", description: erros.join(" | "), variant: "destructive" });
      }
    } finally {
      setGerandoPedidos(false);
    }
  };

  // Regenera o PDF do pedido a partir dos dados atuais do item (sem depender de
  // anexo no ClickUp). Resolve o fornecedor pelo ERP; se nao achar, gera "Sem Fornecedor".
  const baixarOuReBaixarPdfPedido = async (produto: ProdutoComprar) => {
    setBaixandoPdfPedido(produto.id);
    try {
      const produtoErp = produtosErp[produto.id];
      const fotoSelecionada = selecionarFotoProduto(produto, produtoErp, fotosClickUp, imagemComErro);

      let fornecedorId = SEM_FORNECEDOR_KEY;
      let fornecedorNome = "Sem Fornecedor Cadastrado";
      const produtoErpId = produtoErp?.id;
      if (produtoErpId) {
        try {
          const fornecedor = await buscarFornecedorPrincipalProduto(produtoErpId, { empresa, flag: "loja" });
          if (fornecedor) {
            fornecedorId = fornecedor.fornecedorId;
            fornecedorNome = fornecedor.nome;
          }
        } catch {
          // sem fornecedor: segue com o padrao
        }
      }

      const pdf = await gerarPdfPedidoFornecedor(fornecedorId, fornecedorNome, [{
        codigo: produto.codigo,
        descricao: getDescricaoExibicao(produto, produtoErp),
        foto: fotoSelecionada?.src ?? null,
      }]);
      baixarPdfNoNavegador(pdf);
    } catch (err) {
      toast({ title: "Erro ao gerar PDF", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBaixandoPdfPedido(null);
    }
  };

  const produtosPorBuscaStatus = useMemo(() => {
    const termo = searchTerm.toLowerCase();
    return produtos.filter((p) => (
      (filtroStatus === "todos" || p.status === filtroStatus) &&
      (
        p.codigo.toLowerCase().includes(termo) ||
        p.descricao.toLowerCase().includes(termo) ||
        (p.sku || "").toLowerCase().includes(termo)
      )
    ));
  }, [filtroStatus, produtos, searchTerm]);

  const secoesDisponiveis = useMemo(() => {
    const secoes = new Map<string, string>();

    for (const secao of getSecoesFixasPorEmpresa(empresa)) {
      secoes.set(normalizarFiltro(secao), secao);
    }

    for (const produtoErp of Object.values(produtosErp)) {
      const secao = produtoErp?.secao?.trim();
      if (!secao) continue;
      secoes.set(normalizarFiltro(secao), secao);
    }

    // Secoes ja persistidas no proprio produto (Supabase) — nao dependem do ERP.
    for (const produto of produtos) {
      const secao = produto.secao?.trim();
      if (!secao) continue;
      secoes.set(normalizarFiltro(secao), secao);
    }

    return Array.from(secoes.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [empresa, produtosErp, produtos]);

  const filteredProdutos = useMemo(() => {
    return produtosPorBuscaStatus.filter((p) => (
      produtoCombinaSecao(p.secao ?? produtosErp[p.id]?.secao, filtroSecao, secoesCompras)
    ));
  }, [filtroSecao, produtosErp, produtosPorBuscaStatus, secoesCompras]);

  const produtosOrdenados = useMemo(() => {
    if (ordenarMaisPedidos) {
      return [...filteredProdutos].sort((a, b) => {
        const vezesA = a.vezesPedido ?? 1;
        const vezesB = b.vezesPedido ?? 1;
        if (vezesA !== vezesB) return vezesB - vezesA;
        return Number(b.date_created || 0) - Number(a.date_created || 0);
      });
    }

    return [...filteredProdutos].sort((a, b) => {
      const prioridadeA = STATUS_PRIORITY[a.status] ?? 99;
      const prioridadeB = STATUS_PRIORITY[b.status] ?? 99;
      if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
      return Number(b.date_created || 0) - Number(a.date_created || 0);
    });
  }, [filteredProdutos, ordenarMaisPedidos]);

  const totalPaginas = Math.max(1, Math.ceil(produtosOrdenados.length / PAGE_SIZE));

  useEffect(() => {
    setPaginaAtual(1);
  }, [filtroSecao, filtroStatus, searchTerm, produtos.length, ordenarMaisPedidos]);

  useEffect(() => {
    if (paginaAtual > totalPaginas) {
      setPaginaAtual(totalPaginas);
    }
  }, [paginaAtual, totalPaginas]);

  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const fim = inicio + PAGE_SIZE;
  const produtosPaginados = produtosOrdenados.slice(inicio, fim);

  // "Mais Vendidos" so reordena dentro da pagina atual: a API do ERP nao filtra cupom
  // fiscal por produto, entao ranquear o catalogo inteiro exigiria resolver o produtoId
  // de cada item filtrado (caro). Aqui so reordenamos os ~10 itens ja carregados pela
  // pagina; conforme a velocidade de cada um chega, a ordem destes 10 se ajusta. Ao
  // mudar de pagina, os proximos 10 carregam e ordenam do mesmo jeito.
  const produtosPaginadosExibidos = useMemo(() => {
    if (!ordenarMaisVendidos) return produtosPaginados;
    return [...produtosPaginados].sort((a, b) => {
      const unidadesA = velocidadeVendas[a.id]?.unidades ?? -1;
      const unidadesB = velocidadeVendas[b.id]?.unidades ?? -1;
      return unidadesB - unidadesA;
    });
  }, [produtosPaginados, ordenarMaisVendidos, velocidadeVendas]);
  const produtosPendentesAnalise = useMemo(() => {
    return [...produtos.filter((produto) => produto.status === "todo")].sort((a, b) => (
      Number(b.date_created || 0) - Number(a.date_created || 0)
    ));
  }, [produtos]);
  const produtosAnalise = useMemo(
    () => produtosPendentesAnalise.filter((produto) => (
      produtoCombinaSecao(produto.secao ?? produtosErp[produto.id]?.secao, filtroSecaoAnalise, secoesCompras)
    )),
    [filtroSecaoAnalise, produtosErp, produtosPendentesAnalise, secoesCompras]
  );
  const produtoAnalise = produtosAnalise[0] ?? null;
  const produtoAnaliseErp = produtoAnalise ? produtosErp[produtoAnalise.id] : null;
  const fotoAnaliseSelecionada = produtoAnalise
    ? selecionarFotoProduto(produtoAnalise, produtoAnaliseErp, fotosClickUp, imagemComErro)
    : null;
  const fotoAnalise = fotoAnaliseSelecionada?.src ?? null;
  const descricaoAnalise = produtoAnalise ? getDescricaoExibicao(produtoAnalise, produtoAnaliseErp) : "";
  const precoVendaAnalise = formatarPreco(produtoAnaliseErp?.precoVarejo);
  const velocidadeVendaAnalise = produtoAnalise ? formatarVelocidadeVenda(velocidadeVendas[produtoAnalise.id]) : null;
  const podeMostrarFotoAnalise = Boolean(produtoAnalise && fotoAnaliseSelecionada);

  useEffect(() => {
    let cancelado = false;

    const carregarProdutosErp = async () => {
      const origemTela = filtroSecao === "todos" ? produtosPaginados : produtosPorBuscaStatus;
      const origemAnalise = analiseAberta
        ? [
            produtoAnalise,
            ...(filtroSecaoAnalise === "todos" ? [] : produtosPendentesAnalise),
          ].filter((produto): produto is ProdutoComprar => Boolean(produto))
        : [];
      const origem = Array.from(
        new Map([...origemTela, ...origemAnalise].map((produto) => [produto.id, produto])).values()
      );
      const limite = filtroSecao !== "todos" || (analiseAberta && filtroSecaoAnalise !== "todos") ? 25 : PAGE_SIZE;
      const erpAtual = produtosErpRef.current;
      const pendentes = origem
        .filter((produto) => {
          const codigo = getCodigoConsulta(produto.codigo).trim();
          if (!codigo) return false;
          if (produto.id in erpAtual) return false;
          if (isErpMissBloqueado(empresa, codigo)) return false;

          const temDadosPersistidos =
            isDescricaoRealProduto(produto) &&
            Boolean(produto.secao?.trim()) &&
            Boolean(produto.foto && produto.foto.includes("/storage/v1/object/public/"));

          return !temDadosPersistidos;
        })
        .slice(0, limite);
      if (pendentes.length === 0) return;

      const resultados: Array<readonly [string, VarejoFacilProduct | null]> = [];
      for (const lote of chunkArray(pendentes, ERP_BATCH_SIZE)) {
        if (cancelado) return;
        const loteResultados = await Promise.all(
          lote.map(async (produto) => {
            const codigo = getCodigoConsulta(produto.codigo);
            try {
              const cacheAtual = produtosErpRef.current;
              let dados = cacheAtual[produto.id];
              if (!(produto.id in cacheAtual)) {
                dados = await buscarProdutoVarejoFacil(codigo, { empresa, flag: "loja" });
              }
              if (dados) limparErpMiss(empresa, codigo);
              else marcarErpMiss(empresa, codigo);
              if (dados?.imagem && !dados.imagem.startsWith("data:")) {
                try {
                  const imagemDataUrl = await baixarImagemParaDataUrl(dados.imagem);
                  dados = { ...dados, imagem: imagemDataUrl };
                } catch (imageError) {
                  console.error("[Compras][Foto] ERP imagem nao baixou", {
                    produtoId: produto.id,
                    codigo,
                    erpId: dados.id,
                    imagem: dados.imagem,
                    erro: imageError instanceof Error ? imageError.message : String(imageError),
                  });
                }
              }
              return [produto.id, dados ?? null] as const;
            } catch (err) {
              marcarErpMiss(empresa, codigo);
              console.error("[Compras][Foto] ERP falhou", {
                produtoId: produto.id,
                codigo,
                erro: err instanceof Error ? err.message : String(err),
              });
              return [produto.id, null] as const;
            }
          })
        );
        resultados.push(...loteResultados);
      }

      if (cancelado) return;
      setProdutosErp((prev) => {
        const next = { ...prev };
        for (const [id, dados] of resultados) {
          next[id] = dados;
        }
        produtosErpRef.current = next;
        salvarCacheLocal(getComprasCacheKey(empresa, "erp"), next);
        return next;
      });

      // Grava dados do ERP no Supabase (uma vez) para nao reconsultar depois.
      for (const [id, dados] of resultados) {
        const secaoErp = dados?.secao?.trim();
        const descricaoErp = dados?.descricao?.trim();
        if (secaoErp) persistirSecao(id, secaoErp);
        if (descricaoErp) persistirDescricao(id, descricaoErp);
        if (dados?.imagem && dados.imagem.startsWith("data:")) persistirFoto(id, dados.imagem);
      }
    };

    void carregarProdutosErp();

    return () => {
      cancelado = true;
    };
  }, [
    analiseAberta,
    empresa,
    filtroSecao,
    filtroSecaoAnalise,
    produtoAnalise,
    produtosPaginados,
    produtosPendentesAnalise,
    produtosPorBuscaStatus,
    persistirSecao,
    persistirDescricao,
    persistirFoto,
  ]);

  // Fallback de foto via ClickUp removido (endpoint nao existe mais). fotosClickUp
  // fica sempre vazio; montarOpcoesFoto ja cai pra SUPABASE/ERP nesse caso.

  // Velocidade de venda: so consulta depois que o produtoErp ja carregou (precisa do
  // produtoId do ERP). A primeira chamada por empresa pagina os cupons fiscais e fica
  // em cache por 30min; as proximas so leem o mapa ja calculado.
  useEffect(() => {
    let cancelado = false;

    const carregarVelocidadeVendas = async () => {
      if (!VELOCIDADE_VENDA_ATIVA) return;
      const origem = Array.from(
        new Map([
          ...produtosPaginados,
          ...(produtoAnalise ? [produtoAnalise] : []),
        ].map((produto) => [produto.id, produto])).values()
      );
      const pendentes = origem.filter((produto) => {
        const produtoErpId = produtosErp[produto.id]?.id;
        return Boolean(produtoErpId) && !(produto.id in velocidadeVendas);
      });

      if (pendentes.length === 0) return;

      const resultados = await Promise.all(
        pendentes.map(async (produto) => {
          const produtoErpId = produtosErp[produto.id]?.id as string;
          try {
            const velocidade = await buscarVelocidadeVendaProduto(produtoErpId, { empresa, flag: "loja" });
            return [produto.id, velocidade] as const;
          } catch (err) {
            console.error("[Compras][Velocidade] ERP falhou", {
              produtoId: produto.id,
              produtoErpId,
              erro: err instanceof Error ? err.message : String(err),
            });
            return [produto.id, null] as const;
          }
        })
      );

      if (cancelado) return;
      setVelocidadeVendas((prev) => {
        const next = { ...prev };
        for (const [id, velocidade] of resultados) {
          next[id] = velocidade;
        }
        return next;
      });
    };

    void carregarVelocidadeVendas();

    return () => {
      cancelado = true;
    };
  }, [empresa, produtoAnalise, produtosErp, produtosPaginados, velocidadeVendas]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "todo":
        return <Badge className="bg-zinc-100 text-zinc-800">Pendente</Badge>;
      case "produto_bom":
        return <Badge className="bg-slate-100 text-slate-800">Pode ter no Galpao</Badge>;
      case "produto_ruim":
        return <Badge className="bg-rose-100 text-rose-800">Produtos Ruim</Badge>;
      case "fazer_pedido":
        return <Badge className="bg-amber-100 text-amber-800">Fazer Pedido</Badge>;
      case "pedido_andamento":
        return <Badge className="bg-orange-100 text-orange-800">Pedido Feito</Badge>;
      case "compra_realizada":
        return <Badge className="bg-red-100 text-red-800">Compra Realizada</Badge>;
      case "concluido":
        return <Badge className="bg-green-100 text-green-800">Concluido</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filtrosAtivos = Boolean(searchTerm || filtroStatus !== "todos" || filtroSecao !== "todos" || ordenarMaisPedidos || ordenarMaisVendidos);
  const carregandoFiltroSecao = filtroSecao !== "todos" && produtosPorBuscaStatus.some((produto) => !produto.secao && !(produto.id in produtosErp));
  const carregandoFiltroSecaoAnalise = analiseAberta && filtroSecaoAnalise !== "todos" && produtosPendentesAnalise.some((produto) => !produto.secao && !(produto.id in produtosErp));

  const executarAnalise = async (
    acao: "DISLIKE" | "LIKE" | "FAZER_PEDIDO",
    action: () => Promise<void>,
    sucesso: string
  ) => {
    if (!produtoAnalise) return;
    setEscolhaDireita(false);
    setDragX(0);
    await executarAcao(`${produtoAnalise.id}:${acao}`, action, sucesso);
  };

  const iniciarDrag = (clientX: number) => {
    if (!produtoAnalise || !!acaoEmAndamento) return;
    dragStartRef.current = clientX;
    setEscolhaDireita(false);
  };

  const moverDrag = (clientX: number) => {
    if (dragStartRef.current === null) return;
    const delta = Math.max(-150, Math.min(150, clientX - dragStartRef.current));
    setDragX(delta);
  };

  const finalizarDrag = () => {
    if (!produtoAnalise || dragStartRef.current === null) return;
    dragStartRef.current = null;

    if (dragX <= -90) {
      void executarAnalise("DISLIKE", () => dislike(produtoAnalise.id), "Produto marcado como ruim");
      return;
    }

    if (dragX >= 90) {
      setEscolhaDireita(true);
      setDragX(96);
      return;
    }

    setDragX(0);
  };

  // Dispara uma acao a partir do modal de detalhes e fecha o modal ao terminar.
  const acaoDetalhe = (actionKey: string, action: () => Promise<void>, sucesso: string) => {
    void executarAcao(actionKey, action, sucesso).finally(() => setProdutoDetalhe(null));
  };

  // Botoes de acao do item (usados no modal de detalhes), conforme o status atual.
  const renderAcoesProduto = (produto: ProdutoComprar) => {
    const isActionLoading = (acao: string) => acaoEmAndamento === `${produto.id}:${acao}`;

    switch (produto.status) {
      case "todo":
        return (
          <>
            <Button className="w-full justify-center" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:LIKE`, () => like(produto.id), "Produto marcado como bom")}>
              {isActionLoading("LIKE") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
              Galpao / CD
            </Button>
            <Button className="w-full justify-center text-red-600" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:DISLIKE`, () => dislike(produto.id), "Produto marcado como ruim")}>
              {isActionLoading("DISLIKE") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsDown className="h-4 w-4 mr-2" />}
              Ruim
            </Button>
          </>
        );
      case "produto_bom":
        return (
          <>
            <Button className="w-full justify-center" disabled={!!acaoEmAndamento} onClick={async () => {
              if (!(await confirmarFazerPedido(produto.id))) return;
              acaoDetalhe(`${produto.id}:FAZER_PEDIDO`, () => fazerPedido(produto.id), "Produto movido para fazer pedido");
            }}>
              {isActionLoading("FAZER_PEDIDO") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
              Fazer Pedido
            </Button>
            <Button className="w-full justify-center text-red-600" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:DISLIKE`, () => dislike(produto.id), "Produto marcado como ruim")}>
              {isActionLoading("DISLIKE") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsDown className="h-4 w-4 mr-2" />}
              Ruim
            </Button>
          </>
        );
      case "produto_ruim":
        return (
          <Button className="w-full justify-center text-emerald-700" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:LIKE`, () => like(produto.id), "Produto marcado como bom")}>
            {isActionLoading("LIKE") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
            Galpao / CD
          </Button>
        );
      case "fazer_pedido":
        return (
          <>
            <Button className="w-full justify-center" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:COMPRA_REALIZADA`, () => compraRealizada(produto.id), "Compra realizada")}>
              {isActionLoading("COMPRA_REALIZADA") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Compra Realizada
            </Button>
            <Button className="w-full justify-center text-red-600" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:DISLIKE`, () => dislike(produto.id), "Produto movido para ruim")}>
              {isActionLoading("DISLIKE") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsDown className="h-4 w-4 mr-2" />}
              Mover para Ruim
            </Button>
          </>
        );
      case "pedido_andamento":
        return (
          <>
            <Button className="w-full justify-center" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:COMPRA_REALIZADA`, () => compraRealizada(produto.id), "Compra realizada")}>
              {isActionLoading("COMPRA_REALIZADA") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Compra Realizada
            </Button>
            <Button className="w-full justify-center text-indigo-700 border-indigo-200" variant="outline" disabled={baixandoPdfPedido === produto.id} onClick={() => baixarOuReBaixarPdfPedido(produto)}>
              {baixandoPdfPedido === produto.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Baixar PDF
            </Button>
            {!produto.pedidoFeito && (
              <Button className="w-full justify-center" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:FAZER_PEDIDO`, () => fazerPedido(produto.id), "Produto voltou para fazer pedido")}>
                {isActionLoading("FAZER_PEDIDO") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
                Voltar Pedido
              </Button>
            )}
          </>
        );
      case "compra_realizada":
        return (
          <>
            <Button className="w-full justify-center" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:CONCLUIR`, () => concluir(produto.id), "Produto concluido")}>
              {isActionLoading("CONCLUIR") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Concluir
            </Button>
            <Button className="w-full justify-center" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:PEDIDO_ANDAMENTO`, () => pedidoAndamento(produto.id), "Produto voltou para pedido feito")}>
              {isActionLoading("PEDIDO_ANDAMENTO") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Voltar Pedido Feito
            </Button>
          </>
        );
      case "concluido":
        return (
          <Button className="w-full justify-center" variant="outline" disabled={!!acaoEmAndamento} onClick={() => acaoDetalhe(`${produto.id}:COMPRA_REALIZADA`, () => compraRealizada(produto.id), "Produto reaberto")}>
            {isActionLoading("COMPRA_REALIZADA") ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reabrir
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="mb-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Gestao de Compras</h1>
            <p className="text-gray-600 mt-1">Itens de Compras ({empresa})</p>
            {ultimaAtualizacao && (
              <p className="text-xs text-gray-500 mt-1">
                Ultima atualizacao: {ultimaAtualizacao.toLocaleString("pt-BR")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => {
                setFiltroSecaoAnalise(filtroSecao);
                setAnaliseAberta(true);
              }}
              disabled={loading || produtosPendentesAnalise.length === 0}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Iniciar Analise
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-200">
              ERP em segundo plano
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold">{produtos.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Pendente</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-blue-600">
                {produtos.filter((p) => p.status === "todo").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Galpao</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-emerald-600">
                {produtos.filter((p) => p.status === "produto_bom").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Ruim</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-rose-600">
                {produtos.filter((p) => p.status === "produto_ruim").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Fazer Pedido</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-amber-600">
                {produtos.filter((p) => p.status === "fazer_pedido").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Pedido Feito</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-orange-600">
                {produtos.filter((p) => p.status === "pedido_andamento").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Realizada</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-red-600">
                {produtos.filter((p) => p.status === "compra_realizada").length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="px-3 pt-3 pb-1">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">Concluido</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-2xl font-bold text-green-600">
                {produtos.filter((p) => p.status === "concluido").length}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_auto] gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Buscar por codigo, descricao ou SKU..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <select
                value={filtroSecao}
                onChange={(e) => setFiltroSecao(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {temSecoesCompras && (
                  <option value={FILTRO_MINHAS_SECOES}>
                    Minhas secoes ({secoesCompras.length})
                  </option>
                )}
                <option value="todos">Todas as secoes</option>
                {secoesDisponiveis.map((secao) => (
                  <option key={secao} value={secao}>
                    {secao}
                  </option>
                ))}
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as StatusFiltro)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {STATUS_FILTROS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>

              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setFiltroSecao(temSecoesCompras ? FILTRO_MINHAS_SECOES : "todos");
                  setFiltroStatus("todos");
                  setOrdenarMaisPedidos(false);
                  setOrdenarMaisVendidos(false);
                }}
                disabled={!filtrosAtivos}
              >
                <Filter className="h-4 w-4 mr-2" />
                Limpar
              </Button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={ordenarMaisPedidos ? "default" : "outline"}
                  onClick={() => { setOrdenarMaisPedidos((prev) => !prev); setOrdenarMaisVendidos(false); }}
                  className={ordenarMaisPedidos ? "" : "text-violet-700 border-violet-200"}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Mais Pedidos
                </Button>
                {VELOCIDADE_VENDA_ATIVA && (
                  <Button
                    size="sm"
                    variant={ordenarMaisVendidos ? "default" : "outline"}
                    onClick={() => { setOrdenarMaisVendidos((prev) => !prev); setOrdenarMaisPedidos(false); }}
                    className={ordenarMaisVendidos ? "" : "text-amber-700 border-amber-200"}
                    title="Ordena so os itens desta pagina pela venda dos ultimos 90 dias (carrega conforme abre a pagina)"
                  >
                    📈 Mais Vendidos (90d)
                  </Button>
                )}
              </div>
              <span className="text-xs text-gray-500">
                Filtro: {filteredProdutos.length} de {produtos.length} produto(s)
              </span>
              {carregandoFiltroSecao && (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Carregando secoes
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Produtos para Compra</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            )}
            {error && (
              <div className="text-center py-12 text-red-600">
                <p>Erro: {error}</p>
              </div>
            )}
            {!loading && !error && filteredProdutos.length === 0 && carregandoFiltroSecao && (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando secoes do ERP
              </div>
            )}
            {!loading && !error && filteredProdutos.length === 0 && !carregandoFiltroSecao && (
              <div className="text-center py-12 text-gray-500">Nenhum produto encontrado</div>
            )}
            {!loading && !error && filteredProdutos.length > 0 && (
              <div className="space-y-4">
                {itensSelecionadosPedido.size > 0 && (
                  <div className="flex items-center justify-between gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex-wrap">
                    <span className="text-sm font-medium text-indigo-900">
                      {itensSelecionadosPedido.size} item(ns) selecionado(s)
                    </span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setItensSelecionadosPedido(new Set())} disabled={gerandoPedidos}>
                        Limpar selecao
                      </Button>
                      <Button size="sm" onClick={gerarPedidosPorFornecedor} disabled={gerandoPedidos}>
                        {gerandoPedidos ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
                        Gerar Pedido(s) em PDF
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    Mostrando {inicio + 1}-{Math.min(fim, produtosOrdenados.length)} de {produtosOrdenados.length}
                  </span>
                  <span>Pagina {paginaAtual} de {totalPaginas}</span>
                </div>

                {produtosPaginadosExibidos.map((produto) => {
                  const produtoErp = produtosErp[produto.id];
                  const descricao = getDescricaoExibicao(produto, produtoErp);
                  const descricaoCurta = truncarDescricao(descricao);
                  const precoVenda = formatarPreco(produtoErp?.precoVarejo);
                  const secaoFormatada = formatarSecao(produto.secao ?? produtoErp?.secao);
                  const fotoSelecionada = selecionarFotoProduto(produto, produtoErp, fotosClickUp, imagemComErro);
                  const foto = fotoSelecionada?.src ?? null;
                  const podeMostrarImagem = Boolean(fotoSelecionada);

                  return (
                    <div key={produto.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {produto.status === "fazer_pedido" && (
                          <input
                            type="checkbox"
                            className="shrink-0 h-5 w-5"
                            checked={itensSelecionadosPedido.has(produto.id)}
                            onChange={() => toggleSelecaoPedido(produto.id)}
                            aria-label={`Selecionar ${produto.codigo} para gerar pedido`}
                          />
                        )}
                        {podeMostrarImagem ? (
                          <img
                            src={foto as string}
                            alt={descricaoCurta}
                            className="w-14 h-14 object-cover rounded shrink-0"
                            onError={() => {
                              if (!fotoSelecionada) return;
                              setImagemComErro((prev) => ({
                                ...prev,
                                [getImagemErroKey(produto.id, fotoSelecionada.fonte, fotoSelecionada.src)]: true,
                              }));
                            }}
                          />
                        ) : (
                          <div className="w-14 h-14 bg-gray-200 rounded flex items-center justify-center shrink-0">
                            <span className="text-gray-400 text-xs">sem foto</span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-sm sm:text-base text-gray-900 truncate">{descricaoCurta}</div>
                          <div className="text-xs text-gray-500 font-mono truncate mt-0.5">{produto.codigo}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                              {produto.vezesPedido}x
                            </span>
                            {getStatusBadge(produto.status)}
                          </div>
                          {secaoFormatada && <div className="text-xs text-indigo-600 mt-0.5">{secaoFormatada}</div>}
                          {precoVenda && <div className="text-xs font-semibold text-emerald-700">{precoVenda}</div>}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setProdutoDetalhe(produto)}
                        aria-label={`Ver detalhes e acoes de ${descricaoCurta}`}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </Button>
                    </div>
                  );
                })}

                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                    disabled={paginaAtual === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                    disabled={paginaAtual === totalPaginas}
                  >
                    Proxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-gray-500 text-sm mt-8">
          <p>{"Fluxo Compras: PENDENTE -> PRODUTOS RUIM | PODE SER QUE TEM NO GALPAO -> FAZER PEDIDO -> PEDIDO EM ANDAMENTO -> COMPRA REALIZADA -> CONCLUIDO"}</p>
        </div>
      </div>

      {analiseAberta && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl max-h-[calc(100vh-2rem)] bg-white rounded-xl shadow-2xl p-4 relative overflow-y-auto">
            <button
              type="button"
              className="absolute right-3 top-3 h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center"
              onClick={() => {
                setAnaliseAberta(false);
                setEscolhaDireita(false);
                setDragX(0);
              }}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="pr-10 mb-4">
              <h2 className="text-xl font-bold text-gray-900">Analise de Compras</h2>
              <p className="text-sm text-gray-500">{produtosAnalise.length} de {produtosPendentesAnalise.length} item(ns) pendente(s)</p>
            </div>

            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Secao</label>
              <select
                value={filtroSecaoAnalise}
                onChange={(e) => {
                  setFiltroSecaoAnalise(e.target.value);
                  setEscolhaDireita(false);
                  setDragX(0);
                }}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                {temSecoesCompras && (
                  <option value={FILTRO_MINHAS_SECOES}>
                    Minhas secoes ({secoesCompras.length})
                  </option>
                )}
                <option value="todos">Todas as secoes</option>
                {secoesDisponiveis.map((secao) => (
                  <option key={secao} value={secao}>
                    {secao}
                  </option>
                ))}
              </select>
              {carregandoFiltroSecaoAnalise && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Carregando secoes dos pendentes
                </div>
              )}
            </div>

            {!produtoAnalise && carregandoFiltroSecaoAnalise ? (
              <div className="py-16 flex items-center justify-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Carregando itens
              </div>
            ) : !produtoAnalise ? (
              <div className="py-16 text-center text-gray-500">Nenhum item pendente</div>
            ) : (
              <>
                <div className="relative h-[560px] sm:h-[620px]">
                  <div className="absolute inset-y-10 left-0 w-1/2 rounded-xl bg-red-50 flex items-center justify-start pl-5 text-red-600 font-bold opacity-80">
                    Produto Ruim
                  </div>
                  <div className="absolute inset-y-10 right-0 w-1/2 rounded-xl bg-emerald-50 flex items-center justify-end pr-5 text-emerald-700 font-bold opacity-80">
                    Galpao / Pedido
                  </div>

                  <div
                    className="absolute inset-x-0 top-0 mx-auto w-full rounded-xl bg-white border border-gray-200 shadow-xl overflow-hidden select-none"
                    style={{
                      transform: `translateX(${dragX}px) rotate(${dragX / 18}deg)`,
                      transition: dragStartRef.current === null ? "transform 0.18s ease" : "none",
                    }}
                    onMouseDown={(event) => iniciarDrag(event.clientX)}
                    onMouseMove={(event) => moverDrag(event.clientX)}
                    onMouseUp={finalizarDrag}
                    onMouseLeave={finalizarDrag}
                    onTouchStart={(event) => iniciarDrag(event.touches[0]?.clientX ?? 0)}
                    onTouchMove={(event) => moverDrag(event.touches[0]?.clientX ?? 0)}
                    onTouchEnd={finalizarDrag}
                  >
                    {podeMostrarFotoAnalise ? (
                      <img
                        src={fotoAnalise as string}
                        alt={produtoAnalise.codigo}
                        className="h-[390px] sm:h-[460px] w-full object-contain bg-gray-100"
                        onError={() => {
                          if (!fotoAnaliseSelecionada) return;
                          setImagemComErro((prev) => ({
                            ...prev,
                            [getImagemErroKey(produtoAnalise.id, fotoAnaliseSelecionada.fonte, fotoAnaliseSelecionada.src)]: true,
                          }));
                        }}
                      />
                    ) : (
                      <div className="h-[390px] sm:h-[460px] w-full bg-gray-100 flex items-center justify-center text-gray-400">
                        sem foto
                      </div>
                    )}

                    <div className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-bold text-gray-900">{produtoAnalise.codigo}</div>
                        <span className="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                          {produtoAnalise.vezesPedido}x
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 mt-1">{descricaoAnalise}</div>
                      {produtoAnaliseErp?.secao && (
                        <div className="text-xs text-indigo-600 mt-2">Secao: {produtoAnaliseErp.secao}</div>
                      )}
                      {precoVendaAnalise && (
                        <div className="text-sm font-semibold text-emerald-700 mt-1">{precoVendaAnalise}</div>
                      )}
                      {velocidadeVendaAnalise && (
                        <div className="text-sm font-semibold text-amber-700 mt-1">📈 {velocidadeVendaAnalise}</div>
                      )}
                      <div className="mt-3">{getStatusBadge(produtoAnalise.status)}</div>
                    </div>
                  </div>
                </div>

                {escolhaDireita ? (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <Button
                      variant="outline"
                      disabled={!!acaoEmAndamento}
                      onClick={() => executarAnalise("LIKE", () => like(produtoAnalise.id), "Produto enviado para Galpao")}
                    >
                      <ThumbsUp className="h-4 w-4 mr-2" />
                      Galpao
                    </Button>
                    <Button
                      disabled={!!acaoEmAndamento}
                      onClick={async () => {
                        if (!(await confirmarFazerPedido(produtoAnalise.id))) return;
                        executarAnalise("FAZER_PEDIDO", () => fazerPedido(produtoAnalise.id), "Produto enviado para Fazer Pedido");
                      }}
                    >
                      <ShoppingCart className="h-4 w-4 mr-2" />
                      Fazer Pedido
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <Button
                      variant="outline"
                      className="text-red-600 border-red-200"
                      disabled={!!acaoEmAndamento}
                      onClick={() => executarAnalise("DISLIKE", () => dislike(produtoAnalise.id), "Produto marcado como ruim")}
                    >
                      <ThumbsDown className="h-4 w-4 mr-2" />
                      Ruim
                    </Button>
                    <Button
                      disabled={!!acaoEmAndamento}
                      onClick={() => {
                        setEscolhaDireita(true);
                        setDragX(96);
                      }}
                    >
                      <ThumbsUp className="h-4 w-4 mr-2" />
                      Direita
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {produtoDetalhe && (() => {
        const produtoErp = produtosErp[produtoDetalhe.id];
        const descricao = getDescricaoExibicao(produtoDetalhe, produtoErp);
        const precoVenda = formatarPreco(produtoErp?.precoVarejo);
        const secaoFormatada = formatarSecao(produtoDetalhe.secao ?? produtoErp?.secao);
        const velocidadeVenda = formatarVelocidadeVenda(velocidadeVendas[produtoDetalhe.id]);
        const fotoSelecionada = selecionarFotoProduto(produtoDetalhe, produtoErp, fotosClickUp, imagemComErro);
        const foto = fotoSelecionada?.src ?? null;

        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setProdutoDetalhe(null)}>
            <div
              className="w-full sm:max-w-md max-h-[92vh] bg-white rounded-t-2xl sm:rounded-xl shadow-2xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 p-4 border-b">
                <h2 className="text-base font-bold text-gray-900 leading-tight">{descricao}</h2>
                <button
                  type="button"
                  className="shrink-0 h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center"
                  onClick={() => setProdutoDetalhe(null)}
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {foto ? (
                  <img src={foto} alt={descricao} className="w-full max-h-64 object-contain bg-gray-100 rounded-lg" />
                ) : (
                  <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">sem foto</div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-violet-100 text-violet-800">
                    Pedido {produtoDetalhe.vezesPedido}x
                  </span>
                  {getStatusBadge(produtoDetalhe.status)}
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Barcode className="h-4 w-4 text-gray-500 shrink-0" />
                  <span className="font-mono">{produtoDetalhe.codigo}</span>
                </div>
                {produtoDetalhe.sku && (
                  <div className="text-xs text-gray-500">SKU: {produtoDetalhe.sku}</div>
                )}
                {secaoFormatada && (
                  <div className="text-sm text-indigo-600">Secao: {secaoFormatada}</div>
                )}
                {precoVenda && (
                  <div className="text-sm font-semibold text-emerald-700">{precoVenda}</div>
                )}
                {velocidadeVenda && (
                  <div className="text-sm font-semibold text-amber-700">📈 {velocidadeVenda}</div>
                )}

                <div className="flex flex-col gap-2 pt-2">
                  {renderAcoesProduto(produtoDetalhe)}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Compras;
