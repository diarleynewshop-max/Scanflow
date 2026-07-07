import { query } from "@anthropic-ai/claude-agent-sdk";
import { schemaTask, logger } from "@trigger.dev/sdk/v3";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const ItemConferencia = z.object({
  codigo: z.string(),
  sku: z.string().optional(),
  secao: z.string().nullable().optional(),
  quantidadePedida: z.number(),
  quantidadeReal: z.number().nullable().optional(),
  status: z.string(),
});

export const analisarConferencia = schemaTask({
  id: "analisar-conferencia",
  machine: "small-2x",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000 },
  schema: z.object({
    conferente: z.string(),
    empresa: z.string().default("NEWSHOP"),
    itens: z.array(ItemConferencia),
    contexto: z.string().optional(),
  }),
  run: async ({ conferente, empresa, itens, contexto }, { signal }) => {
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort());

    const workDir = await mkdtemp(join(tmpdir(), "claude-scan-"));
    logger.info("Workspace criado", { workDir });

    try {
      const dadosJson = JSON.stringify({ conferente, empresa, itens }, null, 2);
      await writeFile(join(workDir, "conferencia.json"), dadosJson, "utf-8");

      const itensFaltantes = itens.filter(
        (i) => i.status === "nao_tem" || i.status === "nao_tem_tudo"
      );
      const itensSeparados = itens.filter((i) => i.status === "separado");

      const prompt = `Você é um assistente de análise de estoque para ${empresa}.

Analise os dados de conferência do conferente "${conferente}" disponíveis em conferencia.json.

Resumo rápido:
- Total de itens: ${itens.length}
- Separados: ${itensSeparados.length}
- Faltantes/parciais: ${itensFaltantes.length}
${contexto ? `\nContexto adicional: ${contexto}` : ""}

Tarefas:
1. Leia o arquivo conferencia.json
2. Identifique padrões nos itens faltantes (seções mais afetadas, códigos recorrentes)
3. Gere um arquivo "relatorio.md" com:
   - Resumo executivo (3-5 linhas)
   - Top seções com mais falta
   - Lista priorizada de itens para reposição imediata
   - Recomendações práticas
4. Gere um arquivo "compras.json" com array dos itens que precisam de reposição urgente

Seja direto e objetivo. Use português brasileiro.`;

      const result = query({
        prompt,
        options: {
          model: "claude-sonnet-4-20250514",
          abortController,
          cwd: workDir,
          maxTurns: 15,
          permissionMode: "acceptEdits",
          allowedTools: ["Read", "Write", "Edit", "Glob"],
        },
      });

      const mensagens: string[] = [];
      for await (const msg of result) {
        logger.info("Agent", { type: msg.type });
        if (msg.type === "assistant" && Array.isArray((msg as any).message?.content)) {
          for (const block of (msg as any).message.content) {
            if (block.type === "text") mensagens.push(block.text);
          }
        }
      }

      let relatorio = "";
      let compras: unknown[] = [];

      try {
        relatorio = await readFile(join(workDir, "relatorio.md"), "utf-8");
      } catch {
        relatorio = mensagens.join("\n\n");
      }

      try {
        const comprasRaw = await readFile(join(workDir, "compras.json"), "utf-8");
        compras = JSON.parse(comprasRaw);
      } catch {
        compras = itensFaltantes.map((i) => ({ codigo: i.codigo, sku: i.sku ?? "", secao: i.secao ?? null }));
      }

      logger.info("Análise concluída", {
        relatorioChars: relatorio.length,
        itensCompras: (compras as unknown[]).length,
      });

      return { relatorio, compras, mensagensAgente: mensagens };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  },
});
