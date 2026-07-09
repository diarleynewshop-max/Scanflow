// Migra os dados de Compras + Dashboard de uma base Supabase para outra.
//
// Copia as tabelas-fonte (as views dashboard_* sao recriadas pelo
// SETUP_NOVO_SUPABASE.sql no destino, entao NAO precisam ser copiadas).
// Idempotente: copia o `id` de cada linha e faz upsert (merge-duplicates),
// entao rodar de novo nao duplica. A ordem respeita as FKs (pedidos antes de
// pedido_itens).
//
// PRE-REQUISITO: rodar migrations/SETUP_NOVO_SUPABASE.sql no projeto DESTINO
// (schema vazio) ANTES de rodar este script.
//
// Uso (PowerShell):
//   $env:SRC_URL="https://db.newgrup.cloud"
//   $env:SRC_KEY="<anon ou service_role da ORIGEM>"
//   $env:DST_URL="https://sknyigbnlbbpbbmsbbmc.supabase.co"
//   $env:DST_KEY="<service_role do DESTINO>"
//   node scripts/migrar-base.mjs
//
// Dry-run (so conta, nao escreve):  adicione  $env:DRY_RUN="1"

const SRC_URL = (process.env.SRC_URL || '').replace(/\/$/, '');
const SRC_KEY = process.env.SRC_KEY || '';
const DST_URL = (process.env.DST_URL || '').replace(/\/$/, '');
const DST_KEY = process.env.DST_KEY || '';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SRC_URL || !SRC_KEY || !DST_URL || !DST_KEY) {
  console.error('Faltam variaveis: SRC_URL, SRC_KEY, DST_URL, DST_KEY.');
  process.exit(1);
}

// Ordem importa: pais antes de filhas (FK). pedido_itens.pedido_id -> pedidos.id
const TABELAS = [
  'usuarios',
  'produtos',
  'compras',
  'pedidos',
  'pedido_itens',
  'relatorios_diarios',
];

const PAGE = 1000;   // leitura paginada (limite padrao do PostgREST)
const CHUNK = 500;   // insercao em lotes

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function lerTudo(tabela) {
  const linhas = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const res = await fetch(`${SRC_URL}/rest/v1/${tabela}?select=*`, {
      headers: headers(SRC_KEY, { Range: `${from}-${to}`, 'Range-Unit': 'items' }),
    });
    if (res.status === 404) {
      console.warn(`  (origem nao tem a tabela ${tabela}, pulando)`);
      return null;
    }
    if (!res.ok) {
      throw new Error(`Ler ${tabela} falhou: ${res.status} ${await res.text()}`);
    }
    const lote = await res.json();
    linhas.push(...lote);
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return linhas;
}

async function inserirLote(tabela, lote) {
  const res = await fetch(`${DST_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: headers(DST_KEY, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(lote),
  });
  if (!res.ok) {
    throw new Error(`Inserir em ${tabela} falhou: ${res.status} ${await res.text()}`);
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function migrar() {
  console.log(`Origem : ${SRC_URL}`);
  console.log(`Destino: ${DST_URL}${DRY_RUN ? '  [DRY-RUN]' : ''}\n`);

  for (const tabela of TABELAS) {
    process.stdout.write(`• ${tabela}: lendo... `);
    const linhas = await lerTudo(tabela);
    if (linhas === null) continue;
    process.stdout.write(`${linhas.length} linha(s). `);

    if (linhas.length === 0) {
      console.log('nada a copiar.');
      continue;
    }
    if (DRY_RUN) {
      console.log('(dry-run, nao escreveu)');
      continue;
    }

    let feitas = 0;
    for (const lote of chunk(linhas, CHUNK)) {
      await inserirLote(tabela, lote);
      feitas += lote.length;
      process.stdout.write(`\r• ${tabela}: ${feitas}/${linhas.length} copiadas.   `);
    }
    console.log('\r• ' + tabela + `: ${feitas}/${linhas.length} copiadas. ✔        `);
  }

  console.log('\nMigracao concluida.');
}

migrar().catch((err) => {
  console.error('\nERRO:', err.message);
  process.exit(1);
});
