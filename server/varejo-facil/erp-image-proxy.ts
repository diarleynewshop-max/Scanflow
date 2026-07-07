import type { VercelRequest, VercelResponse } from "@vercel/node";

type EmpresaKey = "NEWSHOP" | "FACIL" | "SOYE";

const HOSTS: Record<EmpresaKey, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

const tokenCache = new Map<string, string>();

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
  const baseEmpresa = erpBaseEmpresa(empresa);
  return (
    process.env[`ERP_API_${key}_${baseEmpresa}`] ||
    process.env[`VITE_ERP_API_${key}_${baseEmpresa}`] ||
    process.env[`ERP_API_${key}_${empresa}`] ||
    process.env[`VITE_ERP_API_${key}_${empresa}`] ||
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
  return token;
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
  const candidates = [
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
  ];

  return candidates.map((candidate) => `${baseUrl}${candidate}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Metodo nao permitido");
  }

  const empresa = normalizeEmpresa(req.query.empresa);
  const src = getSingle(req.query.src);
  const produtoId = getSingle(req.query.produtoId).trim();

  if (!src) {
    return res.status(400).send("src obrigatorio");
  }

  try {
    const baseUrl = resolveBaseUrl(empresa);
    const token = await getAccessToken(empresa, baseUrl);
    let response: Response | null = null;
    let lastNonImage: { contentType: string; preview: string } | null = null;

    const tried: Array<{ url: string; status: number; contentType: string }> = [];

    for (const url of buildImageCandidates(baseUrl, src, produtoId)) {
      const candidateResponse = await fetch(url, {
        headers: {
          Authorization: token,
          Accept: "image/*,*/*",
        },
      });
      const contentType = candidateResponse.headers.get("content-type") || "";
      tried.push({ url, status: candidateResponse.status, contentType });

      if (candidateResponse.status === 401) {
        tokenCache.clear();
      }

      if (!candidateResponse.ok) {
        continue;
      }

      if (contentType.startsWith("image/")) {
        response = candidateResponse;
        break;
      }

      const previewBuffer = Buffer.from(await candidateResponse.arrayBuffer());
      lastNonImage = {
        contentType,
        preview: previewBuffer.toString("utf8", 0, Math.min(previewBuffer.length, 300)),
      };
    }

    if (!response) {
      console.warn("[erp-image-proxy] Imagem do ERP nao encontrada", {
        empresa,
        produtoId,
        src,
        tried: tried.map((item) => ({
          status: item.status,
          contentType: item.contentType,
          url: item.url,
        })),
      });
      return res.status(422).json({
        error: "Imagem do ERP nao encontrada por URL/ID",
        src,
        tried,
        lastNonImage,
      });
    }

    if (response.status === 401) {
      tokenCache.clear();
    }

    if (!response.ok) {
      return res.status(response.status).send(`Falha ao carregar imagem (${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (!contentType.startsWith("image/")) {
      console.warn("[erp-image-proxy] URL do ERP nao retornou imagem", {
        empresa,
        produtoId,
        src,
        contentType,
      });
      return res.status(422).json({
        error: "URL do ERP nao retornou imagem",
        contentType,
        preview: buffer.toString("utf8", 0, Math.min(buffer.length, 300)),
      });
    }

    console.info("[erp-image-proxy] Imagem encontrada", {
      empresa,
      produtoId,
      src,
      contentType,
      bytes: buffer.length,
    });

    if (req.query.format === "data-url") {
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
