-- 014 - Login de usuarios reais via Supabase RPC.
-- Mantem compatibilidade com a tabela public.usuarios criada no piloto de compras.

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  login text,
  nome text,
  senha_hash text,
  role text not null default 'operador',
  empresas text[] not null default '{}',
  flag_default text not null default 'loja',
  secoes_compras text[] not null default '{}',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'empresa'
  ) then
    alter table public.usuarios alter column empresa drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'flag'
  ) then
    alter table public.usuarios alter column flag drop not null;
  end if;
end $$;

alter table public.usuarios add column if not exists login text;
alter table public.usuarios add column if not exists senha_hash text;
alter table public.usuarios add column if not exists empresas text[] not null default '{}';
alter table public.usuarios add column if not exists flag_default text not null default 'loja';
alter table public.usuarios add column if not exists ativo boolean not null default true;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usuarios'
      and column_name = 'secoes_compras'
      and udt_name <> '_text'
  ) then
    alter table public.usuarios rename column secoes_compras to secoes_compras_legacy;
  end if;
end $$;

alter table public.usuarios add column if not exists secoes_compras text[] not null default '{}';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usuarios'
      and column_name = 'secoes_compras_legacy'
      and udt_name = 'jsonb'
  ) then
    update public.usuarios u
       set secoes_compras = coalesce((
         select array_agg(value)
           from jsonb_array_elements_text(u.secoes_compras_legacy) as value
       ), '{}'::text[])
     where u.secoes_compras = '{}'::text[]
       and jsonb_typeof(u.secoes_compras_legacy) = 'array';
  end if;
end $$;

update public.usuarios
   set login = 'usuario_' || left(id::text, 8)
 where login is null or btrim(login) = '';

update public.usuarios
   set login = lower(btrim(login));

update public.usuarios
   set nome = coalesce(nullif(btrim(nome), ''), login)
 where nome is null or btrim(nome) = '';

update public.usuarios
   set senha_hash = crypt(gen_random_uuid()::text, gen_salt('bf')),
       ativo = false
 where senha_hash is null or btrim(senha_hash) = '';

update public.usuarios
   set role = 'operador'
 where role not in ('operador','compras','admin','super');

update public.usuarios
   set flag_default = case when lower(flag_default) = 'cd' then 'cd' else 'loja' end;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'empresa'
  ) then
    update public.usuarios
       set empresas = array[empresa]
     where empresas = '{}'::text[]
       and empresa in ('NEWSHOP','SOYE','FACIL');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'flag'
  ) then
    update public.usuarios
       set flag_default = case when lower(flag) = 'cd' then 'cd' else 'loja' end
     where flag_default is null or btrim(flag_default) = '';
  end if;
end $$;

update public.usuarios u
   set empresas = coalesce((
     select array_agg(distinct e)
       from (
         select upper(btrim(value)) as e
           from unnest(u.empresas) as value
       ) s
      where e in ('NEWSHOP','SOYE','FACIL')
   ), '{}'::text[]);

update public.usuarios
   set empresas = array['NEWSHOP']
 where empresas = '{}'::text[];

alter table public.usuarios alter column login set not null;
alter table public.usuarios alter column nome set not null;
alter table public.usuarios alter column senha_hash set not null;
alter table public.usuarios alter column role set not null;
alter table public.usuarios alter column empresas set not null;
alter table public.usuarios alter column flag_default set not null;
alter table public.usuarios alter column secoes_compras set not null;
alter table public.usuarios alter column ativo set not null;

create unique index if not exists usuarios_login_unq on public.usuarios (login);

alter table public.usuarios drop constraint if exists usuarios_role_chk;
alter table public.usuarios add constraint usuarios_role_chk
  check (role in ('operador','compras','admin','super')) not valid;

alter table public.usuarios drop constraint if exists usuarios_flag_default_chk;
alter table public.usuarios add constraint usuarios_flag_default_chk
  check (flag_default in ('loja','cd')) not valid;

alter table public.usuarios drop constraint if exists usuarios_empresas_validas_chk;
alter table public.usuarios add constraint usuarios_empresas_validas_chk
  check (empresas <@ array['NEWSHOP','SOYE','FACIL']::text[]) not valid;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_usuarios_updated on public.usuarios;
create trigger trg_usuarios_updated before update on public.usuarios
  for each row execute function public.set_updated_at();

alter table public.usuarios enable row level security;
drop policy if exists usuarios_anon_all on public.usuarios;
revoke all on public.usuarios from anon, authenticated;

insert into public.usuarios (login, nome, senha_hash, role, empresas, flag_default, secoes_compras, ativo)
values (
  'admin',
  'Administrador',
  crypt('trocar123', gen_salt('bf')),
  'super',
  array['NEWSHOP','SOYE','FACIL'],
  'loja',
  '{}'::text[],
  true
)
on conflict (login) do nothing;

create or replace function public.login_usuario(p_login text, p_senha text)
returns table (
  id uuid,
  login text,
  nome text,
  role text,
  empresas text[],
  flag_default text,
  secoes_compras text[]
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.login, u.nome, u.role, u.empresas, u.flag_default, u.secoes_compras
    from public.usuarios u
   where u.login = lower(trim(p_login))
     and u.ativo
     and u.senha_hash = crypt(p_senha, u.senha_hash);
$$;

grant execute on function public.login_usuario(text, text) to anon, authenticated;

create or replace function public.usuario_admin_autorizado(p_actor_login text, p_actor_senha text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.usuarios u
     where u.login = lower(trim(p_actor_login))
       and u.ativo
       and u.role in ('admin','super')
       and u.senha_hash = crypt(p_actor_senha, u.senha_hash)
  );
$$;

revoke all on function public.usuario_admin_autorizado(text, text) from public;

create or replace function public.admin_normalizar_empresas(p_empresas text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct e), '{}'::text[])
    from (
      select upper(trim(value)) as e
        from unnest(coalesce(p_empresas, '{}'::text[])) as value
    ) s
   where e in ('NEWSHOP','SOYE','FACIL');
$$;

revoke all on function public.admin_normalizar_empresas(text[]) from public;

create or replace function public.admin_listar_usuarios(
  p_actor_login text,
  p_actor_senha text
) returns table (
  id uuid,
  login text,
  nome text,
  role text,
  empresas text[],
  flag_default text,
  secoes_compras text[],
  ativo boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.usuario_admin_autorizado(p_actor_login, p_actor_senha) then
    raise exception 'nao autorizado';
  end if;

  return query
  select u.id, u.login, u.nome, u.role, u.empresas, u.flag_default,
         u.secoes_compras, u.ativo, u.created_at, u.updated_at
    from public.usuarios u
   order by u.ativo desc, u.nome asc;
end $$;

grant execute on function public.admin_listar_usuarios(text, text) to anon, authenticated;

create or replace function public.admin_criar_usuario(
  p_actor_login text,
  p_actor_senha text,
  p_login text,
  p_nome text,
  p_senha text,
  p_role text,
  p_empresas text[],
  p_flag_default text default 'loja',
  p_secoes text[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_empresas text[];
begin
  if not public.usuario_admin_autorizado(p_actor_login, p_actor_senha) then
    raise exception 'nao autorizado';
  end if;

  v_empresas := public.admin_normalizar_empresas(p_empresas);
  if array_length(v_empresas, 1) is null then
    raise exception 'empresas invalidas';
  end if;

  if p_role not in ('operador','compras','admin','super') then
    raise exception 'role invalida';
  end if;

  if btrim(coalesce(p_login, '')) = '' or btrim(coalesce(p_nome, '')) = '' then
    raise exception 'login e nome obrigatorios';
  end if;

  if lower(coalesce(p_flag_default, 'loja')) not in ('loja','cd') then
    raise exception 'flag invalida';
  end if;

  if btrim(coalesce(p_senha, '')) = '' then
    raise exception 'senha obrigatoria';
  end if;

  insert into public.usuarios(login, nome, senha_hash, role, empresas, flag_default, secoes_compras, ativo)
  values (
    lower(trim(p_login)),
    btrim(p_nome),
    crypt(p_senha, gen_salt('bf')),
    p_role,
    v_empresas,
    lower(p_flag_default),
    coalesce(p_secoes, '{}'::text[]),
    true
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.admin_criar_usuario(text, text, text, text, text, text, text[], text, text[]) to anon, authenticated;

create or replace function public.admin_atualizar_usuario(
  p_actor_login text,
  p_actor_senha text,
  p_id uuid,
  p_nome text,
  p_role text,
  p_empresas text[],
  p_flag_default text,
  p_secoes text[],
  p_ativo boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresas text[];
begin
  if not public.usuario_admin_autorizado(p_actor_login, p_actor_senha) then
    raise exception 'nao autorizado';
  end if;

  v_empresas := public.admin_normalizar_empresas(p_empresas);
  if array_length(v_empresas, 1) is null then
    raise exception 'empresas invalidas';
  end if;

  if p_role not in ('operador','compras','admin','super') then
    raise exception 'role invalida';
  end if;

  if btrim(coalesce(p_nome, '')) = '' then
    raise exception 'nome obrigatorio';
  end if;

  if lower(coalesce(p_flag_default, 'loja')) not in ('loja','cd') then
    raise exception 'flag invalida';
  end if;

  update public.usuarios
     set nome = btrim(p_nome),
         role = p_role,
         empresas = v_empresas,
         flag_default = lower(coalesce(p_flag_default, 'loja')),
         secoes_compras = coalesce(p_secoes, '{}'::text[]),
         ativo = coalesce(p_ativo, true)
   where id = p_id;
end $$;

grant execute on function public.admin_atualizar_usuario(text, text, uuid, text, text, text[], text, text[], boolean) to anon, authenticated;

create or replace function public.admin_redefinir_senha(
  p_actor_login text,
  p_actor_senha text,
  p_id uuid,
  p_nova_senha text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.usuario_admin_autorizado(p_actor_login, p_actor_senha) then
    raise exception 'nao autorizado';
  end if;

  if btrim(coalesce(p_nova_senha, '')) = '' then
    raise exception 'senha obrigatoria';
  end if;

  update public.usuarios
     set senha_hash = crypt(p_nova_senha, gen_salt('bf'))
   where id = p_id;
end $$;

grant execute on function public.admin_redefinir_senha(text, text, uuid, text) to anon, authenticated;
