import type { VercelRequest, VercelResponse } from "@vercel/node";

type EmpresaKey = "NEWSHOP" | "FACIL" | "SOYE";

const HOSTS: Record<EmpresaKey, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

const tokenCache = new Map<string, string>();

interface ErpAuth {
  token: string;
  configured: boolean;
}

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

function getEnv(empresa: EmpresaKey, key: "URL" | "USERNAME" | "PASSWORD" | "TOKEN" | "KEY"): string {
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

function resolveBaseUrl(empresa: EmpresaKey): string {
  const baseEmpresa = erpBaseEmpresa(empresa);
  const configuredUrl = (getEnv(empresa, "URL") || `https://${HOSTS[baseEmpresa]}`).replace(/\/$/, "");
  return configuredUrl.endsWith("/api") ? configuredUrl.slice(0, -4) : configuredUrl;
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

async function getAccessToken(empresa: EmpresaKey, baseUrl: string): Promise<ErpAuth> {
  const configuredToken = getEnv(empresa, "TOKEN") || getEnv(empresa, "KEY");
  if (configuredToken) return { token: configuredToken, configured: true };

  const username = getEnv(empresa, "USERNAME");
  const password = getEnv(empresa, "PASSWORD");
  const cacheKey = `${empresa}:${baseUrl}:${username}`;
  const cachedToken = tokenCache.get(cacheKey);

  if (cachedToken) return { token: cachedToken, configured: false };
  if (!username || !password) {
    throw new Error(`Credenciais do ERP nao configuradas para ${empresa}.`);
  }

  const response = await fetch(`${baseUrl}/api/auth`, {
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
  return { token, configured: false };
}

function buildErpHeaders(auth: ErpAuth, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: auth.token,
    Accept: accept,
  };

  if (auth.configured) {
    headers["X-API-KEY"] = auth.token;
  }

  return headers;
}

function resolveImageUrl(baseUrl: string, src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return `${baseUrl}${src.startsWith("/") ? src : `/${src}`}`;
}

function buildImageCandidates(baseUrl: string, src: string, produtoId?: string): string[] {
  const trimmed = src.trim();

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return [resolveImageUrl(baseUrl, trimmed)];
  }

  const encoded = encodeURIComponent(trimmed);
  const produtoCandidates = produtoId
    ? [
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagens/${encoded}`,
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagem/${encoded}`,
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagens/${encoded}/download`,
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagem/${encoded}/download`,
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagens`,
        `/api/v1/produto/produtos/${encodeURIComponent(produtoId)}/imagem`,
      ]
    : [];

  return [
    `/arquivo/view?uuid=${encoded}`,
    `/arquivo/download?uuid=${encoded}`,
    ...produtoCandidates,
    `/api/v1/produto/produtos/imagens/${encoded}`,
    `/api/v1/produto/imagens/${encoded}`,
    `/api/v1/produto/produtos/imagem/${encoded}`,
    `/api/v1/produto/imagem/${encoded}`,
    `/api/v1/imagens/${encoded}`,
    `/api/v1/arquivos/${encoded}`,
    `/api/v1/files/${encoded}`,
    `/api/v1/anexos/${encoded}`,
    `/${encoded}`,
  ].map((candidate) => `${baseUrl}${candidate}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Metodo nao permitido");
  }

  const empresa = normalizeEmpresa(req.query.empresa);
  const src = getSingle(req.query.src);
  const produtoId = getSingle(req.query.produtoId).trim();
  const format = getSingle(req.query.format);

  if (!src) {
    return res.status(400).send("src obrigatorio");
  }

  try {
    const baseUrl = resolveBaseUrl(empresa);
    const auth = await getAccessToken(empresa, baseUrl);
    let imageResponse: Response | null = null;

    for (const candidateUrl of buildImageCandidates(baseUrl, src, produtoId)) {
      const response = await fetch(candidateUrl, {
        headers: buildErpHeaders(auth, "image/*,*/*"),
      });
      const contentType = response.headers.get("content-type") || "";

      if (response.status === 401) {
        tokenCache.clear();
      }

      if (response.ok && contentType.startsWith("image/")) {
        imageResponse = response;
        break;
      }
    }

    if (!imageResponse) {
      return res.status(422).json({ error: "Imagem do ERP nao encontrada por URL/ID", src });
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    if (format === "data-url") {
      const mimeType = contentType.split(";")[0]?.trim() || "image/jpeg";
      return res.status(200).json({
        dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
      });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return res.status(500).send(message);
  }
}
