-- =====================================================================
-- PRODUTOS — tabela MESTRE (catalogo) de itens (a "ITEM" unica)
--
-- Ideia: cada produto existe UMA vez aqui, com as infos "fixas" (descricao, sku,
-- secao, foto). Todo lugar que usa o item (compras, pedido_itens, Dashboard) so
-- referencia por `produto_key` e puxa daqui. Menos duplicacao, fonte unica de
-- verdade, e reaproveita ao maximo os dados que ja existem.
--
-- Chave canonica `produto_key` = COD:<numerico 6-14> | SKU:<sku>  (mesma regra do
-- app em useProdutosComprar / comprasSupabase).
--
-- Opcao A (fotos): a mestre so guarda a URL que ja existe (Storage). Nao sobe blob
-- novo. Item sem foto aqui cai no fetch do ERP na tela, como hoje.
--
-- Idempotente. Depende de public.set_updated_at() (migration 002) e da tabela
-- compras (migrations 002/007).
-- =====================================================================

-- Deriva a produto_key canonica a partir de codigo/sku (espelha a regra do app).
create or replace function public.produto_key_de(p_codigo text, p_sku text)
returns text language sql immutable as $$
  select case
    when substring(upper(coalesce(p_codigo, '')) from '\d{6,14}') is not null
      then 'COD:' || substring(upper(coalesce(p_codigo, '')) from '\d{6,14}')
    when nullif(btrim(upper(coalesce(p_sku, ''))), '') is not null
      then 'SKU:' || btrim(upper(coalesce(p_sku, '')))
    else ''
  end
$$;

create table if not exists public.produtos (
  produto_key text primary key,   -- COD:<numerico> | SKU:<sku>
  codigo      text,
  sku         text,
  descricao   text,
  secao       text,
  foto_url    text,               -- URL (Storage/ERP) — nunca blob
  erp_id      text,               -- id no Varejo Facil, quando conhecido
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists produtos_codigo_idx on public.produtos (codigo);

drop trigger if exists trg_produtos_updated on public.produtos;
create trigger trg_produtos_updated before update on public.produtos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Backfill: popula a mestre com o que JA existe em compras (uma linha por
-- produto_key, preferindo a que tem foto/descricao). Idempotente (re-rodar so
-- completa campos ainda vazios).
-- ---------------------------------------------------------------------
insert into public.produtos (produto_key, codigo, sku, descricao, secao, foto_url)
select distinct on (produto_key)
  produto_key, codigo, sku, descricao, secao, foto_url
from public.compras
where coalesce(produto_key, '') <> ''
order by produto_key,
         (foto_url  is not null) desc,
         (descricao is not null) desc,
         updated_at desc
on conflict (produto_key) do update set
  codigo     = coalesce(public.produtos.codigo,    excluded.codigo),
  sku        = coalesce(public.produtos.sku,       excluded.sku),
  descricao  = coalesce(excluded.descricao,        public.produtos.descricao),
  secao      = coalesce(excluded.secao,            public.produtos.secao),
  foto_url   = coalesce(public.produtos.foto_url,  excluded.foto_url),
  updated_at = now();

-- ---------------------------------------------------------------------
-- RLS (piloto: liberado p/ anon, igual as outras tabelas).
-- ---------------------------------------------------------------------
alter table public.produtos enable row level security;
drop policy if exists produtos_anon_all on public.produtos;
create policy produtos_anon_all on public.produtos
  for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Repointa a frequencia do Dashboard para a MESTRE (foto + descricao canonicas),
-- por produto_key. Prioridade da foto: a que veio na conferencia (se URL) ->
-- senao a da mestre (que ja engloba compras).
-- (DROP antes: a nova coluna `descricao` entra no meio e o CREATE OR REPLACE nao
--  aceita reordenar colunas de uma view ja existente.)
-- ---------------------------------------------------------------------
drop view if exists public.dashboard_item_frequencia;
create or replace view public.dashboard_item_frequencia as
select
  p.empresa,
  p.flag,
  p.data_conferencia                                 as data,
  i.codigo,
  max(i.sku)                                         as sku,
  coalesce(max(i.secao), max(pr.secao))              as secao,
  max(pr.descricao)                                  as descricao,
  count(*)                                           as vezes,
  coalesce(sum(i.quantidade_pedida), 0)              as total_pedido,
  coalesce(sum(i.quantidade_real), 0)                as total_real,
  coalesce(max(i.foto_url), max(pr.foto_url))        as foto_url
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
left join public.produtos pr
  on pr.produto_key = public.produto_key_de(i.codigo, i.sku)
where p.status = 'concluido'
  and p.data_conferencia is not null
group by p.empresa, p.flag, p.data_conferencia, i.codigo;
