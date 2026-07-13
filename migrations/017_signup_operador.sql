-- =====================================================================
-- 017 - Auto-cadastro público (self-signup) SEMPRE como OPERADOR.
--
-- Qualquer pessoa cria a própria conta escolhendo login, nome, senha e
-- a(s) empresa(s) onde trabalha. A role é SEMPRE 'operador' (não há como
-- o solicitante escolher outra) e a conta já nasce ATIVA (usa na hora).
-- Só ADMIN/SUPER, via admin_atualizar_usuario, muda role/nome/empresas;
-- e admin_redefinir_senha reseta a senha. (migrations 014/015).
--
-- Depende de: usuarios (002), unique index usuarios_login_unq (014),
-- admin_normalizar_empresas (014), pgcrypto (extensions).
-- Idempotente (create or replace). Rodar no SQL Editor do Studio.
-- =====================================================================

create or replace function public.criar_conta_operador(
  p_login   text,
  p_nome    text,
  p_senha   text,
  p_empresas text[],
  p_flag_default text default 'loja'
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_login text;
  v_empresas text[];
begin
  v_login := lower(btrim(coalesce(p_login, '')));

  if v_login = '' or btrim(coalesce(p_nome, '')) = '' then
    raise exception 'login e nome obrigatorios';
  end if;

  if btrim(coalesce(p_senha, '')) = '' then
    raise exception 'senha obrigatoria';
  end if;

  -- normaliza/valida empresas (só NEWSHOP/SOYE/FACIL); precisa de pelo menos uma
  v_empresas := public.admin_normalizar_empresas(p_empresas);
  if array_length(v_empresas, 1) is null then
    raise exception 'selecione ao menos uma empresa';
  end if;

  if lower(coalesce(p_flag_default, 'loja')) not in ('loja','cd') then
    raise exception 'flag invalida';
  end if;

  -- login único (mensagem limpa em vez do erro cru do índice)
  if exists (select 1 from public.usuarios u where u.login = v_login) then
    raise exception 'login ja existe' using errcode = 'unique_violation';
  end if;

  insert into public.usuarios(
    login, nome, senha_hash, role, empresas, flag_default, secoes_compras, secao_padrao, ativo
  ) values (
    v_login,
    btrim(p_nome),
    crypt(p_senha, gen_salt('bf')),
    'operador',                 -- role SEMPRE operador, sem exceção
    v_empresas,
    lower(coalesce(p_flag_default, 'loja')),
    '{}'::text[],
    null,
    true                        -- já nasce ativa
  )
  returning id into v_id;

  return v_id;
end $$;

-- público: anon pode chamar (é justamente o auto-cadastro na tela de login)
grant execute on function public.criar_conta_operador(text, text, text, text[], text) to anon, authenticated;
