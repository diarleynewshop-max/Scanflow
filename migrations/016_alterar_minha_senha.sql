-- 016 - Usuario troca a propria senha (self-service no Perfil).
-- Valida a senha atual via crypt e, se bater, grava a nova. Retorna:
--   true  = senha trocada
--   false = senha atual incorreta (ou usuario inativo/inexistente)
-- SECURITY DEFINER + search_path com extensions (pgcrypto vive la no Supabase).

create or replace function public.alterar_minha_senha(
  p_login text,
  p_senha_atual text,
  p_nova_senha text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ok boolean;
begin
  if btrim(coalesce(p_nova_senha, '')) = '' then
    raise exception 'senha nova obrigatoria';
  end if;

  select exists (
    select 1
      from public.usuarios u
     where u.login = lower(trim(p_login))
       and u.ativo
       and u.senha_hash = crypt(p_senha_atual, u.senha_hash)
  ) into v_ok;

  if not v_ok then
    return false;
  end if;

  update public.usuarios
     set senha_hash = crypt(p_nova_senha, gen_salt('bf'))
   where login = lower(trim(p_login))
     and ativo;

  return true;
end $$;

grant execute on function public.alterar_minha_senha(text, text, text) to anon, authenticated;
