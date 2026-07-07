-- =====================================================================
-- PILOTO COMPRAS no Supabase (substitui o ClickUp como banco)
-- Rode TUDO de uma vez no SQL Editor do Studio (https://db.newgrup.cloud).
-- Idempotente: pode rodar de novo sem quebrar.
-- =====================================================================

-- 1) USUARIOS — perfil/comprador (hoje vive no localStorage: scan_newshop_login)
create table if not exists public.usuarios (
  id             uuid primary key default gen_random_uuid(),
  empresa        text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  flag           text not null default 'loja',
  role           text not null default 'operador',
  nome           text,
  secoes_compras jsonb not null default '[]'::jsonb,  -- ["Eletronico","Papelaria"]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2) COMPRAS — itens de compra (substitui as tasks + o dedup do ClickUp)
create table if not exists public.compras (
  id            uuid primary key default gen_random_uuid(),
  empresa       text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  produto_key   text not null,                 -- COD:<numerico> | SKU:<sku>
  codigo        text not null,
  sku           text,
  descricao     text,
  secao         text,
  status        text not null default 'todo'
                check (status in ('todo','produto_bom','produto_ruim',
                                  'fazer_pedido','pedido_andamento',
                                  'compra_realizada','concluido')),
  vezes_pedido  integer not null default 1,
  foto_url      text,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- DEDUP NA ORIGEM: 1 linha por produto/empresa. Re-importar planilha vira UPSERT
  -- (soma vezes_pedido) em vez de criar duplicata -> mata o bug de "produto repetido".
  constraint compras_empresa_produto_key unique (empresa, produto_key)
);

create index if not exists compras_empresa_status_idx on public.compras (empresa, status);
create index if not exists compras_empresa_secao_idx  on public.compras (empresa, secao);

-- 3) updated_at automatico em qualquer UPDATE
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_usuarios_updated on public.usuarios;
create trigger trg_usuarios_updated before update on public.usuarios
  for each row execute function public.set_updated_at();

drop trigger if exists trg_compras_updated on public.compras;
create trigger trg_compras_updated before update on public.compras
  for each row execute function public.set_updated_at();

-- 4) REALTIME — o app assina mudancas de status da tabela compras (ao vivo)
alter table public.compras replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'compras'
  ) then
    execute 'alter publication supabase_realtime add table public.compras';
  end if;
end $$;

-- 5) RLS (seguranca por linha).
--    PILOTO: liberado para a chave anon, porque o app ainda NAO tem login no
--    Supabase (o login e local/localStorage). Sem policy, o RLS bloqueia tudo.
--    Quando adicionarmos auth de verdade, trocamos por regras por empresa/role.
alter table public.compras  enable row level security;
alter table public.usuarios enable row level security;

drop policy if exists compras_anon_all on public.compras;
create policy compras_anon_all on public.compras
  for all to anon, authenticated using (true) with check (true);

drop policy if exists usuarios_anon_all on public.usuarios;
create policy usuarios_anon_all on public.usuarios
  for all to anon, authenticated using (true) with check (true);
