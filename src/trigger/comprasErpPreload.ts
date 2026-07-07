import { schedules } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

type EmpresaCompras = "NEWSHOP" | "SF";
type ErpEmpresa = "NEWSHOP" | "FACIL";

type CompraRow = {
  id: string;
  empresa: EmpresaCompras;
  produto_key: string;
  codigo: string;
  sku: string | null;
  descricao: string | null;
  secao: string | null;
  foto_url: string | null;
  updated_at: string | null;
  erp_sync_at: string | null;
};

type ErpListResponse<T> = { items?: T[] };
type ErpCodigoAuxiliar = { id?: string; produtoId?: number; tipo?: string };
type ErpProduto = {
  id?: number;
  descricao?: string;
  codigoInterno?: string;
  secaoId?: number;
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
type ErpSecao = { id?: number; descricao?: string };

const HOSTS: Record<ErpEmpresa, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
};

const FOTO_BUCKET = "compras-fotos";
const LOCK_NAME = "compras-erp-preload";
const DEFAULT_MAX_ITEMS_PER_RUN = 20;
const DEFAULT_SCAN_LIMIT_PER_EMPRESA = 250;
const DEFAULT_DELAY_MS = 1500;

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erpEmpresa(empresa: EmpresaCompras): ErpEmpresa {
  return empresa === "NEWSHOP" ? "NEWSHOP" : "FACIL";
}

function getEnv(empresa: ErpEmpresa, key: "URL" | "USERNAME" | "PASSWORD" | "TOKEN"): string {
  return (
    process.env[`ERP_API_${key}_${empresa}`] ||
    process.env[`VITE_ERP_API_${key}_${empresa}`] ||
    process.env[`ERP_API_${key}`] ||
    process.env[`VITE_ERP_API_${key}`] ||
    ""
  );
}

function apiBaseUrl(empresa: ErpEmpresa): string {
  const configured = (getEnv(empresa, "URL") || `https://${HOSTS[empresa]}`).replace(/\/$/, "");
  return configured.endsWith("/api") ? configured : `${configured}/api`;
}

function originFromApi(baseUrl: string): string {
  return baseUrl.replace(/\/api$/, "");
}

function resolveTokenFromAuth(data: Record<string, unknown>): string {
  return (
    (typeof data.accessToken === "string" && data.accessToken) ||
    (typeof data.access_token === "string" && data.access_token) ||
    (typeof data.token === "string" && data.token) ||
    (typeof data.jwt === "string" && data.jwt) ||
    ""
  );
}

const tokenCache = new Map<string, string>();

async function getErpToken(empresa: ErpEmpresa, baseUrl: string): Promise<string> {
  const configuredToken = getEnv(empresa, "TOKEN");
  if (configuredToken) return configuredToken;

  const username = getEnv(empresa, "USERNAME");
  const password = getEnv(empresa, "PASSWORD");
  const cacheKey = `${empresa}:${baseUrl}:${username}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;
  if (!username || !password) throw new Error(`Credenciais ERP nao configuradas para ${empresa}`);

  const response = await fetch(`${baseUrl}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`ERP auth ${response.status} para ${empresa}`);

  const token = resolveTokenFromAuth((await response.json()) as Record<string, unknown>);
  if (!token) throw new Error(`ERP nao retornou token para ${empresa}`);
  tokenCache.set(cacheKey, token);
  return token;
}

async function fetchErpJson<T>(baseUrl: string, token: string, path: string): Promise<T | null> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: token, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ERP ${response.status} em ${path}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as T;
}

function normalizarEans(codigo: string): string[] {
  const limpo = codigo.replace(/\s+/g, "");
  const candidatos = [limpo];
  if (/^\d+$/.test(limpo) && limpo.length < 14) candidatos.push(limpo.padStart(14, "0"));
  if (/^\d{13}$/.test(limpo)) candidatos.push(`0${limpo}`);
  if (/^0+\d+$/.test(limpo)) candidatos.push(limpo.replace(/^0+/, ""));
  return [...new Set(candidatos.filter(Boolean))];
}

async function buscarCodigoAuxiliarPorEan(baseUrl: string, token: string, ean: string) {
  for (const candidato of normalizarEans(ean)) {
    const fiql = encodeURIComponent(`id==${candidato}`);
    const data = await fetchErpJson<ErpListResponse<ErpCodigoAuxiliar>>(
      baseUrl,
      token,
      `/v1/produto/codigos-auxiliares?q=${fiql}&count=5`
    );
    const codigoAuxiliar = (data?.items || []).find((item) => item?.produtoId && item?.tipo === "EAN") || (data?.items || [])[0];
    if (codigoAuxiliar?.produtoId) return { produtoId: codigoAuxiliar.produtoId, ean: codigoAuxiliar.id || candidato };
  }
  return null;
}

async function buscarProdutoErp(baseUrl: string, token: string, codigo: string): Promise<{ produto: ErpProduto; ean: string } | null> {
  const codigoAuxiliar = await buscarCodigoAuxiliarPorEan(baseUrl, token, codigo);
  if (codigoAuxiliar?.produtoId) {
    const produto = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/produtos/${codigoAuxiliar.produtoId}`);
    if (produto?.id) return { produto, ean: codigoAuxiliar.ean };
  }

  for (const candidato of normalizarEans(codigo)) {
    const data = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/codigos-auxiliares/${encodeURIComponent(candidato)}`);
    const produtoId = (data as unknown as ErpCodigoAuxiliar | null)?.produtoId;
    if (produtoId) {
      const produto = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/produtos/${produtoId}`);
      if (produto?.id) return { produto, ean: candidato };
    }
  }

  const direto = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/produtos/consulta/${encodeURIComponent(codigo)}`);
  return direto?.id ? { produto: direto, ean: codigo } : null;
}

async function buscarSecao(baseUrl: string, token: string, secaoId?: number): Promise<string | null> {
  if (!secaoId) return null;
  try {
    const secao = await fetchErpJson<ErpSecao>(baseUrl, token, `/v1/produto/secoes/${secaoId}`);
    return secao?.descricao?.trim() || null;
  } catch {
    return null;
  }
}

function extrairImagemProduto(produto: ErpProduto): string | undefined {
  const imagemDaLista = produto.imagens?.find(Boolean);
  if (typeof imagemDaLista === "string") return imagemDaLista;
  if (imagemDaLista?.url) return imagemDaLista.url;
  if (imagemDaLista?.imagem) return imagemDaLista.imagem;
  if (imagemDaLista?.src) return imagemDaLista.src;

  const metas = [produto.meta, produto.metadata, produto.metadados].filter(Boolean) as Record<string, unknown>[];
  const imagemMeta = metas
    .flatMap((meta) => [meta.imagem, meta.imagemUrl, meta.urlImagem, meta.foto, meta.fotoUrl, meta.image, meta.imageUrl, meta.url])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  return produto.imagem || produto.imagemUrl || produto.urlImagem || produto.foto || produto.fotoUrl || imagemMeta || undefined;
}

function imageCandidates(origin: string, src: string, produtoId: string): string[] {
  if (/^https?:\/\//i.test(src)) return [src];
  const encoded = encodeURIComponent(src);
  return [
    `${origin}/arquivo/view?uuid=${encoded}`,
    `${origin}/arquivo/download?uuid=${encoded}`,
    `${origin}/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagens/${encoded}`,
    `${origin}/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagem/${encoded}`,
    `${origin}/api/v1/produto/produtos/imagem/${encoded}`,
    `${origin}/api/v1/produto/imagem/${encoded}`,
  ];
}

async function baixarImagemErp(origin: string, token: string, produtoId: string, src?: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!src || /^data:image\//i.test(src)) return null;

  for (const url of imageCandidates(origin, src, produtoId)) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: token, Accept: "image/*,*/*" },
        signal: AbortSignal.timeout(15000),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) continue;
      return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
    } catch {
      // tenta proximo candidato
    }
  }

  return null;
}

function safeStoragePath(empresa: EmpresaCompras, produtoKey: string, codigo: string): string {
  const key = produtoKey || codigo;
  const safe = key.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${empresa}/${safe}.jpg`;
}

function normalizarDescricao(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isDescricaoReal(descricao: string | null | undefined, codigo: string | null | undefined): boolean {
  const desc = String(descricao ?? "").trim();
  if (!desc) return false;
  const cod = String(codigo ?? "").trim();
  const codigoNumerico = cod.match(/\d{6,14}/)?.[0] ?? "";
  const descNormalizada = normalizarDescricao(desc);
  if (desc === cod || desc === codigoNumerico) return false;
  if (/^\d{6,14}$/.test(desc)) return false;
  if (desc.includes("\u{1F6D2}")) return false;
  if (codigoNumerico && desc.includes(codigoNumerico)) return false;
  if (descNormalizada.includes("CARLOS")) return false;
  if (/\s[\u2014-]\s/.test(desc) && /\d{6,14}/.test(desc)) return false;
  return true;
}

function precisaSincronizar(row: CompraRow): boolean {
  if (!row.erp_sync_at) return true;
  if (row.updated_at && row.updated_at > row.erp_sync_at) return true;
  if (!row.secao || !row.foto_url) return true;
  if (!isDescricaoReal(row.descricao, row.codigo)) return true;
  return false;
}

async function tryLock(supabase: any): Promise<boolean> {
  const { data, error } = await supabase.rpc("compras_erp_sync_try_lock", {
    p_lock_name: LOCK_NAME,
    p_ttl_minutes: 15,
  });
  if (error) throw error;
  return data === true;
}

export const comprasErpPreload = schedules.task({
  id: "compras-erp-preload",
  cron: { pattern: "*/10 * * * *", timezone: "America/Sao_Paulo" },
  maxDuration: 300,
  run: async () => {
    if (process.env.COMPRAS_ERP_PRELOAD_ENABLED === "false") {
      return { skipped: true, reason: "COMPRAS_ERP_PRELOAD_ENABLED=false" };
    }

    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !supabaseKey) {
      return { skipped: true, reason: "SUPABASE_URL/SERVICE_ROLE ausente" };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }) as any;
    const locked = await tryLock(supabase);
    if (!locked) return { skipped: true, reason: "job ja esta rodando" };

    const maxItems = intEnv("COMPRAS_ERP_PRELOAD_MAX_ITEMS", DEFAULT_MAX_ITEMS_PER_RUN);
    const scanLimit = intEnv("COMPRAS_ERP_PRELOAD_SCAN_LIMIT", DEFAULT_SCAN_LIMIT_PER_EMPRESA);
    const delayMs = intEnv("COMPRAS_ERP_PRELOAD_DELAY_MS", DEFAULT_DELAY_MS);
    const empresas: EmpresaCompras[] = ["NEWSHOP", "SF"];
    const candidatos: CompraRow[] = [];

    for (const empresa of empresas) {
      const { data, error } = await supabase
        .from("compras")
        .select("id,empresa,produto_key,codigo,sku,descricao,secao,foto_url,updated_at,erp_sync_at")
        .eq("empresa", empresa)
        .order("erp_sync_at", { ascending: true, nullsFirst: true })
        .limit(scanLimit);
      if (error) throw error;
      candidatos.push(...((data ?? []) as CompraRow[]).filter(precisaSincronizar));
    }

    const itens = candidatos.slice(0, maxItems);
    const resultado = { total: itens.length, sucesso: 0, falha: 0, pulado: candidatos.length - itens.length, detalhes: [] as Array<Record<string, unknown>> };

    for (const item of itens) {
      const empresaErp = erpEmpresa(item.empresa);
      const baseUrl = apiBaseUrl(empresaErp);
      const origin = originFromApi(baseUrl);

      try {
        const token = await getErpToken(empresaErp, baseUrl);
        const encontrado = await buscarProdutoErp(baseUrl, token, item.codigo);
        if (!encontrado?.produto?.id) throw new Error("Produto nao encontrado no ERP");

        const produto = encontrado.produto;
        const descricao = produto.descricao?.trim() || produto.codigoInterno?.trim() || null;
        const secao = await buscarSecao(baseUrl, token, produto.secaoId);
        let fotoUrl: string | null = null;

        if (!item.foto_url) {
          const imagem = await baixarImagemErp(origin, token, String(produto.id), extrairImagemProduto(produto));
          if (imagem) {
            const path = safeStoragePath(item.empresa, item.produto_key, item.codigo);
            const upload = await supabase.storage.from(FOTO_BUCKET).upload(path, imagem.buffer, {
              contentType: imagem.contentType,
              upsert: true,
            });
            if (upload.error) throw upload.error;
            fotoUrl = supabase.storage.from(FOTO_BUCKET).getPublicUrl(path).data.publicUrl;
          }
        }

        const update: Record<string, unknown> = {
          erp_sync_at: new Date().toISOString(),
          erp_sync_error: null,
        };
        if (descricao) update.descricao = descricao;
        if (secao) update.secao = secao;
        if (fotoUrl) update.foto_url = fotoUrl;

        const { error } = await supabase.from("compras").update(update).eq("id", item.id);
        if (error) throw error;

        resultado.sucesso += 1;
        resultado.detalhes.push({ id: item.id, empresa: item.empresa, codigo: item.codigo, ok: true, base: empresaErp });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase
          .from("compras")
          .update({ erp_sync_at: new Date().toISOString(), erp_sync_error: message.slice(0, 500) })
          .eq("id", item.id);
        resultado.falha += 1;
        resultado.detalhes.push({ id: item.id, empresa: item.empresa, codigo: item.codigo, ok: false, erro: message, base: empresaErp });
      }

      await sleep(delayMs);
    }

    return resultado;
  },
});
