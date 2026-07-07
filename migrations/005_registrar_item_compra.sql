-- Funcao usada pelo Trigger (conferencia) para registrar item de compra no Supabase.
-- Regra anti-repetido: se o produto ainda NAO existe, insere como 'todo'. Se JA
-- existe, NAO mexe no status (nao ressuscita item ja analisado) e so incrementa
-- vezes_pedido + atualiza metadados. Espelha o comportamento do dual-write do app.
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
