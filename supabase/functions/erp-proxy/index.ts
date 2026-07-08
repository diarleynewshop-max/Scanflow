// Edge Function: erp-proxy
// Repassa chamadas GET autenticadas para a API REST do Varejo Facil (multiempresa).
// Porta 1:1 de server/varejo-facil/erp-proxy.ts (Vercel) — so a parte realmente usada
// pelo handler (upload de foto e codigo morto la e nao foi portado aqui: o upload de
// foto pro ERP acontece via src/trigger/erpFotoSync.ts no Trigger.dev, nao por aqui).
//
// Publico (verify_jwt = false em supabase/config.toml) — igual a rota da Vercel de
// hoje, que tambem nao exige nenhuma autenticacao Supabase. O segredo real e a
// credencial do ERP, guardada como secret desta function (nunca chega ao browser).

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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function normalizeEmpresa(value: string | null): EmpresaKey {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized.includes("SOYE")) return "SOYE";
  if (normalized.includes("FACIL")) return "FACIL";
  return "NEWSHOP";
}

function erpBaseEmpresa(empresa: EmpresaKey): EmpresaKey {
  return empresa === "SOYE" ? "FACIL" : empresa;
}

function getEnv(empresa: EmpresaKey, key: "URL" | "USERNAME" | "PASSWORD" | "TOKEN" | "KEY"): string {
  // Credencial especifica da empresa (ex.: SOYE) sempre vence a da baseEmpresa
  // (FACIL) — SOYE e FACIL compartilham host, mas podem ter tokens diferentes.
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
  return { token, configured: false };
}

function buildErpHeaders(auth: ErpAuth): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: auth.token,
    Accept: "application/json",
  };

  if (auth.configured) {
    headers["X-API-KEY"] = auth.token;
  }

  return headers;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Metodo nao permitido" });
  }

  const url = new URL(req.url);
  const empresa = normalizeEmpresa(url.searchParams.get("empresa"));
  const path = url.searchParams.get("path") ?? "";

  if (!path || !path.startsWith("/")) {
    return jsonResponse(400, { error: "path obrigatorio" });
  }

  try {
    const baseUrl = resolveBaseUrl(empresa);
    const auth = await getAccessToken(empresa, baseUrl);

    const response = await fetch(`${baseUrl}${path}`, {
      headers: buildErpHeaders(auth),
    });

    if (response.status === 401) {
      tokenCache.clear();
    }

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") && text ? JSON.parse(text) : text;

    return jsonResponse(response.status, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonResponse(500, { error: message, empresa });
  }
});
