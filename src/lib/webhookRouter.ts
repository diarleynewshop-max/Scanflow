/**
 * webhookRouter.ts
 * Envia a lista escaneada para a fila de conferência no Supabase.
 */

import {
  dispararErpFotoSyncLista,
  enviarListaParaConferencia,
} from "./pedidosFila";

type ListFlag = "loja" | "cd";

export interface WebhookPayload {
  flag: ListFlag;
  empresa: string;
  pessoa: string;
  titulo: string;
  totalItens: number;
  dataCriacao: string;
  conferenceId?: string;
  produtos: Array<{
    barcode: string;
    sku: string;
    quantidade: number;
    removeTag: boolean;
    secao?: string | null;
    photo: string | null;
    erpProdutoId?: string;
    appPhotoWithoutErp?: boolean;
  }>;
}

export async function enviarListaParaSupabase(payload: WebhookPayload): Promise<void> {
  // Supabase e o unico destino do envio. Erro aqui PRECISA propagar — nao ha fallback.
  const fila = await enviarListaParaConferencia(payload);
  if (!fila) {
    throw new Error("Nao foi possivel gravar a lista no Supabase (verifique a configuracao).");
  }

  try {
    await dispararErpFotoSyncLista(payload);
  } catch (error) {
    console.error("[webhookRouter] Falha ao disparar erp-foto-sync (nao bloqueia envio):", error);
  }
}
