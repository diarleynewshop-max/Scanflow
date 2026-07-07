-- =====================================================================
-- CONFERENCE_ID idempotente em pedidos + upsert do catalogo produtos
--
-- Resolve o risco CRITICO de duplicacao: o dual-write ao vivo grava o pedido
-- ANTES do ClickUp existir, entao clickup_task_id nasce null. Com conference_id
-- (estavel, vindo do app) o reenvio da MESMA conferencia vira UPSERT, nao duplica.
--
-- Regra operacional do backfill (script): so importar historico ATE o dia
-- anterior ao dual-write entrar no ar (--ate=YYYY-MM-DD), pra nao colidir com as
-- linhas ao vivo (que tem conference_id e task_id null).
--
-- Idempotente. Depende das migrations 009 e 012.
-- =====================================================================

alter table public.pedidos
  add column if not exists conference_id text;

-- Unico so quando preenchido: linhas do backfill (conference_id null) nao brigam.
create unique index if not exists pedidos_conference_id_unq
  on public.pedidos (conference_id)
  where conference_id is not null;

-- ---------------------------------------------------------------------
-- Upsert em lote no catalogo `produtos` (coalesce: nunca apaga campo ja
-- preenchido com null). Usado pelo dual-write da conferencia pra enriquecer o
-- catalogo com codigo/sku/secao/foto que aparecerem.
-- ---------------------------------------------------------------------
create or replace function public.upsert_produtos(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.produtos (produto_key, codigo, sku, descricao, secao, foto_url)
  select
    public.produto_key_de(x->>'codigo', x->>'sku'),
    nullif(x->>'codigo', ''),
    nullif(x->>'sku', ''),
    nullif(x->>'descricao', ''),
    nullif(x->>'secao', ''),
    nullif(x->>'foto_url', '')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) as x
  where public.produto_key_de(x->>'codigo', x->>'sku') <> ''
  on conflict (produto_key) do update set
    codigo     = coalesce(public.produtos.codigo,    excluded.codigo),
    sku        = coalesce(public.produtos.sku,       excluded.sku),
    descricao  = coalesce(excluded.descricao,        public.produtos.descricao),
    secao      = coalesce(excluded.secao,            public.produtos.secao),
    foto_url   = coalesce(public.produtos.foto_url,  excluded.foto_url),
    updated_at = now();
end $$;

grant execute on function public.upsert_produtos(jsonb)
  to anon, authenticated, service_role;
