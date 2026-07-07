import { task } from "@trigger.dev/sdk/v3";
import sharp from "sharp";
import FormDataNode from "form-data";
import axios from "axios";
import * as cheerio from "cheerio";

type EmpresaKey = "NEWSHOP" | "SOYE" | "FACIL";

const HOSTS: Record<EmpresaKey, string> = {
  NEWSHOP: "newshop.varejofacil.com",
  FACIL: "facil.varejofacil.com",
  SOYE: "facil.varejofacil.com",
};

function getEnv(empresa: EmpresaKey, key: "URL" | "USERNAME" | "PASSWORD" | "TOKEN"): string {
  const baseEmpresa = empresa === "SOYE" ? "FACIL" : empresa;
  return (
    process.env[`ERP_API_${key}_${baseEmpresa}`] ||
    process.env[`ERP_API_${key}_${empresa}`] ||
    process.env[`ERP_API_${key}`] ||
    ""
  );
}

function resolveOrigin(empresa: EmpresaKey): string {
  const baseEmpresa = empresa === "SOYE" ? "FACIL" : empresa;
  const url = (getEnv(empresa, "URL") || `https://${HOSTS[baseEmpresa]}`).replace(/\/$/, "");
  return url.replace(/\/api$/, "");
}

function normalizeEmpresa(value: string): EmpresaKey {
  const upper = value.trim().toUpperCase();
  if (upper.includes("SOYE")) return "SOYE";
  if (upper.includes("FACIL")) return "FACIL";
  return "NEWSHOP";
}

// --- Web session auth (JSESSIONID) ---

async function loginErpWeb(origin: string, empresa: EmpresaKey): Promise<string> {
  const username = getEnv(empresa, "USERNAME");
  const password = getEnv(empresa, "PASSWORD");
  if (!username || !password) {
    throw new Error(`ERP_API_USERNAME ou ERP_API_PASSWORD nao configurados para ${empresa}. O upload de foto exige credenciais web.`);
  }

  const loginUrl = `${origin}/j_spring_security_check?j_username=${encodeURIComponent(username)}&j_password=${encodeURIComponent(password)}`;

  console.info(`[erp-foto-sync] Login web: ${origin}/j_spring_security_check`);

  const res = await axios.post(loginUrl, undefined, {
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      Referer: `${origin}/app/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 15_000,
  });

  console.info(`[erp-foto-sync] Login web status=${res.status}`);

  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const jsessionId = cookies
    .map((c: string) => c.split(";")[0])
    .find((c: string) => c.startsWith("JSESSIONID="));

  if (!jsessionId) {
    console.error(`[erp-foto-sync] Cookies recebidos: ${cookies.map((c: string) => c.split(";")[0]).join(", ") || "(nenhum)"}`);
    throw new Error("Login web: JSESSIONID nao encontrado na resposta");
  }

  console.info(`[erp-foto-sync] Login web OK — ${jsessionId.slice(0, 30)}...`);
  return jsessionId;
}

// --- Form parsing ---

interface FormField {
  name: string;
  value: string;
}

function extrairCamposFormulario(html: string): { campos: FormField[]; formAction: string } {
  const $ = cheerio.load(html);
  const campos: FormField[] = [];

  const form = $("form").first();
  const formAction = form.attr("action") || "/produto/cadastro/edita";

  $("input").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const type = ($(el).attr("type") || "text").toLowerCase();
    if (type === "file" || type === "button" || type === "submit" || type === "reset") return;

    if (type === "checkbox" || type === "radio") {
      if ($(el).is(":checked")) {
        campos.push({ name, value: $(el).attr("value") ?? "on" });
      }
      return;
    }

    campos.push({ name, value: $(el).attr("value") ?? "" });
  });

  $("select").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const selected = $(el).find("option:selected");
    campos.push({ name, value: selected.attr("value") ?? selected.text() ?? "" });
  });

  $("textarea").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    campos.push({ name, value: $(el).text() ?? "" });
  });

  // Grids auxiliares podem estar em <script> tags como dados JSON.
  // Patterns comuns: var gridData = [...]; ou data-grid="..."
  const gridKeywords = [
    "produtosAuxiliares", "itensDeImpostoFederal",
    "referenciaDoFornecedor", "estoquesDoProduto",
  ];

  const scriptTags: string[] = [];
  $("script").each((_, el) => {
    const text = $(el).html() || "";
    if (gridKeywords.some((kw) => text.includes(kw))) {
      scriptTags.push(text.slice(0, 500));
    }
  });

  if (scriptTags.length > 0) {
    console.info(`[erp-foto-sync] Scripts com grids: ${scriptTags.length}`);
    for (const tag of scriptTags.slice(0, 3)) {
      console.info(`[erp-foto-sync] Script: ${tag.slice(0, 300)}`);
    }
  }

  // Também buscar inputs hidden com nomes de array (grid rows)
  $("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name") || "";
    if (name.includes("[") && !campos.some((c) => c.name === name)) {
      campos.push({ name, value: $(el).attr("value") ?? "" });
    }
  });

  // Buscar rows em tables com data attributes
  $("tr[data-index], tr[data-row]").each((_, tr) => {
    $(tr).find("input, select, textarea").each((_, el) => {
      const name = $(el).attr("name");
      if (name && !campos.some((c) => c.name === name && c.value === ($(el).attr("value") ?? ""))) {
        campos.push({ name, value: $(el).attr("value") ?? $(el).text() ?? "" });
      }
    });
  });

  return { campos, formAction };
}

// --- Steps ---

async function lerFormularioProduto(
  origin: string,
  cookie: string,
  produtoId: string
): Promise<{ campos: FormField[]; formAction: string }> {
  const url = `${origin}/produto/cadastro/edita/${produtoId}`;
  console.info(`[erp-foto-sync] GET ${url}`);

  const res = await axios.get(url, {
    headers: {
      Cookie: cookie,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: `${origin}/produto/cadastro/`,
      "X-Requested-With": "XMLHttpRequest",
    },
    validateStatus: () => true,
    timeout: 20_000,
    maxRedirects: 5,
  });

  console.info(`[erp-foto-sync] GET edita status=${res.status} ct=${res.headers["content-type"] || ""} len=${String(res.data).length}`);

  if (res.status !== 200) {
    const preview = String(res.data).slice(0, 200);
    throw new Error(`Ler formulario ERP: status ${res.status} para produtoId=${produtoId}. Preview: ${preview}`);
  }

  const html = String(res.data);
  const isLoginPage = html.includes("j_spring_security_check") && !html.includes("produto.id");
  if (isLoginPage) {
    throw new Error(`Ler formulario ERP: sessao expirada (ERP redirecionou para login). produtoId=${produtoId}`);
  }

  const result = extrairCamposFormulario(html);
  const campoNomes = result.campos.map((c) => c.name);
  const prefixos = [...new Set(campoNomes.map((n) => n.split(".")[0].split("[")[0]))];
  const arrayFields = campoNomes.filter((n) => n.includes("["));
  const amostra = result.campos.slice(0, 15).map((c) => `${c.name}=${c.value.slice(0, 40)}`).join(" | ");
  console.info(`[erp-foto-sync] Formulario: ${result.campos.length} campos, action=${result.formAction}`);
  console.info(`[erp-foto-sync] Prefixos: ${prefixos.join(", ")}`);
  console.info(`[erp-foto-sync] Campos array (grids): ${arrayFields.length > 0 ? arrayFields.join(", ") : "NENHUM"}`);
  console.info(`[erp-foto-sync] Amostra: ${amostra}`);

  const temProdutoId = campoNomes.some((n) => n === "produto.id" || n === "id");
  if (!temProdutoId && result.campos.length < 3) {
    throw new Error(`Formulario do ERP muito pequeno (${result.campos.length} campos) — pode ser pagina de erro`);
  }

  return result;
}

async function uploadImagemErp(
  origin: string,
  cookie: string,
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const form = new FormDataNode();
  form.append("upload", imageBuffer, { filename, contentType: "image/jpeg" });

  console.info(`[erp-foto-sync] POST ${origin}/arquivo/upload (${imageBuffer.length} bytes)`);

  const res = await axios.post(`${origin}/arquivo/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Cookie: cookie,
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: origin,
      Referer: `${origin}/arquivo/frame`,
      "X-Requested-With": "XMLHttpRequest",
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
    timeout: 30_000,
  });

  const contentType = String(res.headers["content-type"] || "");
  console.info(`[erp-foto-sync] Upload status=${res.status} ct=${contentType}`);

  if (contentType.includes("text/html")) {
    throw new Error(`Upload retornou HTML (sessao expirada ou endpoint errado). status=${res.status}`);
  }

  if (res.status < 200 || res.status >= 300) {
    const preview = typeof res.data === "string" ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300);
    throw new Error(`Upload falhou: status=${res.status} body=${preview}`);
  }

  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  console.info(`[erp-foto-sync] Upload response: ${JSON.stringify(data).slice(0, 500)}`);

  const filesUrl = data?.files?.[0]?.url;
  if (filesUrl) return filesUrl;

  const uuid = data?.uuid ?? data?.id ?? data?.name;
  if (uuid) return String(uuid);

  throw new Error(`Upload aceito mas sem identificador de imagem. Response: ${JSON.stringify(data).slice(0, 300)}`);
}

function montarFormComImagem(campos: FormField[], imageId: string): string {
  const params = new URLSearchParams();

  let foundImagem = false;
  for (const campo of campos) {
    if (campo.name === "produto.imagem") {
      params.append(campo.name, imageId);
      foundImagem = true;
    } else {
      params.append(campo.name, campo.value);
    }
  }

  if (!foundImagem) {
    params.append("produto.imagem", imageId);
  }

  return params.toString();
}

async function salvarProdutoErp(
  origin: string,
  cookie: string,
  produtoId: string,
  formAction: string,
  formBody: string
): Promise<void> {
  const saveUrl = formAction.startsWith("http") ? formAction : `${origin}${formAction}`;
  console.info(`[erp-foto-sync] POST save ${saveUrl} (${formBody.length} chars)`);

  const res = await axios.post(saveUrl, formBody, {
    headers: {
      Cookie: cookie,
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: origin,
      Referer: `${origin}/produto/cadastro/edita/${produtoId}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 20_000,
  });

  console.info(`[erp-foto-sync] Save status=${res.status}`);

  if (res.status >= 400) {
    const preview = String(res.data).slice(0, 300);
    throw new Error(`Salvar produto ERP: status ${res.status}. Preview: ${preview}`);
  }
}

async function getApiToken(empresa: EmpresaKey): Promise<string> {
  const configuredToken = getEnv(empresa, "TOKEN");
  if (configuredToken) return configuredToken;

  const username = getEnv(empresa, "USERNAME");
  const password = getEnv(empresa, "PASSWORD");
  const baseUrl = resolveOrigin(empresa) + "/api";

  const res = await axios.post(`${baseUrl}/auth`, { username, password }, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (res.status >= 400) throw new Error(`API auth falhou (${res.status})`);

  const data = res.data as Record<string, unknown>;
  return (
    (typeof data.accessToken === "string" && data.accessToken) ||
    (typeof data.access_token === "string" && data.access_token) ||
    (typeof data.token === "string" && data.token) ||
    (typeof data.jwt === "string" && data.jwt) ||
    ""
  );
}

async function salvarProdutoViaApi(
  empresa: EmpresaKey,
  produtoId: string,
  imageId: string
): Promise<void> {
  const baseUrl = resolveOrigin(empresa) + "/api";
  const token = await getApiToken(empresa);
  if (!token) throw new Error("API token nao obtido");

  console.info(`[erp-foto-sync] REST API: GET /v1/produto/produtos/${produtoId}`);
  const getRes = await axios.get(`${baseUrl}/v1/produto/produtos/${produtoId}`, {
    headers: { Authorization: token, Accept: "application/json" },
    validateStatus: () => true,
    timeout: 15_000,
  });

  if (getRes.status >= 400) {
    throw new Error(`REST GET produto falhou: status=${getRes.status}`);
  }

  const produto = getRes.data as Record<string, unknown>;
  produto.imagem = imageId;

  console.info(`[erp-foto-sync] REST API: PUT /v1/produto/produtos/${produtoId} (imagem=${imageId})`);
  const putRes = await axios.put(
    `${baseUrl}/v1/produto/produtos/${encodeURIComponent(produtoId)}`,
    JSON.stringify(produto),
    {
      headers: { Authorization: token, "Content-Type": "application/json", Accept: "application/json" },
      validateStatus: () => true,
      timeout: 20_000,
    }
  );

  console.info(`[erp-foto-sync] REST PUT status=${putRes.status}`);
  if (putRes.status >= 400) {
    const preview = typeof putRes.data === "string" ? putRes.data.slice(0, 300) : JSON.stringify(putRes.data).slice(0, 300);
    throw new Error(`REST PUT produto falhou: status=${putRes.status} body=${preview}`);
  }
}

async function validarImagemSalva(
  origin: string,
  cookie: string,
  produtoId: string,
  imageIdEsperado: string
): Promise<boolean> {
  const { campos } = await lerFormularioProduto(origin, cookie, produtoId);
  const imagemSalva = campos.find((c) => c.name === "produto.imagem")?.value;
  console.info(`[erp-foto-sync] Validacao: produto.imagem="${imagemSalva}" esperado="${imageIdEsperado}"`);
  return imagemSalva === imageIdEsperado;
}

async function comprimirFotoParaErp(base64: string): Promise<Buffer> {
  const raw = base64.includes(";base64,") ? base64.split(";base64,")[1] : base64;
  const buffer = Buffer.from(raw, "base64");
  return sharp(buffer)
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
}

// --- Task definition ---

interface ErpFotoSyncItem {
  erpProdutoId: string;
  photoBase64: string;
  barcode: string;
}

interface ErpFotoSyncPayload {
  empresa: string;
  itens: ErpFotoSyncItem[];
}

interface ErpFotoSyncResult {
  empresa: string;
  total: number;
  sucesso: number;
  falha: number;
  detalhes: Array<{
    erpProdutoId: string;
    barcode: string;
    ok: boolean;
    imageId?: string;
    validado?: boolean;
    erro?: string;
  }>;
}

export const erpFotoSync = task({
  id: "erp-foto-sync",
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000 },
  run: async (payload: ErpFotoSyncPayload): Promise<ErpFotoSyncResult> => {
    const enabled = process.env.ERP_FOTO_SYNC_ENABLED === "true";
    if (!enabled) {
      console.info("[erp-foto-sync] Feature flag desabilitada. Pulando.");
      return { empresa: payload.empresa, total: payload.itens.length, sucesso: 0, falha: 0, detalhes: [] };
    }

    const empresa = normalizeEmpresa(payload.empresa);
    const origin = resolveOrigin(empresa);

    console.info(`[erp-foto-sync] Iniciando sync de ${payload.itens.length} foto(s) para ${empresa} — origin=${origin}`);

    const cookie = await loginErpWeb(origin, empresa);

    const result: ErpFotoSyncResult = {
      empresa,
      total: payload.itens.length,
      sucesso: 0,
      falha: 0,
      detalhes: [],
    };

    for (const item of payload.itens) {
      const detalhe: ErpFotoSyncResult["detalhes"][0] = {
        erpProdutoId: item.erpProdutoId,
        barcode: item.barcode,
        ok: false,
      };

      try {
        console.info(`[erp-foto-sync] === Produto ${item.erpProdutoId} (${item.barcode}) ===`);

        const { campos, formAction } = await lerFormularioProduto(origin, cookie, item.erpProdutoId);

        const imageBuffer = await comprimirFotoParaErp(item.photoBase64);
        console.info(`[erp-foto-sync] Foto comprimida: ${imageBuffer.length} bytes`);

        const filename = `produto_${item.barcode}.jpg`;
        const imageId = await uploadImagemErp(origin, cookie, imageBuffer, filename);
        console.info(`[erp-foto-sync] imageId=${imageId}`);
        detalhe.imageId = imageId;

        let saved = false;

        // Tentativa 1: form web (preferido, preserva todos os campos)
        try {
          const formBody = montarFormComImagem(campos, imageId);
          await salvarProdutoErp(origin, cookie, item.erpProdutoId, formAction, formBody);
          saved = true;
          console.info(`[erp-foto-sync] Save via form web OK`);
        } catch (formErr) {
          console.warn(`[erp-foto-sync] Form web falhou: ${formErr instanceof Error ? formErr.message : formErr}`);
        }

        // Tentativa 2: REST API PUT (fallback)
        if (!saved) {
          try {
            await salvarProdutoViaApi(empresa, item.erpProdutoId, imageId);
            saved = true;
            console.info(`[erp-foto-sync] Save via REST API OK`);
          } catch (apiErr) {
            throw new Error(`Ambas tentativas de save falharam. Form: 500. API: ${apiErr instanceof Error ? apiErr.message : apiErr}`);
          }
        }

        const validado = await validarImagemSalva(origin, cookie, item.erpProdutoId, imageId);
        detalhe.validado = validado;

        if (!validado) {
          console.warn(`[erp-foto-sync] AVISO: validacao falhou para produtoId=${item.erpProdutoId}`);
        }

        detalhe.ok = true;
        result.sucesso += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[erp-foto-sync] ERRO produtoId=${item.erpProdutoId}: ${msg}`);
        detalhe.erro = msg;
        result.falha += 1;
      }

      result.detalhes.push(detalhe);
    }

    console.info(`[erp-foto-sync] Concluido: ${result.sucesso} OK, ${result.falha} falha(s)`);
    return result;
  },
});
