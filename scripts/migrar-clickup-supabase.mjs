#!/usr/bin/env node
/**
 * migrar-clickup-supabase.mjs
 * ETL da "Virada do Código": lê os dados vivos do ClickUp (conferência + compras)
 * e grava no Supabase (pedidos / pedido_itens / compras).
 *
 * SEGURO POR PADRÃO: roda em DRY-RUN (só lê o ClickUp, monta as linhas e imprime
 * contagens — NÃO grava nada). Para gravar de verdade passe --apply.
 *
 * Idempotente:
 *   - pedidos: chave de dedup = clickup_task_id (re-rodar atualiza, não duplica)
 *   - compras: chave de dedup = (empresa, produto_key) via upsert
 *
 * Uso:
 *   node scripts/migrar-clickup-supabase.mjs                 # dry-run tudo
 *   node scripts/migrar-clickup-supabase.mjs --only=conf     # só conferência
 *   node scripts/migrar-clickup-supabase.mjs --only=compras  # só compras
 *   node scripts/migrar-clickup-supabase.mjs --empresa=NEWSHOP
 *   node scripts/migrar-clickup-supabase.mjs --apply         # GRAVA no Supabase
 *
 * Variáveis de ambiente necessárias:
 *   CLICKUP_TOKEN_NEWSHOP   token ClickUp da NEWSHOP
 *   CLICKUP_TOKEN_SF        token ClickUp compartilhado SOYE+FACIL
 *   SUPABASE_URL            ex.: https://db.newgrup.cloud
 *   SUPABASE_SERVICE_ROLE_KEY   service_role (NÃO a anon)
 * Opcionais (sobrescrevem os List IDs padrão):
 *   CLICKUP_LIST_ID_CONF_<EMPRESA>, CLICKUP_LIST_ID_COMPRAS_<EMPRESA>
 */

import { createClient } from '@supabase/supabase-js';

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';
const EMPRESA_FILTER = (args.find((a) => a.startsWith('--empresa=')) || '').split('=')[1] || '';

// ── Config por empresa ────────────────────────────────────────────────────────
const EMPRESAS = ['NEWSHOP', 'SOYE', 'FACIL'];

const DEFAULT_LISTS = {
  NEWSHOP: { conferencia: '901325900510', compras: '901326684020' },
  SOYE:    { conferencia: '901326607319', compras: '901326695640' },
  FACIL:   { conferencia: '901326607320', compras: '901326695640' },
};

function tokenFor(empresa) {
  if (empresa === 'NEWSHOP') return process.env.CLICKUP_TOKEN_NEWSHOP || process.env.VITE_CLICKUP_TOKEN_NEWSHOP || '';
  return process.env.CLICKUP_TOKEN_SF || process.env.VITE_CLICKUP_TOKEN_SF || '';
}
function listId(empresa, lista) {
  const envKey = lista === 'conferencia'
    ? `CLICKUP_LIST_ID_CONF_${empresa}`
    : `CLICKUP_LIST_ID_COMPRAS_${empresa}`;
  return process.env[envKey] || DEFAULT_LISTS[empresa][lista];
}

// ── Helpers de texto (portados 1:1 de server/clickup/*) ───────────────────────
const normalizeText = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normalizeStatus = (v) => normalizeText(v).trim();

function extractCodigo(name) {
  const s = String(name ?? '').trim();
  const pipe = s.match(/COD:([^|]+)/i);
  if (pipe) return pipe[1].trim();
  const bar = s.match(/\d{6,14}/);
  if (bar) return bar[0].trim();
  const m = s.match(/nao_tem(?:_tudo)?_(\d+)/i);
  return m ? m[1] : s;
}
function extractSku(name) {
  const s = String(name ?? '').trim();
  const pipe = s.match(/SKU:([^|]+)/i);
  if (pipe) return pipe[1].trim();
  const m = s.match(/nao_tem(?:_tudo)?_\d+_([^_\s]+)/i);
  return m ? m[1] : null;
}
function extractDescricao(name) {
  const s = String(name ?? '').trim();
  const pipe = s.match(/DESC:([^|]+)/i);
  if (pipe) return pipe[1].trim();
  return s.replace(/^nao_tem_tudo_/i, '').replace(/^nao_tem_/i, '').trim();
}

// compras: status ClickUp -> status app (portado de _clickup.ts mapTaskStatus)
function mapCompraStatus(status) {
  const v = normalizeStatus(status);
  if (['pode ser que tem no galpao','ainda pode ter no cd','produto bom','like','bom','aprovado','analisado'].includes(v)) return 'produto_bom';
  if (['produtos ruim','produto ruim','dislike','deslike','ruim','reprovado'].includes(v)) return 'produto_ruim';
  if (['fazer pedido','pedido','comprar'].includes(v)) return 'fazer_pedido';
  if (['pedido em andamento','em andamento','pedido feito'].includes(v)) return 'pedido_andamento';
  if (['compra realizada','comprado'].includes(v)) return 'compra_realizada';
  if (['concluido','done','completed','complete'].includes(v)) return 'concluido';
  if (v === 'in progress') return 'fazer_pedido';
  return 'todo';
}

// tasks de relatório diário NÃO são pedidos (status próprio "relatorio" ou nome "Relatorio - ...")
function isRelatorioTask(task) {
  const st = normalizeStatus(task?.status?.status);
  return st === 'relatorio' || /^relat[oó]rio\b/i.test(String(task?.name ?? '').trim());
}

// conferência: status ClickUp da task -> status do pedido (migration 009)
// NOTA: o app novo não usa pedido 'pendente' (a fila de conferência só lê
// 'analisado'/'em_andamento'). Um pedido feito no ClickUp — inclusive "to do" —
// deve ir DIRETO pra conferência, então tudo que não é concluído/andamento vira
// 'analisado' (decisão do usuário 2026-07-11).
function mapPedidoStatus(task) {
  const v = normalizeStatus(task?.status?.status);
  const temTag = Array.isArray(task?.tags) && task.tags.some((t) => normalizeText(t?.name ?? t).includes('andamento'));
  if (['complete','completed','concluido','done'].includes(v)) return 'concluido';
  if (temTag) return 'em_andamento';
  return 'analisado';
}

// item de conferência: status texto -> enum pedido_itens (migration 009)
function mapItemStatus(value) {
  const t = normalizeText(value);
  if (t.includes('parcial') || t.includes('nao tem tudo')) return 'nao_tem_tudo';
  if (t.includes('nao tem')) return 'nao_tem';
  if (t.includes('pendente')) return 'pendente';
  return 'separado';
}

function extractConferente(task, description) {
  const fromDesc = description.match(/^Conferente:\s*(.+)$/im)?.[1]?.trim();
  if (fromDesc) return fromDesc;
  return String(task?.name ?? '').replace(/^[^\wÀ-ÿ]+/u, '').split(/[—-]/)[0].trim() || 'Sem conferente';
}
function extractListeiro(description) {
  return description.match(/^Listeiro:\s*(.+)$/im)?.[1]?.trim() || null;
}
function extractResumoValue(description, label) {
  const labelNorm = normalizeText(label);
  const line = description.split(/\r?\n/).find((l) => normalizeText(l).includes(labelNorm));
  const value = line?.match(/:\s*(\d+)/)?.[1];
  return value ? Number(value) : 0;
}

// data de conferência (dateKey YYYY-MM-DD) a partir de texto/timestamp
function extractDateKeyFromText(v) {
  const m = String(v ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function formatDateKey(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ts));
  const val = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${val('year')}-${val('month')}-${val('day')}`;
}
function taskDateKey(task, description) {
  const ts = Number(task?.date_done || task?.date_closed || task?.date_updated || task?.date_created || 0);
  return extractDateKeyFromText(description)
    || extractDateKeyFromText(task?.name)
    || (ts ? formatDateKey(ts) : null);
}

// parse dos itens da description (fallback quando não há JSON anexado)
function parseConferenceItems(description) {
  const items = [];
  let secao = 'Sem categoria';
  for (const rawLine of String(description ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === '{S}' || line === '{M}' || normalizeText(line) === 'sem categoria') {
      secao = normalizeText(line) === 'sem categoria' ? 'Sem categoria' : line;
      continue;
    }
    const secaoMatch = line.match(/^Se[cç][aã]o:\s*(.+)$/i);
    if (secaoMatch?.[1]) { secao = secaoMatch[1].trim(); continue; }
    const m = line.match(/Codigo:\s*([^|]+)\|\s*SKU:\s*([^|]+)\|\s*Pedido:\s*(\d+)\s*\|\s*Real:\s*([^|]+)\|\s*(.+)$/i);
    if (!m) continue;
    const realText = m[4].trim();
    items.push({
      codigo: m[1].trim(),
      sku: m[2].trim(),
      secao,
      pedido: Number(m[3]),
      real: /^\d+$/.test(realText) ? Number(realText) : null,
      status: m[5],
      photo: null,
    });
  }
  return items;
}

// ── ClickUp API ───────────────────────────────────────────────────────────────
async function fetchTasksFromList(listId, token, includeClosed = true) {
  const all = [];
  for (let page = 0; page < 15; page++) {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task`
      + `?include_closed=${includeClosed ? 'true' : 'false'}&page=${page}&subtasks=false`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ClickUp ${res.status} lista ${listId} page ${page}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    all.push(...tasks);
    if (tasks.length < 100) break;
  }
  return all;
}

function isJsonAttachment(att) {
  const title = String(att?.title ?? att?.file_name ?? '').toLowerCase();
  return title.endsWith('.json') || att?.mimetype === 'application/json';
}
const countPhotos = (j) => (Array.isArray(j?.items) ? j.items.filter((i) => typeof i?.photo === 'string' && i.photo.trim()).length : 0);

// baixa o JSON de conferência anexado à task (preferência sobre a description)
async function baixarConferenceJson(task) {
  const jsonAtts = (task.attachments ?? []).filter(isJsonAttachment);
  const parsedList = [];
  for (const att of jsonAtts) {
    if (!att?.url) continue;
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      parsedList.push(await res.json());
    } catch { /* ignora JSON inválido */ }
  }
  const typed = parsedList.filter((j) => j?.type === 'conference-file');
  const pool = typed.length ? typed : parsedList.filter((j) => Array.isArray(j?.items) && j.items.length);
  if (!pool.length) return null;
  pool.sort((a, b) => (countPhotos(b) - countPhotos(a)) || ((b.items?.length ?? 0) - (a.items?.length ?? 0)));
  return pool[0];
}

// ── Transformações (task ClickUp -> linhas Supabase) ──────────────────────────
async function pedidoFromTask(empresa, task) {
  const description = task.description ?? task.text_content ?? '';
  const jsonConf = await baixarConferenceJson(task);
  const rawItems = jsonConf?.items?.length ? jsonConf.items : parseConferenceItems(description);
  const conferente = extractConferente(task, description);
  const listeiro = extractListeiro(description);

  const itens = rawItems.map((it, idx) => ({
    codigo: String(it.codigo ?? '').trim(),
    sku: it.sku != null ? String(it.sku).trim() : null,
    descricao: it.descricao ?? null,
    secao: it.secao ?? null,
    quantidade_pedida: Number(it.pedido ?? it.quantidadePedida ?? 0) || 0,
    quantidade_real: (it.real === null || it.real === undefined) ? null : Number(it.real),
    status: mapItemStatus(it.status),
    foto_url: typeof it.photo === 'string' && it.photo.trim() ? it.photo.trim() : null,
    ordem: idx,
  })).filter((it) => it.codigo);

  const status = mapPedidoStatus(task);
  const pedido = {
    empresa,
    flag: 'loja',
    titulo: task.name ?? null,
    pessoa: listeiro,
    listeiro,
    conferente,
    status,
    data_conferencia: status === 'concluido' ? taskDateKey(task, description) : null,
    total_itens: itens.length,
    resumo_separado: extractResumoValue(description, 'separado'),
    resumo_nao_tem: extractResumoValue(description, 'nao tem'),
    resumo_parcial: extractResumoValue(description, 'parcial'),
    resumo_pendente: extractResumoValue(description, 'pendente'),
    tags: (task.tags ?? []).map((t) => String(t?.name ?? t ?? '')).filter(Boolean),
    clickup_task_id: String(task.id),
  };
  return { pedido, itens };
}

function compraFromTask(empresa, task) {
  const codigo = extractCodigo(task.name);
  const sku = extractSku(task.name);
  const produto_key = /^\d{6,14}$/.test(codigo) ? `COD:${codigo}` : (sku ? `SKU:${sku}` : `COD:${codigo}`);
  const foto = task.attachments?.find((a) => !isJsonAttachment(a))?.url ?? null;
  return {
    empresa,
    produto_key,
    codigo,
    sku,
    descricao: extractDescricao(task.name),
    secao: null,
    status: mapCompraStatus(task.status?.status),
    vezes_pedido: 1,
    foto_url: foto,
    tags: (task.tags ?? []).map((t) => String(t?.name ?? t ?? '')).filter(Boolean),
  };
}

// ── Supabase (só quando --apply) ──────────────────────────────────────────────
function makeSupabase() {
  // RLS de db.newgrup.cloud permite CRUD com a anon key (o próprio app grava assim),
  // então service_role é opcional — usa se existir, senão cai na anon.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Faltam SUPABASE_URL e uma key (SERVICE_ROLE ou ANON) para gravar (--apply).');
  return createClient(url, key, { auth: { persistSession: false } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      // só re-tenta erro de rede/transiente; erro de validação/constraint não adianta
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|network|socket|timeout|EAI_AGAIN|503|429/i.test(msg)) throw e;
      if (i < tries) await sleep(300 * i * i); // backoff: 0.3s, 1.2s, 2.7s
    }
  }
  throw lastErr;
}

async function upsertPedido(sb, pedido, itens) {
  // dedup por clickup_task_id: se já existe, atualiza e regrava itens
  const { data: existing, error: selErr } = await sb
    .from('pedidos').select('id').eq('clickup_task_id', pedido.clickup_task_id).maybeSingle();
  if (selErr) throw selErr;

  let pedidoId;
  if (existing?.id) {
    pedidoId = existing.id;
    const { error } = await sb.from('pedidos').update(pedido).eq('id', pedidoId);
    if (error) throw error;
    const { error: delErr } = await sb.from('pedido_itens').delete().eq('pedido_id', pedidoId);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await sb.from('pedidos').insert(pedido).select('id').single();
    if (error) throw error;
    pedidoId = data.id;
  }
  if (itens.length) {
    const rows = itens.map((it) => ({ ...it, pedido_id: pedidoId }));
    const { error } = await sb.from('pedido_itens').insert(rows);
    if (error) throw error;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const empresas = EMPRESA_FILTER ? [EMPRESA_FILTER.toUpperCase()] : EMPRESAS;
  const doConf = ONLY === 'all' || ONLY === 'conf';
  const doCompras = ONLY === 'all' || ONLY === 'compras';

  console.log(`\n=== Migração ClickUp → Supabase ===`);
  console.log(`Modo: ${APPLY ? '🔴 APPLY (grava no Supabase)' : '🟢 DRY-RUN (não grava nada)'}`);
  console.log(`Empresas: ${empresas.join(', ')} | Escopo: ${ONLY}\n`);

  const sb = APPLY ? makeSupabase() : null;
  const totais = { pedidos: 0, itens: 0, compras: 0, erros: 0 };

  for (const empresa of empresas) {
    const token = tokenFor(empresa);
    if (!token) { console.warn(`[${empresa}] sem token ClickUp — pulando.`); continue; }

    if (doConf) {
      let tasks;
      try {
        tasks = await fetchTasksFromList(listId(empresa, 'conferencia'), token, true);
      } catch (e) {
        totais.erros++;
        console.error(`[${empresa}] conferência FALHOU ao ler ClickUp: ${e.message} — pulando empresa.`);
        continue;
      }
      const relatorios = tasks.filter(isRelatorioTask).length;
      const pedidosTasks = tasks.filter((t) => !isRelatorioTask(t));
      console.log(`[${empresa}] conferência: ${tasks.length} tasks (${pedidosTasks.length} pedidos, ${relatorios} relatórios ignorados)`);
      for (const task of pedidosTasks) {
        try {
          const { pedido, itens } = await withRetry(() => pedidoFromTask(empresa, task), `read ${task.id}`);
          totais.pedidos++; totais.itens += itens.length;
          if (APPLY) await withRetry(() => upsertPedido(sb, pedido, itens), `upsert ${task.id}`);
          else console.log(`  · ${pedido.status.padEnd(12)} ${String(task.id).padEnd(10)} itens=${itens.length} ${pedido.conferente}`);
        } catch (e) { totais.erros++; console.error(`  ✗ task ${task.id}: ${e.message}`); }
      }
    }

    if (doCompras) {
      let tasks;
      try {
        tasks = await fetchTasksFromList(listId(empresa, 'compras'), token, true);
      } catch (e) {
        totais.erros++;
        console.error(`[${empresa}] compras FALHOU ao ler ClickUp: ${e.message} — pulando empresa.`);
        continue;
      }
      console.log(`[${empresa}] compras: ${tasks.length} tasks`);
      const rows = [];
      for (const task of tasks) {
        try { rows.push(compraFromTask(empresa, task)); }
        catch (e) { totais.erros++; console.error(`  ✗ compra ${task.id}: ${e.message}`); }
      }
      // dedup no lote por produto_key (soma vezes_pedido), espelhando o UNIQUE da tabela
      const byKey = new Map();
      for (const r of rows) {
        const cur = byKey.get(r.produto_key);
        if (cur) cur.vezes_pedido += 1; else byKey.set(r.produto_key, r);
      }
      const deduped = [...byKey.values()];
      totais.compras += deduped.length;
      if (APPLY) {
        const { error } = await sb.from('compras').upsert(deduped, { onConflict: 'empresa,produto_key' });
        if (error) { totais.erros++; console.error(`  ✗ upsert compras ${empresa}: ${error.message}`); }
      } else {
        console.log(`  · ${deduped.length} produtos únicos (de ${rows.length} tasks)`);
      }
    }
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Pedidos: ${totais.pedidos} | Itens: ${totais.itens} | Compras: ${totais.compras} | Erros: ${totais.erros}`);
  console.log(APPLY ? '✅ Gravação concluída.' : 'ℹ️  Dry-run — nada foi gravado. Rode com --apply para gravar.');
  if (totais.erros) process.exitCode = 1;
}

main().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
