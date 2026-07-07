-- =====================================================================
-- SETUP COMPLETO — novo projeto Supabase (sknyigbnlbbpbbmsbbmc)
--
-- Script consolidado = migrations 002 a 013, na ordem certa, prontas pra
-- rodar de uma vez só no SQL Editor de um projeto Supabase VAZIO.
--
-- NAO inclui a migration 001 (lista_baixada_logs / conferencia_baixada_logs):
-- eram tabelas de analytics escritas pelas tasks antigas do ClickUp no
-- Trigger.dev, que já foram removidas do código. Nada mais grava nelas hoje.
--
-- Idempotente: pode rodar de novo sem quebrar (todas as migrations originais
-- já foram escritas assim). Rode tudo de uma vez, do início ao fim.
-- =====================================================================


-- #######################################################################
-- 002 — Piloto Compras (tabelas base: usuarios, compras, set_updated_at())
-- #######################################################################

create table if not exists public.usuarios (
  id             uuid primary key default gen_random_uuid(),
  empresa        text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  flag           text not null default 'loja',
  role           text not null default 'operador',
  nome           text,
  secoes_compras jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.compras (
  id            uuid primary key default gen_random_uuid(),
  empresa       text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  produto_key   text not null,
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
  constraint compras_empresa_produto_key unique (empresa, produto_key)
);

create index if not exists compras_empresa_status_idx on public.compras (empresa, status);
create index if not exists compras_empresa_secao_idx  on public.compras (empresa, secao);

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

alter table public.compras  enable row level security;
alter table public.usuarios enable row level security;

drop policy if exists compras_anon_all on public.compras;
create policy compras_anon_all on public.compras
  for all to anon, authenticated using (true) with check (true);

drop policy if exists usuarios_anon_all on public.usuarios;
create policy usuarios_anon_all on public.usuarios
  for all to anon, authenticated using (true) with check (true);


-- #######################################################################
-- 003 — clickup_task_id em compras (coluna legada, ainda referenciada por
-- código que faz SELECT * / SELECT explícito dessa coluna — manter)
-- #######################################################################

alter table public.compras add column if not exists clickup_task_id text;
create index if not exists compras_clickup_task_id_idx on public.compras (clickup_task_id);


-- #######################################################################
-- 004 — Unifica SOYE + FACIL em 'SF' (empresa única de compras)
-- Num banco vazio isso é inofensivo (não há linhas SOYE/FACIL pra mover);
-- só troca a constraint pra aceitar NEWSHOP/SF a partir daqui.
-- #######################################################################

begin;

alter table public.compras drop constraint if exists compras_empresa_check;

update public.compras set empresa = 'SF' where empresa = 'SOYE';

insert into public.compras
  (empresa, produto_key, codigo, sku, descricao, secao, status, vezes_pedido, foto_url, tags, clickup_task_id)
select 'SF', produto_key, codigo, sku, descricao, secao, status, vezes_pedido, foto_url, tags, clickup_task_id
  from public.compras
 where empresa = 'FACIL'
on conflict (empresa, produto_key) do nothing;

delete from public.compras where empresa = 'FACIL';

alter table public.compras
  add constraint compras_empresa_check check (empresa in ('NEWSHOP','SF'));

commit;


-- #######################################################################
-- 005 — Função registrar_item_compra (usada por integrações que registram
-- item de compra vindo de conferência)
-- #######################################################################

create or replace function public.registrar_item_compra(
  p_empresa         text,
  p_produto_key     text,
  p_codigo          text,
  p_sku             text,
  p_descricao       text,
  p_secao           text,
  p_clickup_task_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.compras
    (empresa, produto_key, codigo, sku, descricao, secao, status, vezes_pedido, clickup_task_id)
  values
    (p_empresa, p_produto_key, p_codigo, p_sku, p_descricao, p_secao, 'todo', 1, p_clickup_task_id)
  on conflict (empresa, produto_key) do update
    set vezes_pedido    = public.compras.vezes_pedido + 1,
        descricao       = coalesce(excluded.descricao, public.compras.descricao),
        secao           = coalesce(excluded.secao, public.compras.secao),
        clickup_task_id = coalesce(excluded.clickup_task_id, public.compras.clickup_task_id),
        updated_at      = now();
end $$;

grant execute on function public.registrar_item_compra(text, text, text, text, text, text, text)
  to anon, authenticated, service_role;


-- #######################################################################
-- 006 — Limpeza de linhas-lixo (não-produtos). Num banco vazio é um no-op.
-- #######################################################################

delete from public.compras
where produto_key !~ '^COD:[0-9]{6,14}$' and produto_key !~ '^SKU:';


-- #######################################################################
-- 007 — Bucket público de fotos de compras
-- #######################################################################

insert into storage.buckets (id, name, public)
values ('compras-fotos', 'compras-fotos', true)
on conflict (id) do nothing;

drop policy if exists compras_fotos_anon_all on storage.objects;
create policy compras_fotos_anon_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'compras-fotos')
  with check (bucket_id = 'compras-fotos');


-- #######################################################################
-- 008 — Lock de sincronização ERP (evita duas execuções simultâneas)
-- #######################################################################

alter table public.compras
  add column if not exists erp_sync_at timestamptz,
  add column if not exists erp_sync_error text;

create table if not exists public.compras_erp_sync_locks (
  lock_name text primary key,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.compras_erp_sync_locks enable row level security;

create or replace function public.compras_erp_sync_try_lock(
  p_lock_name text,
  p_ttl_minutes integer default 15
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  acquired boolean := false;
begin
  insert into public.compras_erp_sync_locks (lock_name, locked_until, updated_at)
  values (p_lock_name, now() + make_interval(mins => p_ttl_minutes), now())
  on conflict (lock_name) do update
    set locked_until = excluded.locked_until,
        updated_at = now()
    where public.compras_erp_sync_locks.locked_until < now()
  returning true into acquired;

  return coalesce(acquired, false);
end $$;

revoke all on function public.compras_erp_sync_try_lock(text, integer)
  from public;

grant execute on function public.compras_erp_sync_try_lock(text, integer)
  to service_role;


-- #######################################################################
-- 009 — PEDIDOS / CONFERÊNCIA / DASHBOARD (o núcleo do fluxo operacional:
-- Escanear → Fazer pedido → Enviar → Conferir → Fechar)
-- #######################################################################

create table if not exists public.pedidos (
  id                 uuid primary key default gen_random_uuid(),
  empresa            text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  flag               text not null default 'loja' check (flag in ('loja','cd')),
  titulo             text,
  pessoa             text,
  listeiro           text,
  conferente         text,
  status             text not null default 'pendente'
                     check (status in ('pendente','analisado','em_andamento','concluido')),
  em_conferencia_por text,
  em_conferencia_em  timestamptz,
  data_conferencia   date,
  tempo_segundos     integer,
  total_itens        integer not null default 0,
  resumo_separado    integer not null default 0,
  resumo_nao_tem     integer not null default 0,
  resumo_parcial     integer not null default 0,
  resumo_pendente    integer not null default 0,
  observacao         text,
  tags               text[] not null default '{}',
  clickup_task_id    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  concluido_at       timestamptz
);

create index if not exists pedidos_empresa_flag_status_idx on public.pedidos (empresa, flag, status);
create index if not exists pedidos_data_conferencia_idx     on public.pedidos (empresa, flag, data_conferencia);
create index if not exists pedidos_pessoa_idx               on public.pedidos (empresa, flag, pessoa);
create index if not exists pedidos_clickup_task_id_idx      on public.pedidos (clickup_task_id);

create table if not exists public.pedido_itens (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid not null references public.pedidos (id) on delete cascade,
  codigo             text not null,
  sku                text,
  descricao          text,
  secao              text,
  quantidade_pedida  integer not null default 0,
  quantidade_real    integer,
  status             text not null default 'pendente'
                     check (status in ('separado','nao_tem','nao_tem_tudo','pendente')),
  foto_url           text,
  ordem              integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pedido_itens_pedido_idx  on public.pedido_itens (pedido_id);
create index if not exists pedido_itens_codigo_idx  on public.pedido_itens (codigo);
create index if not exists pedido_itens_status_idx  on public.pedido_itens (status);

create table if not exists public.relatorios_diarios (
  id                 uuid primary key default gen_random_uuid(),
  empresa            text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  flag               text not null default 'loja' check (flag in ('loja','cd')),
  data               date not null,
  total_conferencias integer not null default 0,
  total_itens        integer not null default 0,
  resumo_separado    integer not null default 0,
  resumo_nao_tem     integer not null default 0,
  resumo_parcial     integer not null default 0,
  resumo_pendente    integer not null default 0,
  total_pedido       integer not null default 0,
  total_real         integer not null default 0,
  payload            jsonb not null default '{}'::jsonb,
  gerado_por         text,
  gerado_em          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint relatorios_diarios_unq unique (empresa, flag, data)
);

create index if not exists relatorios_diarios_empresa_flag_data_idx
  on public.relatorios_diarios (empresa, flag, data);

drop trigger if exists trg_pedidos_updated on public.pedidos;
create trigger trg_pedidos_updated before update on public.pedidos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pedido_itens_updated on public.pedido_itens;
create trigger trg_pedido_itens_updated before update on public.pedido_itens
  for each row execute function public.set_updated_at();

drop trigger if exists trg_relatorios_diarios_updated on public.relatorios_diarios;
create trigger trg_relatorios_diarios_updated before update on public.relatorios_diarios
  for each row execute function public.set_updated_at();

create or replace function public.pedidos_marca_conclusao()
returns trigger language plpgsql as $$
begin
  if new.status = 'concluido' and (old.status is distinct from 'concluido') then
    new.concluido_at := coalesce(new.concluido_at, now());
    new.data_conferencia := coalesce(new.data_conferencia, (now() at time zone 'America/Sao_Paulo')::date);
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_conclusao on public.pedidos;
create trigger trg_pedidos_conclusao before update on public.pedidos
  for each row execute function public.pedidos_marca_conclusao();

create or replace function public.reservar_pedido_conferencia(
  p_pedido_id uuid,
  p_pessoa    text,
  p_forcar    boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reservado boolean := false;
begin
  update public.pedidos
     set status = 'em_andamento',
         em_conferencia_por = p_pessoa,
         em_conferencia_em = now()
   where id = p_pedido_id
     and status in ('analisado','pendente')
     and (
       status <> 'em_andamento'
       or em_conferencia_por is null
       or em_conferencia_por = p_pessoa
       or p_forcar
     )
  returning true into reservado;

  return coalesce(reservado, false);
end $$;

grant execute on function public.reservar_pedido_conferencia(uuid, text, boolean)
  to anon, authenticated, service_role;

create or replace function public.liberar_pedido_conferencia(
  p_pedido_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pedidos
     set status = 'analisado',
         em_conferencia_por = null,
         em_conferencia_em = null
   where id = p_pedido_id
     and status = 'em_andamento';
end $$;

grant execute on function public.liberar_pedido_conferencia(uuid)
  to anon, authenticated, service_role;

create or replace function public.recalcular_resumo_pedido(
  p_pedido_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pedidos p
     set total_itens     = agg.total,
         resumo_separado = agg.separado,
         resumo_nao_tem  = agg.nao_tem,
         resumo_parcial  = agg.parcial,
         resumo_pendente = agg.pendente
    from (
      select
        count(*)                                             as total,
        count(*) filter (where status = 'separado')          as separado,
        count(*) filter (where status = 'nao_tem')           as nao_tem,
        count(*) filter (where status = 'nao_tem_tudo')      as parcial,
        count(*) filter (where status = 'pendente')          as pendente
      from public.pedido_itens
      where pedido_id = p_pedido_id
    ) agg
   where p.id = p_pedido_id;
end $$;

grant execute on function public.recalcular_resumo_pedido(uuid)
  to anon, authenticated, service_role;

create or replace view public.dashboard_diario as
select
  empresa,
  flag,
  data_conferencia                          as data,
  count(*)                                  as total_conferencias,
  coalesce(sum(total_itens), 0)             as total_itens,
  coalesce(sum(resumo_separado), 0)         as separado,
  coalesce(sum(resumo_nao_tem), 0)          as nao_tem,
  coalesce(sum(resumo_parcial), 0)          as parcial,
  coalesce(sum(resumo_pendente), 0)         as pendente
from public.pedidos
where status = 'concluido'
  and data_conferencia is not null
group by empresa, flag, data_conferencia;

create or replace view public.dashboard_item_frequencia as
select
  p.empresa,
  p.flag,
  p.data_conferencia                         as data,
  i.codigo,
  max(i.sku)                                 as sku,
  max(i.secao)                               as secao,
  count(*)                                   as vezes,
  coalesce(sum(i.quantidade_pedida), 0)      as total_pedido,
  coalesce(sum(i.quantidade_real), 0)        as total_real
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
where p.status = 'concluido'
  and p.data_conferencia is not null
group by p.empresa, p.flag, p.data_conferencia, i.codigo;

create or replace view public.dashboard_pedidos_status as
select
  empresa,
  flag,
  count(*) filter (where status = 'pendente')     as pendentes,
  count(*) filter (where status = 'analisado')    as analisados,
  count(*) filter (where status = 'em_andamento') as em_andamento,
  count(*) filter (where status = 'concluido')    as concluidos
from public.pedidos
group by empresa, flag;

alter table public.pedidos      replica identity full;
alter table public.pedido_itens replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
  ) then
    execute 'alter publication supabase_realtime add table public.pedidos';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedido_itens'
  ) then
    execute 'alter publication supabase_realtime add table public.pedido_itens';
  end if;
end $$;

alter table public.pedidos            enable row level security;
alter table public.pedido_itens       enable row level security;
alter table public.relatorios_diarios enable row level security;

drop policy if exists pedidos_anon_all on public.pedidos;
create policy pedidos_anon_all on public.pedidos
  for all to anon, authenticated using (true) with check (true);

drop policy if exists pedido_itens_anon_all on public.pedido_itens;
create policy pedido_itens_anon_all on public.pedido_itens
  for all to anon, authenticated using (true) with check (true);

drop policy if exists relatorios_diarios_anon_all on public.relatorios_diarios;
create policy relatorios_diarios_anon_all on public.relatorios_diarios
  for all to anon, authenticated using (true) with check (true);


-- #######################################################################
-- 010 — "Pedido feito" em compras (coluna + regra automática de status)
-- #######################################################################

alter table public.compras
  add column if not exists pedido_feito    smallint     not null default 0
    check (pedido_feito in (0, 1)),
  add column if not exists pedido_feito_em timestamptz;

create index if not exists compras_pedido_feito_idx
  on public.compras (empresa, pedido_feito);

create or replace function public.compras_aplica_pedido_feito()
returns trigger language plpgsql as $$
begin
  if new.pedido_feito = 1 then
    new.pedido_feito_em := coalesce(new.pedido_feito_em, now());
    if new.status not in ('compra_realizada', 'concluido') then
      new.status := 'pedido_andamento';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_compras_pedido_feito on public.compras;
create trigger trg_compras_pedido_feito
  before insert or update on public.compras
  for each row execute function public.compras_aplica_pedido_feito();


-- #######################################################################
-- 011 — Views extra do Dashboard (semana / conferente / seção)
-- #######################################################################

create or replace view public.dashboard_semanal as
select
  empresa,
  flag,
  date_trunc('week', data_conferencia)::date        as semana_inicio,
  count(*)                                           as total_conferencias,
  coalesce(sum(total_itens), 0)                      as total_itens,
  coalesce(sum(resumo_separado), 0)                  as separado,
  coalesce(sum(resumo_nao_tem), 0)                   as nao_tem,
  coalesce(sum(resumo_parcial), 0)                   as parcial,
  coalesce(sum(resumo_pendente), 0)                  as pendente
from public.pedidos
where status = 'concluido'
  and data_conferencia is not null
group by empresa, flag, date_trunc('week', data_conferencia);

create or replace view public.dashboard_por_conferente as
select
  empresa,
  flag,
  data_conferencia                                   as data,
  coalesce(nullif(conferente, ''), pessoa, 'Sem conferente') as conferente,
  count(*)                                           as conferencias,
  coalesce(sum(total_itens), 0)                      as total_itens,
  coalesce(sum(resumo_separado), 0)                  as separado,
  coalesce(sum(resumo_nao_tem), 0)                   as nao_tem,
  coalesce(sum(resumo_parcial), 0)                   as parcial,
  coalesce(sum(resumo_pendente), 0)                  as pendente,
  coalesce(sum(tempo_segundos), 0)                   as tempo_segundos
from public.pedidos
where status = 'concluido'
  and data_conferencia is not null
group by empresa, flag, data_conferencia,
         coalesce(nullif(conferente, ''), pessoa, 'Sem conferente');

create or replace view public.dashboard_por_secao as
select
  p.empresa,
  p.flag,
  p.data_conferencia                                 as data,
  coalesce(nullif(i.secao, ''), 'Sem categoria')     as secao,
  count(*)                                            as total,
  count(*) filter (where i.status = 'separado')       as separado,
  count(*) filter (where i.status = 'nao_tem')        as nao_tem,
  count(*) filter (where i.status = 'nao_tem_tudo')   as parcial,
  count(*) filter (where i.status = 'pendente')       as pendente,
  coalesce(sum(i.quantidade_pedida), 0)               as total_pedido,
  coalesce(sum(i.quantidade_real), 0)                 as total_real
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
where p.status = 'concluido'
  and p.data_conferencia is not null
group by p.empresa, p.flag, p.data_conferencia,
         coalesce(nullif(i.secao, ''), 'Sem categoria');

create or replace view public.dashboard_item_frequencia as
select
  p.empresa,
  p.flag,
  p.data_conferencia                                 as data,
  i.codigo,
  max(i.sku)                                         as sku,
  max(i.secao)                                       as secao,
  count(*)                                           as vezes,
  coalesce(sum(i.quantidade_pedida), 0)              as total_pedido,
  coalesce(sum(i.quantidade_real), 0)                as total_real,
  coalesce(
    max(i.foto_url),
    (select c.foto_url
       from public.compras c
      where c.codigo = i.codigo
        and c.foto_url is not null
      limit 1)
  )                                                  as foto_url
from public.pedido_itens i
join public.pedidos p on p.id = i.pedido_id
where p.status = 'concluido'
  and p.data_conferencia is not null
group by p.empresa, p.flag, p.data_conferencia, i.codigo;


-- #######################################################################
-- 012 — Tabela mestre PRODUTOS (catálogo único) + repointa dashboard_item_frequencia
-- #######################################################################

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
  produto_key text primary key,
  codigo      text,
  sku         text,
  descricao   text,
  secao       text,
  foto_url    text,
  erp_id      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists produtos_codigo_idx on public.produtos (codigo);

drop trigger if exists trg_produtos_updated on public.produtos;
create trigger trg_produtos_updated before update on public.produtos
  for each row execute function public.set_updated_at();

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

alter table public.produtos enable row level security;
drop policy if exists produtos_anon_all on public.produtos;
create policy produtos_anon_all on public.produtos
  for all to anon, authenticated using (true) with check (true);

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


-- #######################################################################
-- 013 — conference_id idempotente em pedidos + upsert_produtos em lote
-- #######################################################################

alter table public.pedidos
  add column if not exists conference_id text;

create unique index if not exists pedidos_conference_id_unq
  on public.pedidos (conference_id)
  where conference_id is not null;

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


-- #######################################################################
-- VERIFICAÇÃO — rode isto depois pra confirmar que tudo subiu certo
-- #######################################################################

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('usuarios','compras','compras_erp_sync_locks',
                      'pedidos','pedido_itens','relatorios_diarios','produtos')
order by table_name;
-- Esperado: 7 linhas (as 7 tabelas acima).
