-- Soye e Facil sao a MESMA empresa (SF): mesmo preco, mesmo setor de compras.
-- Consolida as linhas de compras de SOYE/FACIL numa unica empresa 'SF' e passa a
-- aceitar somente 'NEWSHOP' e 'SF'. Idempotente.
begin;

alter table public.compras drop constraint if exists compras_empresa_check;

-- SOYE vira SF
update public.compras set empresa = 'SF' where empresa = 'SOYE';

-- Traz de FACIL o que porventura nao exista ainda em SF (uniao segura), depois apaga FACIL
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
