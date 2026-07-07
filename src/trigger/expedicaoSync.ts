import { task } from "@trigger.dev/sdk/v3";

const EXPEDICAO_API_URL = "https://wvykzzbzwyrbggzxkypf.supabase.co/functions/v1/expedicao-integration";

// Newshop usa EXPEDICAO_API_KEY; Soye e Facil usam EXPEDICAO_API_KEY_SF
if (!process.env.EXPEDICAO_API_KEY) {
  console.warn("[expedicaoSync] EXPEDICAO_API_KEY nao configurada.");
}
if (!process.env.EXPEDICAO_API_KEY_SF) {
  console.warn("[expedicaoSync] EXPEDICAO_API_KEY_SF nao configurada — Soye/Facil serao ignorados.");
}

type LojaExpedicao = "NEWSHOP" | "SOYE" | "FACIL";

function getApiKey(empresa: string | undefined): string | undefined {
  const loja = (empresa ?? "NEWSHOP").toUpperCase() as LojaExpedicao;
  if (loja === "SOYE" || loja === "FACIL") {
    return process.env.EXPEDICAO_API_KEY_SF;
  }
  return process.env.EXPEDICAO_API_KEY;
}

interface ItemExpedicao {
  descricao: string;
  ean: string;
  quantidadeReal: number;
}

interface PayloadExpedicaoSync {
  itens: ItemExpedicao[];
  conferente?: string;
  empresa?: string;
  dataConferencia?: string;
}

export const expedicaoSync = task({
  id: "expedicao-sync",
  machine: "small-1x",
  maxDuration: 120,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000 },
  run: async (payload: PayloadExpedicaoSync) => {
    const lojaLabel = (payload.empresa ?? "NEWSHOP").toUpperCase();
    const apiKey = getApiKey(payload.empresa);

    if (!apiKey) {
      console.warn(`[expedicaoSync] API key ausente para loja=${lojaLabel}. Abortando sem erro.`);
      return { skipped: true };
    }

    if (!payload.itens || payload.itens.length === 0) {
      console.log("[expedicaoSync] Nenhum item para enviar.");
      return { enviado: false, motivo: "sem_itens" };
    }

    const itensApi = payload.itens.map((item) => ({
      descricao: item.descricao,
      ean: item.ean,
      quantidade: item.quantidadeReal,
    }));

    const dataFormatada = payload.dataConferencia
      ? new Date(payload.dataConferencia).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
      : new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });

    const body = {
      usuario: payload.conferente ?? "App Conferencia",
      descricao: `Conferencia ${lojaLabel} - ${dataFormatada}`,
      itens: itensApi,
    };

    console.log(`[expedicaoSync] Enviando ${itensApi.length} item(ns) [loja=${lojaLabel}]`);

    const response = await fetch(EXPEDICAO_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const responseText = await response.text();
    console.log(`[expedicaoSync] status=${response.status} body=${responseText}`);

    if (!response.ok) {
      throw new Error(`expedicao-integration retornou ${response.status}: ${responseText}`);
    }

    const result = JSON.parse(responseText);
    console.log(`[expedicaoSync] Expedicao criada: ${result?.result?.numeroFormatado ?? result?.result?.numero}`);
    return { enviado: true, expedicao: result?.result };
  },
});
