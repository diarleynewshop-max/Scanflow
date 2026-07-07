-- =====================================================================
-- PEDIDOS / CONFERENCIA / DASHBOARD no Supabase (substitui o ClickUp 100%)
--
-- Compras (produtos a comprar) ja vive no Supabase (migrations 002..008).
-- Falta o OUTRO lado, que ainda vive no ClickUp: os PEDIDOS de conferencia
-- (Meus Pedidos, Kanban Admin) e a DASHBOARD (relatorios diarios).
--
-- Fluxo de um pedido (espelha os status do ClickUp):
--   pendente     = "to do"            -> pedido chegou ao CD
--   analisado    = "analisado"        -> pronto para conferencia
--   em_andamento = tag "pedido em andamento" -> alguem esta conferindo (lock)
--   concluido    = "complete/concluido"      -> conferencia terminada
--
-- Rode TUDO de uma vez no SQL Editor do Studio (https://db.newgrup.cloud).
-- Idempotente: pode rodar de novo sem quebrar. Depende de public.set_updated_at()
-- (criada na migration 002).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PEDIDOS — a "lista"/task de conferencia (substitui a task do ClickUp)
--    Diferente de Compras, aqui NAO unificamos SOYE/FACIL: a Dashboard
--    separa as 3 empresas, entao guardamos NEWSHOP/SOYE/FACIL.
-- ---------------------------------------------------------------------
create table if not exists public.pedidos (
  id                 uuid primary key default gen_random_uuid(),
  empresa            text not null check (empresa in ('NEWSHOP','SOYE','FACIL')),
  flag               text not null default 'loja' check (flag in ('loja','cd')),
  titulo             text,
  pessoa             text,                 -- responsavel exibido em Meus Pedidos
  listeiro           text,                 -- quem montou a lista
  conferente         text,                 -- quem conferiu
  status             text not null default 'pendente'
                     check (status in ('pendente','analisado','em_andamento','concluido')),
  -- Lock de conferencia (equivale a tag "pedido em andamento" do ClickUp)
  em_conferencia_por text,
  em_conferencia_em  timestamptz,
  -- Dados da conferencia concluida (alimentam a Dashboard)
  data_conferencia   date,                 -- dia usado no agrupamento da Dashboard
  tempo_segundos     integer,              -- duracao da conferencia
  total_itens        integer not null default 0,
  resumo_separado    integer not null default 0,
  resumo_nao_tem     integer not null default 0,
  resumo_parcial     integer not null default 0,  -- "nao tem tudo"
  resumo_pendente    integer not null default 0,
  observacao         text,
  tags               text[] not null default '{}',
  -- Rastreio durante a migracao (some quando o ClickUp for cortado de vez)
  clickup_task_id    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  concluido_at       timestamptz
);

create index if not exists pedidos_empresa_flag_status_idx on public.pedidos (empresa, flag, status);
create index if not exists pedidos_data_conferencia_idx     on public.pedidos (empresa, flag, data_conferencia);
create index if not exists pedidos_pessoa_idx               on public.pedidos (empresa, flag, pessoa);
create index if not exists pedidos_clickup_task_id_idx      on public.pedidos (clickup_task_id);

-- ---------------------------------------------------------------------
-- 2) PEDIDO_ITENS — cada item conferido dentro de um pedido
--    status espelha o front (separado | nao_tem | nao_tem_tudo | pendente)
-- ---------------------------------------------------------------------
create table if not exists public.pedido_itens (
  id                 uuid primary key default gen_random_uuid(),
  pedido_id          uuid not null references public.pedidos (id) on delete cascade,
  codigo             text not null,
  sku                text,
  descricao          text,
  secao              text,
  quantidade_pedida  integer not null default 0,
  quantidade_real    integer,             -- null enquanto nao conferido
  status             text not null default 'pendente'
                     check (status in ('separado','nao_tem','nao_tem_tudo','pendente')),
  foto_url           text,
  ordem              integer,             -- ordem de exibicao dentro do pedido
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pedido_itens_pedido_idx  on public.pedido_itens (pedido_id);
create index if not exists pedido_itens_codigo_idx  on public.pedido_itens (codigo);
create index if not exists pedido_itens_status_idx  on public.pedido_itens (status);

-- ---------------------------------------------------------------------
-- 3) RELATORIOS_DIARIOS — snapshot da Dashboard por dia (substitui a task
--    "Relatorio - DD/MM/AAAA" + JSON anexado no ClickUp).
--    A regra D+1 (so gera do dia seguinte) fica no app; aqui so guardamos.
--    payload = JSON completo do relatorio (porConferente, porSecao, itens...).
-- ---------------------------------------------------------------------
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
  total_pedido       integer not null default 0,  -- unidades pedidas
  total_real         integer not null default 0,  -- unidades enviadas
  payload            jsonb not null default '{}'::jsonb,
  gerado_por         text,
  gerado_em          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint relatorios_diarios_unq unique (empresa, flag, data)
);

create index if not exists relatorios_diarios_empresa_flag_data_idx
  on public.relatorios_diarios (empresa, flag, data);

-- ---------------------------------------------------------------------
-- 4) updated_at automatico (reusa a funcao public.set_updated_at da 002)
-- ---------------------------------------------------------------------
drop trigger if exists trg_pedidos_updated on public.pedidos;
create trigger trg_pedidos_updated before update on public.pedidos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pedido_itens_updated on public.pedido_itens;
create trigger trg_pedido_itens_updated before update on public.pedido_itens
  for each row execute function public.set_updated_at();

drop trigger if exists trg_relatorios_diarios_updated on public.relatorios_diarios;
create trigger trg_relatorios_diarios_updated before update on public.relatorios_diarios
  for each row execute function public.set_updated_at();

-- Ao concluir, carimba concluido_at automaticamente.
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

-- ---------------------------------------------------------------------
-- 5) LOCK de conferencia (equivale a reservar a tag "pedido em andamento").
--    Retorna true se conseguiu reservar; false se ja esta com outra pessoa.
--    So permite reservar quem esta em 'analisado' (pronto p/ conferencia).
-- ---------------------------------------------------------------------
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

-- Libera a reserva (volta para 'analisado' sem perder os dados).
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

-- Recalcula total_itens + resumo do pedido a partir dos itens (chame apos
-- gravar/atualizar itens de uma conferencia).
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

-- ---------------------------------------------------------------------
-- 6) VIEWS da Dashboard — agregacao AO VIVO direto dos pedidos concluidos,
--    sem depender do snapshot. Facilita "Pedidos feitos / em andamento" e
--    os graficos por dia.
-- ---------------------------------------------------------------------

-- 6a) Resumo por dia (empresa/flag/data) — cards e graficos "por dia".
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

-- 6b) Frequencia de item no periodo (quantas vezes cada codigo apareceu,
--     unidades pedidas x enviadas) — alimenta a lista de itens e o Pareto.
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

-- 6c) Contadores de pedidos por status (KPIs "em andamento / feitos").
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

-- ---------------------------------------------------------------------
-- 7) REALTIME — o app assina pedidos e itens ao vivo (Kanban/Meus Pedidos).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 8) RLS — PILOTO: liberado para anon/authenticated (o login ainda e local,
--    igual as tabelas de Compras). Trocar por regras por empresa/role quando
--    houver auth de verdade no Supabase.
-- ---------------------------------------------------------------------
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
