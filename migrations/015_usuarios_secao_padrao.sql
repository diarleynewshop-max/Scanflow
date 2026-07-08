-- 015 - Secao padrao opcional por usuario no login de loja.

alter table public.usuarios
  add column if not exists secao_padrao text;

update public.usuarios
   set secao_padrao = nullif(btrim(coalesce(secao_padrao, '')), '');

drop function if exists public.login_usuario(text, text);

create function public.login_usuario(p_login text, p_senha text)
returns table (
  id uuid,
  login text,
  nome text,
  role text,
  empresas text[],
  flag_default text,
  secoes_compras text[],
  secao_padrao text
)
language sql
security definer
set search_path = public, extensions
as $$
  select u.id,
         u.login,
         u.nome,
         u.role,
         u.empresas,
         u.flag_default,
         u.secoes_compras,
         u.secao_padrao
    from public.usuarios u
   where u.login = lower(trim(p_login))
     and u.ativo
     and u.senha_hash = crypt(p_senha, u.senha_hash);
$$;

grant execute on function public.login_usuario(text, text) to anon, authenticated;

drop function if exists public.admin_listar_usuarios(text, text);

create function public.admin_listar_usuarios(
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
  secao_padrao text,
  ativo boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.usuario_admin_autorizado(p_actor_login, p_actor_senha) then
    raise exception 'nao autorizado';
  end if;

  return query
  select u.id,
         u.login,
         u.nome,
         u.role,
         u.empresas,
         u.flag_default,
         u.secoes_compras,
         u.secao_padrao,
         u.ativo,
         u.created_at,
         u.updated_at
    from public.usuarios u
   order by u.ativo desc, u.nome asc;
end $$;

grant execute on function public.admin_listar_usuarios(text, text) to anon, authenticated;

drop function if exists public.admin_criar_usuario(text, text, text, text, text, text, text[], text, text[]);
drop function if exists public.admin_criar_usuario(text, text, text, text, text, text, text[], text, text[], text);

create function public.admin_criar_usuario(
  p_actor_login text,
  p_actor_senha text,
  p_login text,
  p_nome text,
  p_senha text,
  p_role text,
  p_empresas text[],
  p_flag_default text default 'loja',
  p_secoes text[] default '{}',
  p_secao_padrao text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_empresas text[];
  v_secao_padrao text;
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

  v_secao_padrao := nullif(btrim(coalesce(p_secao_padrao, '')), '');

  insert into public.usuarios(login, nome, senha_hash, role, empresas, flag_default, secoes_compras, secao_padrao, ativo)
  values (
    lower(trim(p_login)),
    btrim(p_nome),
    crypt(p_senha, gen_salt('bf')),
    p_role,
    v_empresas,
    lower(p_flag_default),
    coalesce(p_secoes, '{}'::text[]),
    v_secao_padrao,
    true
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.admin_criar_usuario(text, text, text, text, text, text, text[], text, text[], text) to anon, authenticated;

drop function if exists public.admin_atualizar_usuario(text, text, uuid, text, text, text[], text, text[], boolean);
drop function if exists public.admin_atualizar_usuario(text, text, uuid, text, text, text[], text, text[], text, boolean);

create function public.admin_atualizar_usuario(
  p_actor_login text,
  p_actor_senha text,
  p_id uuid,
  p_nome text,
  p_role text,
  p_empresas text[],
  p_flag_default text,
  p_secoes text[],
  p_secao_padrao text default null,
  p_ativo boolean default true
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_empresas text[];
  v_secao_padrao text;
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

  v_secao_padrao := nullif(btrim(coalesce(p_secao_padrao, '')), '');

  update public.usuarios
     set nome = btrim(p_nome),
         role = p_role,
         empresas = v_empresas,
         flag_default = lower(coalesce(p_flag_default, 'loja')),
         secoes_compras = coalesce(p_secoes, '{}'::text[]),
         secao_padrao = v_secao_padrao,
         ativo = coalesce(p_ativo, true)
   where id = p_id;
end $$;

grant execute on function public.admin_atualizar_usuario(text, text, uuid, text, text, text[], text, text[], text, boolean) to anon, authenticated;
