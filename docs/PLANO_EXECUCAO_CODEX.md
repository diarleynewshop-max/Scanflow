# Plano de Execução — Claude planeja/revisa · Codex implementa

> Fonte de verdade da arquitetura: [ROADMAP_DASHBOARD_SUPABASE.md](./ROADMAP_DASHBOARD_SUPABASE.md).
> Este doc é o **contrato de trabalho** entre Claude (arquiteto/revisor) e Codex (implementador).
> Data-base: 2026-07-07.

---

## 1. Papéis

| Quem | Faz | NÃO faz |
|---|---|---|
| **Claude** | Quebra o roadmap em specs, define critério de aceite, **revisa cada diff** (correção, simplicidade, guardrails), decide a ordem, atualiza o roadmap. | Não escreve o código de produção das tasks (só specs e revisão). |
| **Codex** | Implementa **uma spec por vez**, roda build/lint, abre o diff pra revisão. | Não muda escopo, não inventa rota nova fora do combinado, não mexe em `erp-foto-sync`. |

**Loop por tarefa:** Claude escreve a spec → Codex implementa + `npm run build` → Claude
revisa o diff → ajustes → merge → Claude marca a fase no roadmap → próxima spec.

---

## 2. Guardrails (valem para TODA spec)

1. **Backend novo/migrado = Supabase Edge Function.** Nunca criar rota nova em `/api/*` na Vercel.
2. **Vercel = só frontend.** `/api/*` existente é legado a esvaziar, não a expandir.
   - **Exceção ERP 2026-07-08:** T7 foi revertida por decisão do usuário. `api/erp-proxy.ts`
     e `api/erp-image-proxy.ts` ficam na Vercel em produção; Supabase `erp-proxy`/
     `erp-image-proxy` é apenas fallback de DEV. Não migrar ERP de volta para Supabase.
3. **`erp-foto-sync` é intocável** — é a única task que fica no Trigger.dev.
4. **ClickUp foi removido do código (2026-07-07)** — não existe mais `clickupApi.ts`,
   `server/clickup/*`, `api/clickup-*` nem tasks Trigger de ClickUp. Nunca reintroduzir
   dependência dele; qualquer feature nova (Dashboard, Meus Pedidos) nasce 100% Supabase.
5. **Foto = só URL** (Storage/ERP). Nunca gravar blob/data-URL em `pedido_itens`.
6. **Best-effort não derruba fluxo:** integrações secundárias falham em silêncio (log), não quebram a conferência.
7. **Sempre** `npm run build` verde antes de entregar. Não commitar segredos/.env.
8. Arquivos < 500 linhas; ler antes de editar; não criar doc novo sem pedir.

---

## 3. Formato de handoff (Claude → Codex)

Cada spec segue este molde (Claude preenche, Codex executa):

```
### SPEC <id> — <título>
- Objetivo: <1 frase>
- Contexto: <por que, o que já existe>
- Arquivos a tocar: <lista>
- Passos: <numerados, concretos>
- Critério de aceite: <verificável — build, comportamento, dado no banco>
- Fora de escopo: <o que NÃO mexer>
- Riscos/atenção: <pontos frágeis>
```

Codex responde com: arquivos alterados, resultado do build, e dúvidas se travar.

---

## 4. Backlog em ordem de dependência

> **Prioridade nova (2026-07-07):** começar pelo **fluxo operacional** (Escanear → Fazer
> pedido → Fechar → Enviar pra conferência → Conferir → Fechar conferência), que é o que a
> loja usa todo dia. **Cutover = corte seco** (só Supabase; ClickUp sai do fluxo).
> Dashboard, Meus Pedidos e a validação de histórico ficam para DEPOIS (bloco T).
>
> A infra Supabase para isso **já existe** (migration 009): `pedidos` com status
> `pendente→analisado→em_andamento→concluido`, RPCs `reservar_pedido_conferencia`,
> `liberar_pedido_conferencia`, `recalcular_resumo_pedido`, `conference_id`, realtime, RLS.
> Falta só trocar o **write/read path** do app (hoje via Trigger→ClickUp).

### Bloco G — Fluxo operacional (PRIORIDADE, corte seco)

> **Ordem revisada (pós-G1):** o Supabase já é populado a cada envio (shadow, ClickUp ainda
> vivo). Por isso **G2 — remover ClickUp do envio — foi movida para DEPOIS de G3/G4**: só
> cega a fila do ClickUp quando a conferência já ler/fechar no Supabase.

| # | Tarefa | Depende de | Arquivos-alvo | Status |
|---|---|---|---|---|
| **G1** | Lib `pedidosFila.ts`: `enviarListaParaConferencia` insere `pedidos` (analisado) + `pedido_itens` (pendente) + `upsert_produtos`, `conference_id`; dispara `erp-foto-sync`. Integrado em `enviarParaClickUp` como shadow best-effort. | 009 | `src/lib/pedidosFila.ts`, `src/lib/webhookRouter.ts` | ✅ **feito** (rev. Claude: write best-effort, build+tsc verdes) |
| **G3** | `ConferenceView` lê a fila do Supabase: listar/reservar/carregar itens. | G1 | `src/components/ConferenceView.tsx`, `pedidosFila.ts` | ✅ **feito** (rev. Claude: removi bloco morto pós-`return`; desliguei botão "juntar" legado → G3.1) |
| **G3.1** | Reimplementar consolidação ("juntar pedidos mesmo nome") no Supabase (hoje desligada com `false &&`). | G3 | `ConferenceView.tsx`, `pedidosFila.ts` | adiada |
| **G4** | "Fechar conferência": **UPDATE** do pedido reservado → `concluido` (grava `quantidade_real`/status + `recalcular_resumo_pedido`), em vez de `enviarConferenciaParaClickUp`+INSERT. Dispara expedição direto. | G3 | `src/components/ConferenceView.tsx`, `pedidosFila.ts` | ✅ **feito** (Codex fez a lib `fecharConferenciaExistente`/`dispararExpedicaoConferencia`; Claude terminou a integração em `enviarClickUp` após o Codex parar sem limite) |
| **G2** | Remover ClickUp do envio: `ListHistory`/`enviarParaClickUp` deixa de disparar `lista-baixada`; Supabase vira o único destino. Ajustar textos "ClickUp". | G3, G4 | `src/components/ListHistory.tsx`, `src/lib/webhookRouter.ts` | ✅ **feito** (saiu de graça durante a limpeza total do ClickUp em 2026-07-07 — ver seção 8; `enviarListaParaSupabase` só chama Supabase) |
| **G5** | Teste ponta a ponta do loop (escanear→enviar→conferir→fechar) só no Supabase; realtime atualizando. | G1–G4 | — | **pendente — próxima ação, mas é teste manual, não spec de código** |

> **Achado de processo (2026-07-07):** `npm run build` = `vite build`, que NÃO type-checa
> (esbuild só transpila). E `npx tsc --noEmit` sozinho não checa nada porque o
> `tsconfig.json` raiz usa `"files": []` + project references. O comando que realmente
> type-checa é **`npx tsc -p tsconfig.app.json --noEmit`**. As revisões de G1/G3 relatadas
> como "tsc verde" na verdade não tinham rodado type-check nenhum — ao rodar o comando
> certo na G4, apareceram 2 erros reais (`enviarConferenciaParaClickUp`/`deletarTask` sem
> import, exatamente onde o Codex ficou sem limite) e 3 erros **pré-existentes**
> (não relacionados a este trabalho) em `ConferenceView.tsx` no `parseConferenceJson`
> (linhas ~548/649/835, `Property 'error' does not exist` — union sem narrowing) e outros
> em `DesktopShell.tsx`/`ErpDashboard.tsx`, fora do escopo do bloco G. **A partir de agora,
> todo critério de aceite de spec deve rodar `npx tsc -p tsconfig.app.json --noEmit`, não
> `tsc --noEmit` puro.**

### Bloco T — Dashboard / Meus Pedidos / limpeza (DEPOIS)

> **Reescrito em 2026-07-07** após o corte total do ClickUp (seção 8). T1/T2 (comparar/
> importar histórico do ClickUp) ficaram **obsoletas** — não sobrou nenhum código no app
> que fale com o ClickUp; não há mais como buscar esse histórico pela aplicação (só
> exportando manualmente pela UI do ClickUp, se algum dia for preciso). T5 (cortar ClickUp)
> **já está feito** — foi inteiro, não parcial como o plano original previa.

| # | Tarefa | Depende de | Status |
|---|---|---|---|
| ~~T1~~ | ~~Validar Dashboard Supabase × ClickUp~~ | — | **obsoleta** (ClickUp não existe mais no app) |
| ~~T2~~ | ~~Backfill do histórico do ClickUp~~ | — | **obsoleta** (idem) |
| **T3** | Reconstruir a página Dashboard lendo do Supabase (views `dashboard_*` já existem: `dashboard_diario`, `dashboard_semanal`, `dashboard_por_conferente`, `dashboard_por_secao`, `dashboard_item_frequencia`, `dashboard_pedidos_status`). Hoje a rota `/dashboard` mostra `EmManutencao`; a página antiga foi apagada (era código morto ClickUp). | G5 | **próxima após G5** |
| **T4** | Reconstruir "Meus Pedidos" lendo `pedidos`/`pedido_itens` do Supabase (realtime). Rota `/meus-pedidos` removida do menu; página apagada. | G5 | ✅ **feito** (2026-07-09, Codex): `MeusPedidos.tsx` focado no operador logado via `listarMeusPedidos(empresa, flag, nomeLogado)`, realtime + refresh manual; menu/sidebar/rota alinhados (`loja \|\| isPriv`); mantido `ProtectedRoute`. Rev. Claude ok |
| ~~T5~~ | ~~Cortar ClickUp do código~~ | — | ✅ **feito por completo** em 2026-07-07 (ver seção 8) |
| **T6** | `compras-erp-preload` (hoje cron no Trigger.dev) → pg_cron + Edge Function do Supabase | — | pendente |
| **T7** | `/api/erp-proxy` e `/api/erp-image-proxy` (Vercel) → Edge Function; esvaziar `api/` | — | **revertida em 2026-07-08** por decisão do usuário; ERP fica na Vercel em produção |
| **T8** | Limpar `trigger.config.ts`/env não usadas (sobra só `erp-foto-sync`, `expedicaoSync`, `comprasErpPreload` até T6) | T6 | pendente |
| **T9** | Verificação final de custo (Vercel Function Invocations, Trigger runs) | T7, T8 | pendente |
| **T10 (novo)** | Débito técnico da limpeza ClickUp: remover fisicamente o branch morto `fonte==='clickup'` em `Compras.tsx`/`useProdutosComprar.ts`/`comprasSupabase.ts`; renomear `enviarClickUp`/`getPayloadClickUp` em `ConferenceView.tsx` | — | **rename feito** (2026-07-09, Codex): `enviarClickUp`→`fecharConferencia`, `getPayloadClickUp`→`getPayloadConferencia` (4 ocorr.). Branch morto `fonte==='clickup'` **ainda pendente** |
| **T11 (novo)** | Validar/consertar auth do ERP na Vercel: confirmar `/api/erp-proxy` em produção retornando JSON do ERP, sem 401/404/HTML no caminho de scan; se 401, corrigir formato de auth nos 4 proxies mantendo paridade | T7 revertida | **feito em 2026-07-08**: `scanflow-alpha.vercel.app` retornou JSON 200 para NEWSHOP/FACIL/SOYE em `codigos-auxiliares?q=id==...`, `produtos/{id}`, `precos` e `estoque`; sem mudança de auth necessária. `npm run build` verde; `npx tsc -p tsconfig.app.json --noEmit` ainda falha por débitos fora do ERP |

**Guardrail de rollout:** mesmo em corte seco, cada G entra atrás de `npm run build` verde
e de um teste manual do loop antes de seguir pro próximo G.

---

## 8. Corte total do ClickUp (2026-07-07)

Por pedido explícito do usuário ("tudo que tenha clickup pode excluir vai ser Supabase no
lugar"), removi **todo** o código ClickUp da base numa varredura completa (não só o fluxo
operacional do bloco G) — isso é maior que o T5 original, que previa cortar só depois de
Dashboard/Meus Pedidos migrados. Decisão do usuário sobrepôs essa ordem.

**Deletado:** `src/lib/clickupApi.ts`, `clickupPhotosService.ts`, `useProductPhoto.ts`,
`ProductImage.tsx`, `test-cache.ts`; `server/clickup/*` (9 arquivos); `api/clickup-*.ts`
(9 arquivos) + limpeza do `vercel.json`; trigger tasks `index.ts`, `indexSF.ts`,
`relatorio.ts`, `analiseAutomatica.ts`, `supabaseCompras.ts`; páginas `MeusPedidos.tsx`,
`KanbanAdmin.tsx`, `RelatorioPessoas.tsx`, `ClickUp.tsx`, `ConferenciaGalpaoModal.tsx`,
`EditarPedentesModal.tsx`; `Dashboard.tsx` (já estava órfão, sem rota); scripts
`backfill-pedidos.mjs`, `setup-webhook.mjs`; entradas `CLICKUP_*`/`APP_BASE_URL`/
`CRON_SECRET` do `.env.example`.

**2 bugs reais encontrados e corrigidos** (chamavam endpoint ClickUp já deletado, sem
guarda de fonte — quebrariam em produção): botão "Importar Planilha" em `Compras.tsx`
(`/api/clickup-importar`) e o `useEffect` `carregarFotosClickUp` (`/api/clickup-compras-
proxy?action=buscar-foto`, rodava a cada render). Ambos removidos.

**Débito técnico registrado (T10):** `Compras.tsx`/`useProdutosComprar.ts` tiveram a fonte
forçada para `'supabase'` (toggle removido) mas o branch ClickUp interno não foi excisado
fisicamente (arquivo de 1700+ linhas, risco/tamanho); `comprasSupabase.ts` mantém funções
`*PorClickup` órfãs; `ConferenceView.tsx` mantém os nomes `enviarClickUp`/
`getPayloadClickUp` (só chamam Supabase agora, nome ficou desatualizado).

Build (`npm run build`) e type-check real (`npx tsc -p tsconfig.app.json --noEmit`) verdes
após a limpeza. 3 erros de tsc pré-existentes, não relacionados, seguem em
`ConferenceView.tsx` (`parseConferenceJson`) e `ErpLayout.tsx`/`ErpDashboard.tsx`
(lucide-react `LucideProps`).

---

## 5b. SPEC T4 — Reconstruir "Meus Pedidos" (Supabase, do zero)

- **Objetivo:** trazer de volta a página `/meus-pedidos` (removida na limpeza do ClickUp),
  agora lendo 100% do Supabase, sem nenhuma dependência de ClickUp. Tela onde a pessoa que
  fez a lista acompanha o status dos próprios pedidos (pendente → analisado → em_andamento
  → concluído).
- **Contexto:**
  - Rota e item de menu foram removidos: `App.tsx` não tem mais `/meus-pedidos`;
    `Home.tsx` (`baseMenuItems`) e `ErpLayout.tsx` (grupo "operacional", condição
    `flag === 'loja' || isPriv`) não têm mais o link "Meus Pedidos". Precisam voltar.
  - Schema já existe (migration 009): tabela `pedidos` (`empresa, flag, titulo, pessoa,
    listeiro, conferente, status, total_itens, resumo_separado, resumo_nao_tem,
    resumo_parcial, resumo_pendente, data_conferencia, concluido_at, created_at`) e
    `pedido_itens`. Realtime já habilitado (`supabase_realtime` publication).
  - `pedidosFila.ts` já exporta `EmpresaKey`, `FlagKey`, e tem o padrão de queries
    (`selectAll`/`supabase.from('pedidos')...`) a reutilizar — ver `listarPedidosParaConferencia`
    como referência de estilo (mas essa função filtra por status='analisado'/'em_andamento'
    para a fila de conferência; Meus Pedidos precisa de TODOS os status, filtrado por pessoa).
  - Login: `obterLoginSalvo()` de `@/hooks/useAuth` devolve `LoginData` com `empresa`,
    `flag`, `nomePessoa`, `role`.
- **Arquivos a tocar:**
  - `src/lib/pedidosFila.ts`: adicionar `listarMeusPedidos`.
  - criar `src/pages/MeusPedidos.tsx` (novo, do zero).
  - `src/App.tsx`: lazy-import + rota `/meus-pedidos` (reaproveitar o padrão de `/consulta-preco`,
    dentro de `DesktopShell`, sem `ProtectedRoute` — igual era antes).
  - `src/pages/Home.tsx`: devolver o item em `baseMenuItems` (`Icon: Package` — reimportar
    de `lucide-react` — `label: "Meus Pedidos"`, `path: "/meus-pedidos"`).
  - `src/components/ErpLayout.tsx`: devolver o item no grupo operacional com a mesma
    condição de antes (`...((flag === 'loja' || isPriv) ? [{ icon: Package, label: "Meus Pedidos", path: "/meus-pedidos" }] : [])`).
- **Passos:**
  1. Em `pedidosFila.ts`, adicionar:
     ```ts
     export interface MeuPedidoResumo {
       id: string;
       titulo: string;
       status: 'pendente' | 'analisado' | 'em_andamento' | 'concluido';
       totalItens: number;
       resumoSeparado: number;
       resumoNaoTem: number;
       resumoParcial: number;
       resumoPendente: number;
       dataConferencia: string | null;
       concluidoEm: string | null;
       createdAt: string;
     }

     export async function listarMeusPedidos(
       empresa: string, flag: string, pessoa: string
     ): Promise<MeuPedidoResumo[]> {
       if (!isSupabaseConfigured || !pessoa.trim()) return [];
       const { data, error } = await supabase
         .from('pedidos')
         .select('id,titulo,status,total_itens,resumo_separado,resumo_nao_tem,resumo_parcial,resumo_pendente,data_conferencia,concluido_at,created_at')
         .eq('empresa', normalizarEmpresa(empresa))
         .eq('flag', normalizarFlag(flag))
         .or(`pessoa.eq.${pessoa},listeiro.eq.${pessoa}`)
         .order('created_at', { ascending: false })
         .limit(50);
       if (error) throw error;
       return (data ?? []).map((p) => ({
         id: p.id, titulo: p.titulo ?? p.id, status: p.status,
         totalItens: p.total_itens ?? 0, resumoSeparado: p.resumo_separado ?? 0,
         resumoNaoTem: p.resumo_nao_tem ?? 0, resumoParcial: p.resumo_parcial ?? 0,
         resumoPendente: p.resumo_pendente ?? 0, dataConferencia: p.data_conferencia,
         concluidoEm: p.concluido_at, createdAt: p.created_at,
       }));
     }
     ```
     (ajustar tipos exatos ao estilo já usado no arquivo — `toInt`, etc. — se necessário).
  2. `src/pages/MeusPedidos.tsx`: componente simples, mobile-first (mesmo padrão visual
     das outras páginas — ver `ConsultaPreco.tsx` como referência de estrutura/estilo, é a
     página mais simples do repo). Ao montar: pega `obterLoginSalvo()`, chama
     `listarMeusPedidos(empresa, flag, nomePessoa)`. Mostra:
     - loading / vazio ("Nenhum pedido encontrado").
     - lista de cards: título, badge de status (Pendente=cinza / Analisado=azul /
       Em andamento=amarelo / Concluído=verde), total de itens.
     - quando `status === 'concluido'`: mostra o resumo (Separado/Não tem/Parcial/Pendente)
       e a data de conferência formatada.
     - botão "Atualizar" (refetch manual) + assinar realtime na tabela `pedidos`
       (`supabase.channel(...).on('postgres_changes', { event: '*', schema: 'public',
       table: 'pedidos' }, () => refetch())`) filtrado por empresa/flag no client (o filtro
       de `pessoa` fica só na query, não dá pra filtrar por OR no realtime facilmente —
       refetch geral é aceitável aqui, é uma tela de baixo tráfego).
  3. Religar rota, menu (`Home.tsx`) e sidebar desktop (`ErpLayout.tsx`) exatamente como
     estavam antes (mesmas condições de visibilidade).
  4. `npm run build` + `npx tsc -p tsconfig.app.json --noEmit` verdes.
- **Critério de aceite:** logar como operador, ir em "Meus Pedidos", ver os pedidos que essa
  pessoa enviou (campo `pessoa` ou `listeiro` bate com o nome do login) com status correto;
  fechar uma conferência em outra aba/sessão e ver o status atualizar (realtime ou pelo menos
  no refetch manual). Build/tsc verdes.
- **Fora de escopo:** não mostrar itens individuais do pedido (só o resumo) — é fast-follow;
  não reativar Dashboard (T3, spec separada); não mexer no fluxo de conferência (bloco G,
  já fechado).
- **Riscos/atenção:**
  - `pessoa`/`listeiro` no banco vêm de texto livre digitado no login — o match é por
    igualdade exata de string; se o nome tiver variação de maiúscula/espaço, o pedido não
    aparece. Não normalizar agora (fora de escopo), só documentar a limitação no código
    (comentário) se quiser.
  - Ícone `Package` foi removido do import de `lucide-react` em `Home.tsx`/`ErpLayout.tsx`
    durante a limpeza — precisa voltar ao import.

---

## 5. Estado / próxima ação

- **G1 ✅ feito e revisado.** Envio grava no Supabase (shadow best-effort) + dispara
  `erp-foto-sync`. Build e `tsc --noEmit` verdes. Falta 1 teste real (envio → conferir banco).
- **G4 ✅ feito.** Codex implementou a lib (`fecharConferenciaExistente`,
  `dispararExpedicaoConferencia`) mas ficou sem limite antes de religar `enviarClickUp`;
  Claude terminou a integração (ver diff em `ConferenceView.tsx`). Build + `tsc -p
  tsconfig.app.json --noEmit` (real) verdes, exceto os 3 erros pré-existentes já descritos.
- **SPEC ativa:** G2 (abaixo) — remover ClickUp do envio da lista.
- **Pendência acumulada:** G1, G3 e G4 ainda não tiveram teste de fumaça contra o Supabase
  real (só build/tipos). Recomendação: testar o loop completo (G5) antes de prosseguir pra
  G2, já que G2 é o corte que torna o ClickUp irrecuperável no envio.

---

## 6. Specs emitidas

### SPEC G4 — Fechar conferência no Supabase (UPDATE do pedido, sem ClickUp)

- **Objetivo:** o "enviar conferência" (`enviarClickUp` em `ConferenceView`) para de disparar
  `conferencia-baixada` (ClickUp) e passa a **concluir o pedido no Supabase**. Se a conferência
  veio da fila (tem pedido reservado) → **UPDATE** desse pedido para `concluido`. Se veio de
  arquivo importado (sem pedido) → **INSERT** de um pedido já concluído.
- **Contexto (código atual `src/components/ConferenceView.tsx`):**
  - `enviarClickUp` (~983–1055): chama `enviarConferenciaParaClickUp(getPayloadClickUp()+…)`,
    depois best-effort `enviarConferenciaParaSupabase(...)` (que **INSERTa** um pedido novo),
    marca enviado, limpa refs e deleta task de origem do ClickUp.
  - `getPayloadClickUp()` (~960–981) devolve `{ conferente, tempo, totalItens, resumo:
    getResumo(), itens: items.map(codigo, sku, secao, quantidadePedida, quantidadeReal,
    status, digito, photo) }`.
  - Refs já existem (postas na G3): `pedidoReservadoIdsRef.current` (pedido reservado nesta
    conferência) e `pedidoOrigemIdsRef.current`. `elapsedSeconds` tem o tempo.
- **Arquivos a tocar:**
  - `src/lib/pedidosFila.ts`: adicionar `fecharConferenciaExistente` (+ dispatch expedição).
  - `src/components/ConferenceView.tsx`: reescrever `enviarClickUp`.
- **Passos:**
  1. Em `pedidosFila.ts`, `fecharConferenciaExistente(pedidoId, dados)` onde `dados =
     { conferente, tempoSegundos, itens: ConferenceItemLike[] }`:
     - `delete from pedido_itens where pedido_id = pedidoId` e reinserir a partir de `itens`
       (mesmo mapeamento de status/qtd da G1, mas agora `quantidade_real = item.quantidadeReal`
       e `status = item.status`; `foto_url` só se `isStorageUrl`). Em lotes de 500.
     - `rpc('recalcular_resumo_pedido', { p_pedido_id: pedidoId })`.
     - `update pedidos set conferente, tempo_segundos, status='concluido' where id=pedidoId`
       (o trigger 009 carimba `concluido_at` e `data_conferencia`).
     - `upsert_produtos` best-effort (enriquece catálogo), igual G1.
  2. Em `ConferenceView.enviarClickUp` (renomear internamente para `fecharConferencia`,
     manter o handler ligado no mesmo botão):
     - `const pedidoId = pedidoReservadoIdsRef.current[0]`.
     - Se `pedidoId` → `await fecharConferenciaExistente(pedidoId, { conferente,
       tempoSegundos: elapsedSeconds, itens: items })`.
     - Se **não** houver `pedidoId` (conferência de arquivo importado) → manter o INSERT via
       `enviarConferenciaParaSupabase({ ...getPayloadClickUp(), empresa, flag, conferenceId,
       tempoSegundos: elapsedSeconds })` (o caminho que já existe).
     - **Remover** a chamada `enviarConferenciaParaClickUp` e o `deletarTask` de origem ClickUp.
     - Disparar expedição direto (ver passo 3). Ajustar textos ("Chegou no ClickUp" → "Conferência concluída").
     - Manter `marcarComoEnviado`/`limparRascunho`/`setSendStatus('sent')` e a limpeza das refs.
  3. Expedição: em `pedidosFila.ts`, `dispararExpedicaoSync({ empresa, conferente,
     dataConferencia, itens })` via Trigger REST (mesmo padrão de `dispararErpFotoSyncLista`),
     só para itens `separado`/`nao_tem_tudo` (mapeando `{ descricao: sku||codigo, ean: codigo,
     quantidadeReal }`). Best-effort (não derruba o fechamento). Chamar no fim de `fecharConferencia`.
  4. `npm run build` + `npx tsc --noEmit` verdes.
- **Critério de aceite:**
  - Fechar uma conferência aberta da fila: o MESMO pedido vira `status='concluido'` (não cria
    linha nova), `pedido_itens` refletem quantidade_real/status conferidos, `dashboard_diario`
    passa a somar aquele dia, `concluido_at`/`data_conferencia` preenchidos.
  - Fechar uma conferência de arquivo importado (sem pedido): cria 1 pedido concluído + itens.
  - Nenhuma chamada a ClickUp/`conferencia-baixada` no fluxo. Build/tsc verdes.
- **Fora de escopo:** não remover ainda `enviarConferenciaParaClickUp`/`clickupApi.ts` (bloco T);
  não migrar expedição para Edge Function ainda (fica REST do app por ora — bloco T).
  Não mexer no envio (G2). Consolidação segue desligada (G3.1).
- **Riscos/atenção:**
  - Idempotência: fechar 2x. Como o `delete+reinsert` é sobre o mesmo `pedidoId` e o status já
    fica `concluido`, proteger com o `jaFoiEnviado()`/`sendStatus==='sent'` que já existe.
  - Se `fecharConferenciaExistente` falhar no meio (após o delete), o pedido fica sem itens —
    envolver em try e, no catch, **não** marcar como enviado (deixa reprocessar). Avaliar fazer
    o reinsert antes de mudar o status (ordem: itens → recalcular → status).
  - `tempoSegundos`: usar `elapsedSeconds` direto (a coluna é `tempo_segundos`).

### SPEC G1 — Enviar lista para conferência gravando no Supabase

- **Objetivo:** o "enviar pra conferência" passa a criar a lista como um `pedidos`
  (status='analisado') + `pedido_itens` (pendentes) no Supabase, em vez de task no ClickUp.
  Entregável = nova lib + disparo de `erp-foto-sync`. Ainda NÃO mexer no `ListHistory` (isso
  é a G2) — só a lib e o teste unitário de fumaça.
- **Contexto:**
  - Hoje `ListHistory` monta um `WebhookPayload` (ver `src/lib/webhookRouter.ts`, tipo
    `WebhookPayload`: `{flag, empresa, pessoa, titulo, totalItens, dataCriacao, produtos[]}`,
    cada produto `{barcode, sku, quantidade, removeTag, secao, photo, erpProdutoId, appPhotoWithoutErp}`)
    e chama `enviarParaClickUp(payload)`.
  - A infra Supabase já existe: tabela `pedidos` (migration 009), RPC `upsert_produtos`
    (migration 013), `conference_id` único quando preenchido.
  - Padrão de escrita Supabase já existe em `src/lib/pedidosSupabase.ts`
    (`enviarConferenciaParaSupabase`): reusar cliente `supabase`, `isSupabaseConfigured`,
    helpers `hojeSaoPaulo`, `normalizarEmpresa`, `normalizarFlag`, `chunk`, `isStorageUrl`.
- **Arquivos a tocar:**
  - criar `src/lib/pedidosFila.ts`
  - (só se necessário p/ o dispatch) `src/lib/webhook.ts` — adicionar `dispararErpFotoSync`.
- **Passos:**
  1. `pedidosFila.ts` exporta `enviarListaParaConferencia(payload: WebhookPayload & { conferenceId?: string })`:
     - `conferenceId = payload.conferenceId ?? crypto.randomUUID()`.
     - INSERT em `pedidos`: `{ empresa: normalizarEmpresa, flag: normalizarFlag, titulo:
       payload.titulo, pessoa: payload.pessoa, listeiro: payload.pessoa, status:'analisado',
       total_itens: produtos.length, conference_id: conferenceId }`. `select('id').single()`.
     - INSERT em `pedido_itens` (em lotes de 500 via `chunk`): por produto →
       `{ pedido_id, codigo: barcode, sku, secao, quantidade_pedida: quantidade,
       quantidade_real: null, status:'pendente', foto_url: isStorageUrl(photo)?photo:null,
       ordem: index+1 }`. **Nunca gravar data-URL/base64 em `foto_url`.**
     - Chamar `supabase.rpc('recalcular_resumo_pedido', { p_pedido_id })`.
     - Chamar `supabase.rpc('upsert_produtos', { p: <array {codigo,sku,secao,descricao?}> })`
       (best-effort; log e segue se falhar).
     - Em erro após o INSERT do pedido, deletar o pedido (rollback), igual faz
       `enviarConferenciaParaSupabase`.
     - Retornar `{ pedidoId, conferenceId }`.
  2. **Foto → ERP:** para produtos com `appPhotoWithoutErp && erpProdutoId && photo`
     (base64), disparar `erp-foto-sync` via Trigger REST (mesmo padrão de
     `src/lib/webhook.ts` `dispararTask`): payload
     `{ empresa, itens:[{erpProdutoId, photoBase64: photo, barcode}] }`. Best-effort
     (não derruba o envio). Expor como `dispararErpFotoSync(...)` em `webhook.ts` e chamar
     dentro de `enviarListaParaConferencia`.
  3. `npm run build` verde.
- **Critério de aceite:**
  - `enviarListaParaConferencia` com 1 payload de teste cria 1 linha em `pedidos`
    (status='analisado', conference_id preenchido) + N em `pedido_itens` (status='pendente',
    quantidade_real null), e `dashboard_pedidos_status.analisados` sobe. `foto_url` nunca é base64.
  - Reenvio com o MESMO `conferenceId` NÃO duplica (índice único bloqueia — tratar o erro
    de conflito com mensagem clara).
  - Build verde.
- **Fora de escopo:** não editar `ListHistory` (G2), `ConferenceView` (G3/G4), nem remover
  `enviarParaClickUp` ainda. Não criar rota `/api/*`. Não mexer em `erp-foto-sync`.
- **Riscos/atenção:**
  - `crypto.randomUUID()` existe no browser moderno; se o build reclamar em contexto SSR,
    usar `globalThis.crypto`.
  - `quantidade` pode vir como `quantity` em algumas origens — no `WebhookPayload` é
    `quantidade`; manter esse contrato.
  - RLS anon já permite insert (migration 009). Não precisa de service role no front.

---

## 9. Bloco C — Compras: pendentes, galpão, bug de carga (2026-07-09)

> Origem: 6 pontos levantados pelo usuário. Itens 1/3 = Claude; 2/6 = Codex (feitos);
> 4/5 = specs abaixo (Codex implementa, Claude revisa). Fonte 100% Supabase.

| # | Tarefa | Quem | Status |
|---|---|---|---|
| **C0** | Bug "Compras não carrega nada" (NEWSHOP): filtro "Minhas seções" descartava item com `secao=null` (base recém-escaneada). Fix em `produtoCombinaSecao` (`Compras.tsx`): item sem seção passa a aparecer em "Minhas seções". | Claude | ✅ **feito** (build verde) |
| **C1** | Botão "Editar Pendentes" (juntar + esconder já atendidos) | Codex | ✅ **feito** (2026-07-09): `listarPendentesConsolidados` + `EditarPendentesModal`. Rev. Claude ok (regra `>` dia, formatos de data consistentes `date`↔`formatDateKeySaoPaulo`, paginação 1000+). Falta smoke test manual |
| **C2** | Botão "Conferência Galpão" (2ª revisão do que está em Compras) | Codex | ✅ **feito** (2026-07-09): `ConferenciaGalpaoModal` + `atualizarStatus` (otimista+revert). TEM→`produto_bom`, NÃO TEM→`fazer_pedido`. Rev. Claude ok. Falta smoke test manual |
| **C3** | `VITE_TRIGGER_API_KEY` faltando: sem ela a expedição (app do Rafael) e o `erp-foto-sync` não disparam (falha silenciosa). Documentar no `.env.example` e confirmar na Vercel. | Claude/usuário | doc feito; validar na Vercel |

### SPEC C1 — Botão "Editar Pendentes" (juntar + filtrar já atendidos)

- **Objetivo:** botão que consolida os itens pendentes e **esconde os que já foram
  atendidos em um pedido posterior** ao pedido atual.
- **Contexto:** modal antigo (`EditarPedentesModal`) apagado na limpeza do ClickUp (sem
  histórico no git). Fonte = Supabase (`pedidos`/`pedido_itens`). Produto identifica-se por
  `produto_key` (COD:/SKU:) — ver `produtoKey()` em `src/lib/comprasSupabase.ts`.
- **Regra de "já atendido" (confirmada pelo usuário):** um item `pendente` de um pedido do
  dia D só continua válido se o **mesmo `produto_key` NÃO tiver** nenhum `pedido_itens.status`
  ≠ `pendente` (`separado`/`nao_tem`/`nao_tem_tudo`) em pedidos com data **estritamente > D**
  (comparar por `data_conferencia`, ou `created_at` quando não houver conferência). Se teve
  status resolvido depois de D → já foi tratado → sai da lista.
- **Arquivos a tocar:** `src/lib/pedidosFila.ts` (nova `listarPendentesConsolidados(empresa,
  flag)`), novo `src/components/EditarPendentesModal.tsx`, ligar botão em `src/pages/Compras.tsx`.
- **Passos:** 1) buscar `pedido_itens.status='pendente'` (join no pedido p/ pegar data);
  2) para cada `produto_key`, buscar o status mais recente em pedidos de data > D;
  3) filtrar os que já foram resolvidos depois; 4) agrupar por `produto_key` (somar quantidade,
  1 card por produto); 5) `npm run build` + `npx tsc -p tsconfig.app.json --noEmit`.
- **Critério de aceite:** produto pendente do dia 10 que aparece `separado` num pedido do dia
  12 **não** aparece; produto que só existe pendente aparece 1× (consolidado). Build verde.
- **Fora de escopo:** não mexer no fluxo de conferência (bloco G); não criar rota `/api/*`.
- **Riscos:** comparar por `produto_key` normalizado (não `codigo` cru); usar `>` estrito no
  dia (não `>=`); paginação Supabase (default 1000 linhas) — buscar em lotes se preciso.

### SPEC C2 — Botão "Conferência Galpão" (2ª revisão do que está em Compras)

- **Objetivo:** tela/modal que lista **tudo que está em Compras** (`status in
  ('todo','fazer_pedido')`) para uma segunda passada no galpão, confirmando se o item
  realmente não tem, **antes** de virar pedido ao fornecedor.
- **Contexto:** modal antigo (`ConferenciaGalpaoModal`) apagado (sem histórico no git). Ler de
  `compras` (Supabase) por empresa do login. Reusar `fetchComprasSupabase` /
  `atualizarStatusPorId` de `src/lib/comprasSupabase.ts`; filtro de seção reusa
  `produtoCombinaSecao` de `Compras.tsx`.
- **Arquivos a tocar:** novo `src/components/ConferenciaGalpaoModal.tsx`, botão em
  `src/pages/Compras.tsx`.
- **Mapeamento de ações (TRAVADO 2026-07-09 pelo usuário):**
  - **"TEM" (achei no galpão)** → `produto_bom` (sai da fila de compra).
  - **"NÃO TEM" (confirmado)** → `fazer_pedido` (segue pro fornecedor).
- **Passos:** 1) listar itens em Compras (`status in ('todo','fazer_pedido')`, com
  foto/descrição/seção); 2) por item, dois botões: TEM → `atualizarStatusPorId(id,
  'produto_bom')`, NÃO TEM → `atualizarStatusPorId(id, 'fazer_pedido')`; 3) filtro por seção
  reusando `produtoCombinaSecao`; 4) `npm run build` + `npx tsc -p tsconfig.app.json --noEmit`.
- **Critério de aceite:** percorrer os itens e mudar status pelos 2 botões; mudança reflete
  em `compras` (realtime já assinado por `subscribeComprasSupabase`). Build verde.
- **Fora de escopo:** não gerar PDF de pedido aqui (fluxo próprio já existe em `Compras.tsx`).
- **Riscos:** update otimista + revert em erro (mesmo padrão de `executarAcao` em
  `useProdutosComprar.ts`); não remover a linha do banco, só mudar status.
