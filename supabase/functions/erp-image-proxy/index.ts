// Edge Function: erp-image-proxy
// Resolve e devolve a foto de um produto do Varejo Facil, testando varios endpoints
// candidatos ate achar um que responda com uma imagem. Porta 1:1 de
// server/varejo-facil/erp-image-proxy.ts (Vercel).
//
// Publico (verify_jwt = false) — usado direto em <img src="...">, que nao consegue
// mandar header de autenticacao. Igual a rota da Vercel de hoje.

type EmpresaKey = "NEWSHOP" | "FACIL" | "SOYE";

const HOSTS: Record<EmpresaKey, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

const tokenCache = new Map<string, string>();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function normalizeEmpresa(value: string | null): EmpresaKey {
  const normalized = (value ?? "").trim().toUpperCase();
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
    Deno.env.get(`ERP_API_${key}_${empresa}`) ||
    Deno.env.get(`ERP_API_${key}_${baseEmpresa}`) ||
    Deno.env.get(`ERP_API_${key}`) ||
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response("Metodo nao permitido", { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const empresa = normalizeEmpresa(url.searchParams.get("empresa"));
  const src = url.searchParams.get("src") ?? "";
  const produtoId = (url.searchParams.get("produtoId") ?? "").trim();
  const format = url.searchParams.get("format") ?? "";

  if (!src) {
    return new Response("src obrigatorio", { status: 400, headers: CORS_HEADERS });
  }

  try {
    const baseUrl = resolveBaseUrl(empresa);
    const token = await getAccessToken(empresa, baseUrl);
    let response: Response | null = null;

    for (const candidateUrl of buildImageCandidates(baseUrl, src, produtoId)) {
      const candidateResponse = await fetch(candidateUrl, {
        headers: {
          Authorization: token,
          Accept: "image/*,*/*",
        },
      });
      const contentType = candidateResponse.headers.get("content-type") || "";

      if (candidateResponse.status === 401) {
        tokenCache.clear();
      }

      if (!candidateResponse.ok) continue;

      if (contentType.startsWith("image/")) {
        response = candidateResponse;
        break;
      }
    }

    if (!response) {
      return new Response(
        JSON.stringify({ error: "Imagem do ERP nao encontrada por URL/ID", src }),
        { status: 422, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = new Uint8Array(await response.arrayBuffer());

    if (!contentType.startsWith("image/")) {
      return new Response(
        JSON.stringify({ error: "URL do ERP nao retornou imagem", contentType }),
        { status: 422, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    if (format === "data-url") {
      const mimeType = contentType.split(";")[0]?.trim() || "image/jpeg";
      let binary = "";
      for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]);
      const base64 = btoa(binary);
      return new Response(
        JSON.stringify({ dataUrl: `data:${mimeType};base64,${base64}` }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600",
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(message, { status: 500, headers: CORS_HEADERS });
  }
});
