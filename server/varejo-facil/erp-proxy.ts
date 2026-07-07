import type { VercelRequest, VercelResponse } from "@vercel/node";

type EmpresaKey = "NEWSHOP" | "FACIL" | "SOYE";
type ErpProduto = Record<string, unknown> & { id?: number | string; imagem?: string };
type UploadedArquivo = { uuid?: string; raw: unknown; directUpdate?: boolean };
type UploadAttempt = {
  endpoint: string;
  fieldName: string;
  mode: string;
  status: number | null;
  contentType?: string;
  isHtml?: boolean;
  cookieConfigured?: boolean;
  cookieLength?: number;
  preview: string;
};

const HOSTS: Record<EmpresaKey, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

const tokenCache = new Map<string, string>();

class UploadArquivoError extends Error {
  attempts: UploadAttempt[];

  constructor(message: string, attempts: UploadAttempt[]) {
    super(message);
    this.name = "UploadArquivoError";
    this.attempts = attempts;
  }
}

function getSingle(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeEmpresa(value: string | string[] | undefined): EmpresaKey {
  const normalized = getSingle(value).trim().toUpperCase();
  if (normalized.includes("SOYE")) return "SOYE";
  if (normalized.includes("FACIL")) return "FACIL";
  return "NEWSHOP";
}

function erpBaseEmpresa(empresa: EmpresaKey): EmpresaKey {
  return empresa === "SOYE" ? "FACIL" : empresa;
}

function getEnv(empresa: EmpresaKey, key: "URL" | "USERNAME" | "PASSWORD" | "TOKEN"): string {
  // Credencial especifica da empresa (ex.: SOYE) sempre vence a da baseEmpresa
  // (FACIL) — SOYE e FACIL compartilham host, mas podem ter tokens diferentes.
  const baseEmpresa = erpBaseEmpresa(empresa);
  return (
    process.env[`ERP_API_${key}_${empresa}`] ||
    process.env[`VITE_ERP_API_${key}_${empresa}`] ||
    process.env[`ERP_API_${key}_${baseEmpresa}`] ||
    process.env[`VITE_ERP_API_${key}_${baseEmpresa}`] ||
    process.env[`ERP_API_${key}`] ||
    process.env[`VITE_ERP_API_${key}`] ||
    ""
  );
}

function getWebCookie(empresa: EmpresaKey): string {
  const baseEmpresa = erpBaseEmpresa(empresa);
  return (
    process.env[`ERP_WEB_COOKIE_${baseEmpresa}`] ||
    process.env[`ERP_WEB_COOKIE_${empresa}`] ||
    process.env.ERP_WEB_COOKIE ||
    ""
  );
}

function resolveBaseUrl(empresa: EmpresaKey): string {
  const baseEmpresa = erpBaseEmpresa(empresa);
  const configuredUrl = (getEnv(empresa, "URL") || `https://${HOSTS[baseEmpresa]}`).replace(/\/$/, "");
  return configuredUrl.endsWith("/api") ? configuredUrl : `${configuredUrl}/api`;
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

function parseBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body as Record<string, unknown>;
  return {};
}

async function fetchErpJson<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; data: T | null; text: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") && text ? (JSON.parse(text) as T) : null;
  return { response, data, text };
}

async function fetchErpRaw(
  url: string,
  token: string,
  init: RequestInit = {},
  includeAuthorization = true
): Promise<{ response: Response; data: unknown; text: string }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(includeAuthorization ? { Authorization: token } : {}),
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data: unknown = text;

  if (contentType.includes("application/json") && text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { response, data, text };
}

function getOriginFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/api$/, "");
}

function dataUrlToArquivo(photo: string): { buffer: Buffer; mimeType: string; filename: string; rawBase64: string } {
  const match = photo.match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;[^;,]+)*;base64,(.+)$/);
  if (!match) {
    throw new Error("Foto precisa estar em data:image base64.");
  }

  const mimeType = match[1];
  const rawBase64 = match[2];

  return {
    buffer: Buffer.from(rawBase64, "base64"),
    mimeType,
    filename: "imagem.png",
    rawBase64,
  };
}

function findUuid(value: unknown): string {
  if (typeof value === "string") {
    const uuid = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    return uuid || "";
  }

  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const direct = [
    record.uuid,
    record.uid,
    record.id,
    record.nome,
    record.name,
  ].find((item): item is string => typeof item === "string" && item.trim().length > 0);

  const directUuid = findUuid(direct);
  if (directUuid) return directUuid;

  for (const item of Object.values(record)) {
    const nested = findUuid(item);
    if (nested) return nested;
  }

  return "";
}

function resolveUploadErrorMessage(attempts: UploadAttempt[]): string {
  if (attempts.some((attempt) => attempt.mode === "erp-frame-multipart-upload" && attempt.isHtml)) {
    return "Upload /arquivo/upload exige cookie JSESSIONID da sessao web do ERP. Configure ERP_WEB_COOKIE_NEWSHOP.";
  }

  if (attempts.some((attempt) => attempt.isHtml)) {
    return "Endpoint retornou HTML/login, nao JSON da API.";
  }

  return "ERP nao aceitou upload de imagem pela API configurada. Verifique permissao/API de CadastrosEstruturais ou contrato do endpoint arquivo/upload.";
}

async function uploadArquivoImagem(
  baseUrl: string,
  token: string,
  photo: string,
  codigoProduto: string,
  produtoId?: string,
  webCookie = ""
): Promise<UploadedArquivo> {
  const origin = getOriginFromBaseUrl(baseUrl);
  const arquivo = dataUrlToArquivo(photo);
  const attempts: UploadAttempt[] = [];
  const totvsImagemPayload = {
    idProduto: produtoId ? Number(produtoId) : undefined,
    descricao: codigoProduto.slice(0, 40),
    imagem: arquivo.rawBase64,
    indPrincipal: "S",
    dispImagem: "F",
    statusEcomm: "A",
  };
  const uploadAttempts: Array<{
    endpoint: string;
    fieldName: string;
    mode: string;
    headers: Record<string, string>;
    body: BodyInit;
  }> = [
    {
      endpoint: `${origin}/arquivo/upload`,
      fieldName: "upload",
      mode: "erp-frame-multipart-upload",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        Origin: origin,
        Referer: `${origin}/arquivo/frame`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
        "Content-Disposition": `attachment; filename="nao_tem_${codigoProduto}.jpg"`,
        ...(webCookie ? { Cookie: webCookie } : {}),
      },
      body: (() => {
        const formData = new FormData();
        const blob = new Blob([arquivo.buffer], { type: arquivo.mimeType });
        formData.append("upload", blob, `nao_tem_${codigoProduto}.jpg`);
        return formData;
      })(),
    },
    {
      endpoint: `${baseUrl}/v1/arquivo/upload`,
      fieldName: "upload",
      mode: "api-multipart-upload",
      headers: {},
      body: (() => {
        const formData = new FormData();
        const blob = new Blob([arquivo.buffer], { type: arquivo.mimeType });
        formData.append("upload", blob, `nao_tem_${codigoProduto}.jpg`);
        return formData;
      })(),
    },
    {
      endpoint: `${baseUrl}/v1/arquivo/upload`,
      fieldName: "json",
      mode: "json-arquivo-base64",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: arquivo.filename,
        descricao: codigoProduto,
        mimeType: arquivo.mimeType,
        arquivo: arquivo.rawBase64,
      }),
    },
    {
      endpoint: `${baseUrl}/v1/arquivo/upload`,
      fieldName: "json",
      mode: "json-file-base64",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: arquivo.filename,
        codigo: codigoProduto,
        contentType: arquivo.mimeType,
        file: arquivo.rawBase64,
      }),
    },
    {
      endpoint: `${origin}/CadastrosEstruturaisAPI/api/v1/Produto/produto-imagem`,
      fieldName: "json",
      mode: "totvs-produto-imagem-base64",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(totvsImagemPayload),
    },
  ];

  for (const uploadAttempt of uploadAttempts.slice(0, 5)) {
    try {
      const result = await fetchErpRaw(uploadAttempt.endpoint, token, {
        method: "POST",
        headers: uploadAttempt.headers,
        body: uploadAttempt.body,
      }, uploadAttempt.mode !== "erp-frame-multipart-upload");

      if (result.response.status === 401) tokenCache.clear();
      const contentType = result.response.headers.get("content-type") || "";
      const preview = result.text.replace(/\s+/g, " ").slice(0, 320);

      if (result.response.ok && !contentType.includes("text/html")) {
        const uuid = findUuid(result.data);
        return { uuid: uuid || undefined, raw: result.data, directUpdate: true };
      }

      attempts.push({
        endpoint: uploadAttempt.endpoint,
        fieldName: uploadAttempt.fieldName,
        mode: uploadAttempt.mode,
        status: result.response.status,
        contentType,
        isHtml: contentType.includes("text/html"),
        cookieConfigured: uploadAttempt.mode === "erp-frame-multipart-upload" ? Boolean(webCookie) : undefined,
        cookieLength: uploadAttempt.mode === "erp-frame-multipart-upload" ? webCookie.length : undefined,
        preview: preview || "Resposta sem UUID",
      });
    } catch (error) {
      attempts.push({
        endpoint: uploadAttempt.endpoint,
        fieldName: uploadAttempt.fieldName,
        mode: uploadAttempt.mode,
        status: null,
        contentType: "",
        isHtml: false,
        cookieConfigured: uploadAttempt.mode === "erp-frame-multipart-upload" ? Boolean(webCookie) : undefined,
        cookieLength: uploadAttempt.mode === "erp-frame-multipart-upload" ? webCookie.length : undefined,
        preview: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  throw new UploadArquivoError(resolveUploadErrorMessage(attempts), attempts);
}

function normalizarEans(codigo: string): string[] {
  const limpo = codigo.replace(/\s+/g, "");
  const candidatos = [limpo];
  if (/^\d+$/.test(limpo) && limpo.length < 14) {
    candidatos.push(limpo.padStart(14, "0"));
  }
  if (/^\d{13}$/.test(limpo)) candidatos.push(`0${limpo}`);
  if (/^0+\d+$/.test(limpo)) candidatos.push(limpo.replace(/^0+/, ""));
  return [...new Set(candidatos.filter(Boolean))];
}

async function buscarProdutoPorCodigo(baseUrl: string, token: string, codigo: string): Promise<ErpProduto | null> {
  for (const candidato of normalizarEans(codigo)) {
    const fiql = encodeURIComponent(`id==${candidato}`);
    const codAux = await fetchErpJson<{ items?: Array<{ produtoId?: number }> }>(
      baseUrl,
      token,
      `/v1/produto/codigos-auxiliares?q=${fiql}&count=5`
    );

    const produtoId = codAux.data?.items?.find((item) => item?.produtoId)?.produtoId;
    if (produtoId) {
      const produto = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/produtos/${produtoId}`);
      if (produto.response.ok && produto.data?.id) return produto.data;
    }
  }

  const produto = await fetchErpJson<ErpProduto>(
    baseUrl,
    token,
    `/v1/produto/produtos/consulta/${encodeURIComponent(codigo)}`
  );
  if (produto.response.ok && produto.data?.id) return produto.data;
  return null;
}

async function atualizarFotoProduto(baseUrl: string, token: string, codigo: string, photo: string, webCookie = "") {
  const produto = await buscarProdutoPorCodigo(baseUrl, token, codigo);
  if (!produto?.id) {
    return { ok: false, status: 404, error: "Produto nao encontrado no ERP" };
  }

  const arquivo = await uploadArquivoImagem(baseUrl, token, photo, codigo, String(produto.id), webCookie);
  if (arquivo.directUpdate && !arquivo.uuid) {
    return { ok: true, status: 200, produtoId: produto.id, directUpdate: true };
  }

  if (!arquivo.uuid) {
    return {
      ok: false,
      status: 422,
      produtoId: produto.id,
      error: "ERP aceitou o envio, mas nao retornou UUID da imagem",
    };
  }

  const payload = { ...produto, imagem: arquivo.uuid };
  const produtoId = encodeURIComponent(String(produto.id));
  const update = await fetchErpJson<ErpProduto>(baseUrl, token, `/v1/produto/produtos/${produtoId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  if (update.response.status === 401) tokenCache.clear();

  if (!update.response.ok) {
    return {
      ok: false,
      status: update.response.status,
      produtoId: produto.id,
      error: update.text || "Falha ao atualizar imagem no ERP",
    };
  }

  return { ok: true, status: update.response.status, produtoId: produto.id, uuid: arquivo.uuid };
}

async function getAccessToken(empresa: EmpresaKey, baseUrl: string): Promise<string> {
  const configuredToken = getEnv(empresa, "TOKEN");
  if (configuredToken) return configuredToken;

  const username = getEnv(empresa, "USERNAME");
  const password = getEnv(empresa, "PASSWORD");
  const cacheKey = `${empresa}:${baseUrl}:${username}`;
  const cachedToken = tokenCache.get(cacheKey);

  if (cachedToken) return cachedToken;
  if (!username || !password) {
    throw new Error(`Credenciais do ERP nao configuradas para ${empresa}.`);
  }

  const response = await fetch(`${baseUrl}/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Nao foi possivel autenticar no ERP (${response.status}).`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const token = resolveTokenFromAuth(data);

  if (!token) {
    throw new Error("O ERP nao retornou um access token valido no login.");
  }

  tokenCache.set(cacheKey, token);
  return token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Metodo nao permitido" });
  }

  const empresa = normalizeEmpresa(req.query.empresa);
  const action = getSingle(req.query.action);
  const path = getSingle(req.query.path);

  if (req.method === "POST" && action === "upload-product-photo") {
    return res.status(410).json({
      ok: false,
      error: "Envio de foto para o ERP Varejo Facil desativado. O sistema agora apenas consulta/recebe fotos.",
    });
  }

  if (req.method === "GET" && (!path || !path.startsWith("/"))) {
    return res.status(400).json({ error: "path obrigatorio" });
  }

  try {
    const baseUrl = resolveBaseUrl(empresa);
    const token = await getAccessToken(empresa, baseUrl);

    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: token,
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      tokenCache.clear();
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") && text ? JSON.parse(text) : text;

    return res.status(response.status).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return res.status(500).json({ error: message, empresa });
  }
}
