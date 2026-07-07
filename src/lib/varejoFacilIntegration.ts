export type VarejoFacilEmpresa = "NEWSHOP" | "FACIL" | "SOYE";
export type VarejoFacilFlag = "loja" | "cd";

export interface VarejoFacilLookupContext {
  empresa?: string | null;
  flag?: VarejoFacilFlag | string | null;
}

export interface VarejoFacilProduct {
  id: string;
  codigo_barras: string;
  descricao: string;
  preco: number;
  precoVarejo: number;
  precoAtacado: number;
  estoque: number;
  secao?: string;
  imagem?: string;
  hasErpImage?: boolean;
}

export interface ConsultaPrecoVarejoFacilProduto {
  id: string;
  codigo_barras: string;
  descricao: string;
  precoVarejo: number;
  precoAtacado: number;
  secao?: string;
  grupo?: string;
}

type ErpProduto = {
  id: number;
  descricao?: string;
  codigoInterno?: string;
  unidadeDeVenda?: string;
  secaoId?: number;
  grupoId?: number;
  imagem?: string;
  imagemUrl?: string;
  urlImagem?: string;
  foto?: string;
  fotoUrl?: string;
  meta?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  metadados?: Record<string, unknown>;
  imagens?: Array<string | { url?: string; imagem?: string; src?: string }>;
};

type ErpPreco = {
  lojaId?: number;
  precoVenda1?: number;
  precoOferta1?: number;
  precoVenda2?: number;
  precoOferta2?: number;
};

type ErpCodigoAuxiliar = {
  id?: string;
  produtoId?: number;
  tipo?: string;
};

type ErpResumoEstoque = {
  lojaId?: number;
  saldo?: number;
};

type ErpSecao = {
  id?: number;
  descricao?: string;
};

type ErpGrupo = {
  id?: number;
  descricao?: string;
};

type ErpListResponse<T> = {
  items?: T[];
};

const VAREJO_FACIL_HOSTS: Record<VarejoFacilEmpresa, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

const ERP_LOJA_BY_EMPRESA: Record<VarejoFacilEmpresa, number> = {
  FACIL: 1,
  NEWSHOP: 2,
  SOYE: 1,
};

// Cache em memória + localStorage (TTL 24h) para evitar re-consultar seção/grupo a cada reload
const MERCADOLOGICO_LS_KEY = "vf_mercadologico_v1";
const MERCADOLOGICO_TTL_MS = 24 * 60 * 60 * 1000;

function _lsLoadMercadologico(): Record<string, { v: string; ts: number }> {
  try {
    const raw = localStorage.getItem(MERCADOLOGICO_LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { v: string; ts: number }>) : {};
  } catch {
    return {};
  }
}

let _lsStore = _lsLoadMercadologico();

function _lsGet(key: string): string | null {
  const entry = _lsStore[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > MERCADOLOGICO_TTL_MS) {
    delete _lsStore[key];
    return null;
  }
  return entry.v;
}

function _lsSet(key: string, value: string) {
  _lsStore[key] = { v: value, ts: Date.now() };
  try { localStorage.setItem(MERCADOLOGICO_LS_KEY, JSON.stringify(_lsStore)); } catch { /* storage cheio */ }
}

const secaoCache = new Map<string, string>();
const grupoCache = new Map<string, string>();
const produtoLookupInFlight = new Map<string, Promise<VarejoFacilProduct | null>>();
const PRODUTO_LOOKUP_LS_KEY = "vf_produto_lookup_v1";
const PRODUTO_LOOKUP_TTL_MS = 60 * 60 * 1000;

type ProdutoLookupCacheEntry = {
  ts: number;
  value: VarejoFacilProduct | null;
};

function loadProdutoLookupCache(): Record<string, ProdutoLookupCacheEntry> {
  try {
    const raw = localStorage.getItem(PRODUTO_LOOKUP_LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ProdutoLookupCacheEntry>) : {};
  } catch {
    return {};
  }
}

let produtoLookupStore = loadProdutoLookupCache();

function getProdutoLookupKey(codigo: string, contexto: VarejoFacilLookupContext = {}): string {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  return `${empresa}:${codigo.trim()}`;
}

function getProdutoLookupCached(key: string): VarejoFacilProduct | null | undefined {
  const entry = produtoLookupStore[key];
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PRODUTO_LOOKUP_TTL_MS) {
    delete produtoLookupStore[key];
    return undefined;
  }
  return entry.value;
}

function setProdutoLookupCached(key: string, value: VarejoFacilProduct | null) {
  produtoLookupStore[key] = { ts: Date.now(), value };
  try { localStorage.setItem(PRODUTO_LOOKUP_LS_KEY, JSON.stringify(produtoLookupStore)); } catch { /* cache opcional */ }
}

const normalizarEmpresaVarejoFacil = (empresa?: string | null): VarejoFacilEmpresa => {
  const normalizada = (empresa ?? "").toUpperCase();

  // SOYE e FACIL usam a mesma base ERP.
  if (normalizada.includes("SOYE")) return "FACIL";
  if (normalizada.includes("FACIL")) return "FACIL";
  return "NEWSHOP";
};

// Base das Edge Functions do Supabase (erp-proxy/erp-image-proxy substituem as antigas
// rotas /api/erp-proxy e /api/erp-image-proxy da Vercel — mesma URL/projeto do
// VITE_SUPABASE_URL, so trocando o path).
const getSupabaseFunctionsBase = (): string => {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
  return supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1` : "";
};

const fetchJson = async <T>(path: string, contexto: VarejoFacilLookupContext = {}) => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  const url = `${getSupabaseFunctionsBase()}/erp-proxy?empresa=${empresa.toLowerCase()}&path=${encodeURIComponent(path)}`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ao consultar ERP (${response.status})${body ? `: ${body}` : ""}`);
  }

  return (await response.json()) as T;
};

const normalizarPreco = (precoVenda?: number, precoOferta?: number) => {
  if (typeof precoOferta === "number" && precoOferta > 0) return precoOferta;
  return precoVenda || 0;
};

const normalizarEans = (codigo: string) => {
  const limpo = codigo.replace(/\s+/g, "");
  const candidatos = [limpo];

  if (/^\d+$/.test(limpo) && limpo.length < 14) {
    candidatos.push(limpo.padStart(14, "0"));
  }
  if (/^\d{13}$/.test(limpo)) candidatos.push(`0${limpo}`);
  if (/^0+\d+$/.test(limpo)) candidatos.push(limpo.replace(/^0+/, ""));

  return [...new Set(candidatos.filter(Boolean))];
};

const getErpLojaAtiva = (contexto: VarejoFacilLookupContext = {}) => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  return ERP_LOJA_BY_EMPRESA[empresa] || 1;
};

const getMercadologicoCacheKey = (
  contexto: VarejoFacilLookupContext,
  ...ids: Array<number | undefined>
) => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  return [empresa, ...ids.map((id) => String(id ?? ""))].join(":");
};

const buscarCodigoAuxiliarPorEan = async (ean: string, contexto: VarejoFacilLookupContext = {}) => {
  for (const candidato of normalizarEans(ean)) {
    try {
      const fiql = encodeURIComponent(`id==${candidato}`);
      const data = await fetchJson<ErpListResponse<ErpCodigoAuxiliar>>(`/v1/produto/codigos-auxiliares?q=${fiql}&count=5`, contexto);
      const codigoAuxiliar = (data?.items || []).find((item) => item?.produtoId && item?.tipo === "EAN") || (data?.items || [])[0];

      if (codigoAuxiliar?.produtoId) {
        console.info("[VarejoFacil][EAN] Codigo auxiliar encontrado", {
          eanOriginal: ean,
          eanConsultado: candidato,
          produtoId: codigoAuxiliar.produtoId,
        });
        return {
          codigoAuxiliar,
          eanEncontrado: codigoAuxiliar.id || candidato,
        };
      }
    } catch (err) {
      console.warn("[VarejoFacil][EAN] Falha ao consultar candidato", {
        eanOriginal: ean,
        eanConsultado: candidato,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
};

const buscarEstoquePorProduto = async (produtoId: number, contexto: VarejoFacilLookupContext = {}) => {
  const fiql = encodeURIComponent(`produtoId==${produtoId}`);
  const data = await fetchJson<ErpListResponse<ErpResumoEstoque>>(`/v1/estoque/saldos?q=${fiql}&count=100`, contexto);
  const lojaId = getErpLojaAtiva(contexto);
  const itens = data?.items || [];
  const itensDaLoja = itens.filter((item) => item.lojaId === lojaId);
  const base = itensDaLoja.length > 0 ? itensDaLoja : itens;
  return base.reduce((total, item) => total + Number(item?.saldo || 0), 0);
};

const selecionarPrecoDaLoja = (precos: ErpPreco[] | null, contexto: VarejoFacilLookupContext = {}) => {
  if (!precos || precos.length === 0) return null;

  const lojaId = getErpLojaAtiva(contexto);
  return precos.find((preco) => preco.lojaId === lojaId) || precos[0];
};

const buscarSecao = async (secaoId?: number, contexto: VarejoFacilLookupContext = {}) => {
  if (!secaoId) return "";
  const key = getMercadologicoCacheKey(contexto, secaoId);
  if (secaoCache.has(key)) return secaoCache.get(key)!;

  const cached = _lsGet(key);
  if (cached !== null) { secaoCache.set(key, cached); return cached; }

  let descricao = `Secao ${secaoId}`;
  try {
    const data = await fetchJson<ErpSecao>(`/v1/produto/secoes/${secaoId}`, contexto);
    descricao = data?.descricao || descricao;
  } catch {
    // Mantem a consulta de preco funcionando mesmo se o mercadologico falhar.
  }

  secaoCache.set(key, descricao);
  _lsSet(key, descricao);
  return descricao;
};

const buscarGrupo = async (secaoId?: number, grupoId?: number, contexto: VarejoFacilLookupContext = {}) => {
  if (!secaoId || !grupoId) return "";

  const key = getMercadologicoCacheKey(contexto, secaoId, grupoId);
  if (grupoCache.has(key)) return grupoCache.get(key)!;

  const cached = _lsGet(key);
  if (cached !== null) { grupoCache.set(key, cached); return cached; }

  let descricao = `Grupo ${grupoId}`;
  try {
    const data = await fetchJson<ErpGrupo>(`/v1/produto/secoes/${secaoId}/grupos/${grupoId}`, contexto);
    descricao = data?.descricao || descricao;
  } catch {
    // Mantem a consulta de preco funcionando mesmo se o mercadologico falhar.
  }

  grupoCache.set(key, descricao);
  _lsSet(key, descricao);
  return descricao;
};

const extrairImagemProduto = (produto: ErpProduto): string | undefined => {
  const imagemDaLista = produto.imagens?.find(Boolean);

  if (typeof imagemDaLista === "string") return imagemDaLista;
  if (imagemDaLista?.url) return imagemDaLista.url;
  if (imagemDaLista?.imagem) return imagemDaLista.imagem;
  if (imagemDaLista?.src) return imagemDaLista.src;

  const metas = [produto.meta, produto.metadata, produto.metadados].filter(Boolean) as Record<string, unknown>[];
  const imagemMeta = metas
    .flatMap((meta) => [
      meta.imagem,
      meta.imagemUrl,
      meta.urlImagem,
      meta.foto,
      meta.fotoUrl,
      meta.image,
      meta.imageUrl,
      meta.url,
    ])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  return produto.imagem || produto.imagemUrl || produto.urlImagem || produto.foto || produto.fotoUrl || imagemMeta || undefined;
};

const resolverImagemProduto = (imagem: string | undefined, produtoId: number, contexto: VarejoFacilLookupContext = {}) => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  const imagemOuProduto = imagem || String(produtoId);

  if (/^data:image\//i.test(imagemOuProduto)) return imagemOuProduto;

  return `${getSupabaseFunctionsBase()}/erp-image-proxy?empresa=${empresa.toLowerCase()}&produtoId=${produtoId}&src=${encodeURIComponent(imagemOuProduto)}`;
};

const isReferenciaImagemErpValida = (imagem: string | undefined): boolean =>
  Boolean(imagem && !/^data:image\//i.test(imagem));

const buscarProdutoPorCodigoBarras = async (
  codigo: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<{ produto: ErpProduto; ean: string } | null> => {
  for (const candidato of normalizarEans(codigo)) {
    try {
      const data = await fetchJson<ErpProduto>(
        `/v1/produto/codigos-auxiliares/${encodeURIComponent(candidato)}`,
        contexto
      );
      const produtoId = (data as any)?.produtoId;
      if (produtoId) {
        const prod = await fetchJson<ErpProduto>(`/v1/produto/produtos/${produtoId}`, contexto);
        if (prod?.id) return { produto: prod, ean: candidato };
      }
    } catch { /* continua */ }
  }
  return null;
};

const buscarProdutoVarejoFacilSemCache = async (
  codigoBarras: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<VarejoFacilProduct | null> => {
  const codigo = codigoBarras.trim();
  if (!codigo) return null;

  const codigoAuxiliarEncontrado = await buscarCodigoAuxiliarPorEan(codigo, contexto);
  let produto: ErpProduto | null = null;
  let eanResolvido = codigo;

  if (codigoAuxiliarEncontrado?.codigoAuxiliar.produtoId) {
    produto = await fetchJson<ErpProduto>(`/v1/produto/produtos/${codigoAuxiliarEncontrado.codigoAuxiliar.produtoId}`, contexto);
    eanResolvido = codigoAuxiliarEncontrado.eanEncontrado;
  }

  if (!produto) {
    const direto = await buscarProdutoPorCodigoBarras(codigo, contexto);
    if (direto) {
      produto = direto.produto;
      eanResolvido = direto.ean;
    }
  }

  if (!produto) {
    produto = await fetchJson<ErpProduto>(`/v1/produto/produtos/consulta/${encodeURIComponent(codigo)}`, contexto);
  }

  if (!produto?.id) return null;

  const [precosResult, estoqueResult, secaoResult] = await Promise.allSettled([
    fetchJson<ErpPreco[]>(`/v1/produto/produtos/${produto.id}/precos`, contexto),
    buscarEstoquePorProduto(produto.id, contexto),
    buscarSecao(produto.secaoId, contexto),
  ]);
  const precos = precosResult.status === "fulfilled" ? precosResult.value : null;
  const estoque = estoqueResult.status === "fulfilled" ? estoqueResult.value : 0;
  const secao = secaoResult.status === "fulfilled" ? secaoResult.value : "";

  if (precosResult.status === "rejected") {
    console.warn("[VarejoFacil][Produto] Preco nao carregado", {
      codigo,
      produtoId: produto.id,
      erro: precosResult.reason instanceof Error ? precosResult.reason.message : String(precosResult.reason),
    });
  }
  if (estoqueResult.status === "rejected") {
    console.warn("[VarejoFacil][Produto] Estoque nao carregado", {
      codigo,
      produtoId: produto.id,
      erro: estoqueResult.reason instanceof Error ? estoqueResult.reason.message : String(estoqueResult.reason),
    });
  }
  if (secaoResult.status === "rejected") {
    console.warn("[VarejoFacil][Produto] Secao nao carregada", {
      codigo,
      produtoId: produto.id,
      erro: secaoResult.reason instanceof Error ? secaoResult.reason.message : String(secaoResult.reason),
    });
  }

  const precoSelecionado = selecionarPrecoDaLoja(precos, contexto);
  const precoVarejo = normalizarPreco(precoSelecionado?.precoVenda1, precoSelecionado?.precoOferta1);
  const precoAtacado = normalizarPreco(precoSelecionado?.precoVenda2, precoSelecionado?.precoOferta2);
  const imagemOriginal = extrairImagemProduto(produto);
  const hasErpImage = isReferenciaImagemErpValida(imagemOriginal);
  const imagem = hasErpImage ? resolverImagemProduto(imagemOriginal, produto.id, contexto) : undefined;

  console.info("[VarejoFacil][Produto] Produto resolvido", {
    codigo,
    eanResolvido,
    produtoId: produto.id,
    descricao: produto.descricao || produto.codigoInterno || "",
    imagem,
  });

  return {
    id: String(produto.id),
    codigo_barras: eanResolvido,
    descricao: produto.descricao || produto.codigoInterno || "",
    preco: precoVarejo,
    precoVarejo,
    precoAtacado,
    estoque,
    secao: secao || undefined,
    imagem,
    hasErpImage,
  };
};

export const buscarProdutoVarejoFacil = async (
  codigoBarras: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<VarejoFacilProduct | null> => {
  const codigo = codigoBarras.trim();
  if (!codigo) return null;

  const cacheKey = getProdutoLookupKey(codigo, contexto);
  const cached = getProdutoLookupCached(cacheKey);
  if (cached !== undefined) return cached;

  const pending = produtoLookupInFlight.get(cacheKey);
  if (pending) return pending;

  const lookup = buscarProdutoVarejoFacilSemCache(codigo, contexto)
    .then((produto) => {
      setProdutoLookupCached(cacheKey, produto);
      return produto;
    })
    .catch((err) => {
      setProdutoLookupCached(cacheKey, null);
      throw err;
    })
    .finally(() => {
      produtoLookupInFlight.delete(cacheKey);
    });

  produtoLookupInFlight.set(cacheKey, lookup);
  return lookup;
};

export const consultarPrecoProdutoVarejoFacil = async (
  codigoBarras: string,
  contexto: VarejoFacilLookupContext = {},
  incluirMercadologico = false
): Promise<ConsultaPrecoVarejoFacilProduto | null> => {
  const codigo = codigoBarras.trim();
  if (!codigo) return null;

  const codigoAuxiliarEncontrado = await buscarCodigoAuxiliarPorEan(codigo, contexto);
  let produto: ErpProduto | null = null;
  let eanResolvido = codigo;

  if (codigoAuxiliarEncontrado?.codigoAuxiliar.produtoId) {
    produto = await fetchJson<ErpProduto>(`/v1/produto/produtos/${codigoAuxiliarEncontrado.codigoAuxiliar.produtoId}`, contexto);
    eanResolvido = codigoAuxiliarEncontrado.eanEncontrado;
  }

  if (!produto) {
    const direto = await buscarProdutoPorCodigoBarras(codigo, contexto);
    if (direto) {
      produto = direto.produto;
      eanResolvido = direto.ean;
    }
  }

  if (!produto) {
    produto = await fetchJson<ErpProduto>(`/v1/produto/produtos/consulta/${encodeURIComponent(codigo)}`, contexto);
  }

  if (!produto?.id) return null;

  const [precos, secao, grupo] = await Promise.all([
    fetchJson<ErpPreco[]>(`/v1/produto/produtos/${produto.id}/precos`, contexto),
    incluirMercadologico ? buscarSecao(produto.secaoId, contexto) : Promise.resolve(""),
    incluirMercadologico ? buscarGrupo(produto.secaoId, produto.grupoId, contexto) : Promise.resolve(""),
  ]);
  const precoSelecionado = selecionarPrecoDaLoja(precos, contexto);

  return {
    id: String(produto.id),
    codigo_barras: eanResolvido,
    descricao: produto.descricao || produto.codigoInterno || "Produto sem descricao",
    precoVarejo: normalizarPreco(precoSelecionado?.precoVenda1, precoSelecionado?.precoOferta1),
    precoAtacado: normalizarPreco(precoSelecionado?.precoVenda2, precoSelecionado?.precoOferta2),
    secao: secao || undefined,
    grupo: grupo || undefined,
  };
};

export const sincronizarProduto = async (
  codigoBarras: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<VarejoFacilProduct | null> => buscarProdutoVarejoFacil(codigoBarras, contexto);

// ── Velocidade de venda (unidades vendidas/dia) ───────────────────────────────
// Agrega /v1/venda/cupons-fiscais dos ultimos N dias por produtoId. A API nao
// permite filtrar cupons por produto (produtoId fica dentro de itensVenda[]),
// entao a unica forma e paginar os cupons do periodo e somar no cliente.
// Resultado fica em cache por empresa (nao por produto) para nao repetir a
// paginacao inteira a cada item da tela.

export interface VelocidadeVendaProduto {
  unidades: number;
  dias: number;
  mediaPorDia: number;
  cuponsAnalisados: number;
  parcial: boolean; // true se bateu no limite de paginas antes de cobrir todo o periodo
  erro: boolean; // true se a consulta ao ERP falhou (nao confundir "0" com "sem dados")
}

type ErpItemVenda = { produtoId?: number; quantidadeVenda?: number };
type ErpCupomFiscal = { itensVenda?: ErpItemVenda[]; data?: string; dataVenda?: string; identificadorId?: number };

const VELOCIDADE_DIAS = 90;
const VELOCIDADE_PAGE_SIZE = 150;
const VELOCIDADE_MAX_PAGINAS = 30; // limite de 4500 cupons/consulta para nao travar a tela
const VELOCIDADE_CACHE_TTL_MS = 30 * 60 * 1000;
const VELOCIDADE_CACHE_ERRO_TTL_MS = 60 * 1000; // erro nao fica em cache 30min — tenta de novo rapido

type VelocidadeCacheEntry = {
  mapa: Map<string, number>;
  cuponsAnalisados: number;
  parcial: boolean;
  erro: boolean;
  ts: number;
};

const velocidadeCache = new Map<string, VelocidadeCacheEntry>();
const velocidadeEmAndamento = new Map<string, Promise<VelocidadeCacheEntry>>();

function cupomDataKey(cupom: ErpCupomFiscal): string | null {
  const valor = cupom.dataVenda || cupom.data;
  if (!valor) return null;
  // aceita "YYYY-MM-DD" ou ISO completo
  return valor.slice(0, 10);
}

const buscarMapaVelocidadeVendas = async (contexto: VarejoFacilLookupContext = {}): Promise<VelocidadeCacheEntry> => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);

  const cached = velocidadeCache.get(empresa);
  if (cached) {
    const ttl = cached.erro ? VELOCIDADE_CACHE_ERRO_TTL_MS : VELOCIDADE_CACHE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return Promise.resolve(cached);
  }

  const emAndamento = velocidadeEmAndamento.get(empresa);
  if (emAndamento) return emAndamento;

  const promessa = (async () => {
    // Nao confiamos em nenhum nome de campo pra filtrar/ordenar por data: o swagger
    // do ERP tem campos que nao existem de fato na API real (ja vimos "dataVenda"
    // filtrar igual a query invalida retornando 200 vazio, e "identificadorId" dar
    // 422 no sort). Em vez disso pedimos a ordem padrao da API (sem `sort`) e
    // filtramos a data no cliente, sem assumir que vem ordenado por recencia —
    // por isso so paramos por "ultima pagina" ou pelo limite de seguranca, nunca
    // por "pagina toda fora do periodo" (essa heuristica exigiria ordem garantida).
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - VELOCIDADE_DIAS);
    const dataInicioStr = dataInicio.toISOString().slice(0, 10);

    const mapa = new Map<string, number>();
    let cuponsAnalisados = 0;
    let parcial = false;
    let erro = false;

    for (let pagina = 0; pagina < VELOCIDADE_MAX_PAGINAS; pagina++) {
      const start = pagina * VELOCIDADE_PAGE_SIZE;

      let data: ErpListResponse<ErpCupomFiscal> | null = null;
      try {
        data = await fetchJson<ErpListResponse<ErpCupomFiscal>>(
          `/v1/venda/cupons-fiscais?start=${start}&count=${VELOCIDADE_PAGE_SIZE}`,
          contexto
        );
      } catch (err) {
        console.error("[VarejoFacil][Velocidade] Falha ao buscar cupons fiscais — badge vai mostrar erro, nao 0", {
          empresa,
          pagina,
          erro: err instanceof Error ? err.message : String(err),
        });
        erro = true;
        break;
      }

      const cupons = data?.items ?? [];
      if (cupons.length === 0) break;

      cuponsAnalisados += cupons.length;

      for (const cupom of cupons) {
        const dataKey = cupomDataKey(cupom);
        if (dataKey && dataKey < dataInicioStr) continue; // cupom fora do periodo de 90 dias

        for (const item of cupom.itensVenda ?? []) {
          if (!item.produtoId) continue;
          const key = String(item.produtoId);
          mapa.set(key, (mapa.get(key) ?? 0) + Number(item.quantidadeVenda ?? 0));
        }
      }

      if (cupons.length < VELOCIDADE_PAGE_SIZE) break; // ultima pagina que existe
      if (pagina === VELOCIDADE_MAX_PAGINAS - 1) parcial = true;
    }

    const entry: VelocidadeCacheEntry = { mapa, cuponsAnalisados, parcial, erro, ts: Date.now() };
    velocidadeCache.set(empresa, entry);
    return entry;
  })();

  velocidadeEmAndamento.set(empresa, promessa);
  try {
    return await promessa;
  } finally {
    velocidadeEmAndamento.delete(empresa);
  }
};

export const buscarVelocidadeVendaProduto = async (
  produtoId: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<VelocidadeVendaProduto | null> => {
  if (!produtoId) return null;

  const { mapa, cuponsAnalisados, parcial, erro } = await buscarMapaVelocidadeVendas(contexto);
  const unidades = mapa.get(String(produtoId)) ?? 0;

  return {
    unidades,
    dias: VELOCIDADE_DIAS,
    mediaPorDia: unidades / VELOCIDADE_DIAS,
    cuponsAnalisados,
    erro,
    parcial,
  };
};

// ── Pedido de compra ja aberto pra esse produto/fornecedor ───────────────────
// Evita duplicar pedido manual: busca os fornecedores do produto e ve se ja
// existe um Pedido de Compra (ERP) em aberto contendo esse produtoId.

export interface PedidoCompraAberto {
  pedidoId: string;
  fornecedorId: string;
  status: string;
  dataDeEmissao?: string;
  quantidadePedida: number;
}

type ErpFornecedorProduto = { fornecedorId?: number; nivel?: "PRINCIPAL" | "SECUNDARIO" };
type ErpItemPedidoCompra = { produtoId?: number; quantidade?: number; quantidadeCompleta?: number };
type ErpPedidoCompra = {
  id?: number;
  fornecedorId?: number;
  status?: string;
  dataDeEmissao?: string;
  itens?: ErpItemPedidoCompra[];
};

// Status que ainda representam pedido "em aberto" (nao cancelado/encerrado)
const STATUS_PEDIDO_COMPRA_ABERTO = ["ABERTO", "ATENDIDO_PARCIALMENTE", "BLOQUEADO"];

export const buscarPedidosCompraAbertosPorProduto = async (
  produtoId: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<PedidoCompraAberto[]> => {
  if (!produtoId) return [];

  let fornecedorIds: string[] = [];
  try {
    const data = await fetchJson<ErpListResponse<ErpFornecedorProduto>>(
      `/v1/produto/produtos/${produtoId}/fornecedores`,
      contexto
    );
    fornecedorIds = (data?.items ?? [])
      .map((item) => item.fornecedorId)
      .filter((id): id is number => typeof id === "number")
      .map(String);
  } catch (err) {
    console.warn("[VarejoFacil][PedidoAberto] Falha ao buscar fornecedores do produto", {
      produtoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }

  if (fornecedorIds.length === 0) return [];

  const fornecedorFiql = fornecedorIds.map((id) => `fornecedorId==${id}`).join(",");
  const statusFiql = STATUS_PEDIDO_COMPRA_ABERTO.map((status) => `status==${status}`).join(",");
  const fiql = encodeURIComponent(`(${fornecedorFiql});(${statusFiql})`);

  let pedidos: ErpPedidoCompra[] = [];
  try {
    const data = await fetchJson<ErpListResponse<ErpPedidoCompra>>(
      `/v1/compra/pedidos?q=${fiql}&sort=-dataDeEmissao&count=50`,
      contexto
    );
    pedidos = data?.items ?? [];
  } catch (err) {
    console.warn("[VarejoFacil][PedidoAberto] Falha ao buscar pedidos de compra", {
      produtoId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const resultado: PedidoCompraAberto[] = [];
  for (const pedido of pedidos) {
    const itemDoProduto = (pedido.itens ?? []).find((item) => String(item.produtoId) === String(produtoId));
    if (!itemDoProduto || !pedido.id) continue;

    resultado.push({
      pedidoId: String(pedido.id),
      fornecedorId: String(pedido.fornecedorId ?? ""),
      status: pedido.status ?? "",
      dataDeEmissao: pedido.dataDeEmissao,
      quantidadePedida: Number(itemDoProduto.quantidadeCompleta ?? itemDoProduto.quantidade ?? 0),
    });
  }

  return resultado;
};

// ── Fornecedor principal do produto (pra agrupar pedido em PDF por fornecedor) ───

export interface FornecedorProduto {
  fornecedorId: string;
  nome: string;
}

type ErpFornecedor = { id?: number; nome?: string; fantasia?: string };

const fornecedorNomeCache = new Map<string, string>();

const buscarNomeFornecedor = async (
  fornecedorId: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<string> => {
  const empresa = normalizarEmpresaVarejoFacil(contexto.empresa);
  const cacheKey = `${empresa}:${fornecedorId}`;
  const cached = fornecedorNomeCache.get(cacheKey);
  if (cached) return cached;

  try {
    const fornecedor = await fetchJson<ErpFornecedor>(`/v1/pessoa/fornecedores/${fornecedorId}`, contexto);
    const nome = fornecedor?.fantasia || fornecedor?.nome || `Fornecedor ${fornecedorId}`;
    fornecedorNomeCache.set(cacheKey, nome);
    return nome;
  } catch (err) {
    console.warn("[VarejoFacil][Fornecedor] Falha ao buscar nome do fornecedor", {
      fornecedorId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return `Fornecedor ${fornecedorId}`;
  }
};

// Busca o fornecedor PRINCIPAL cadastrado pro produto no ERP (cai pro primeiro
// disponivel se nenhum estiver marcado como principal). Retorna null se o
// produto nao tiver nenhum fornecedor cadastrado.
export const buscarFornecedorPrincipalProduto = async (
  produtoId: string,
  contexto: VarejoFacilLookupContext = {}
): Promise<FornecedorProduto | null> => {
  if (!produtoId) return null;

  let referencias: ErpFornecedorProduto[] = [];
  try {
    const data = await fetchJson<ErpListResponse<ErpFornecedorProduto>>(
      `/v1/produto/produtos/${produtoId}/fornecedores`,
      contexto
    );
    referencias = data?.items ?? [];
  } catch (err) {
    console.warn("[VarejoFacil][Fornecedor] Falha ao buscar fornecedores do produto", {
      produtoId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const principal = referencias.find((ref) => ref.nivel === "PRINCIPAL") ?? referencias[0];
  if (!principal?.fornecedorId) return null;

  const fornecedorId = String(principal.fornecedorId);
  const nome = await buscarNomeFornecedor(fornecedorId, contexto);
  return { fornecedorId, nome };
};
