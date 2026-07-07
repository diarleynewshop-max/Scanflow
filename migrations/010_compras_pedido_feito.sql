-- =====================================================================
-- "PEDIDO FEITO" no Supabase (substitui o anexo de PDF na task do ClickUp)
--
-- Antes: ao gerar o PDF do pedido ao fornecedor, o app anexava o PDF na task do
-- ClickUp (ADTASK) e usava isso pra saber quem teve pedido feito.
-- Agora: uma coluna booleana `pedido_feito` (0 = nao, 1 = sim) na tabela compras.
-- O app le essa coluna pra identificar todos os produtos com pedido feito.
--
-- Regra automatica: quando pedido_feito = 1, o item fica no status
-- 'pedido_andamento' ("pedido feito"), venha de QUALQUER status — menos os
-- estagios finais (compra_realizada / concluido), que nao devem regredir.
--
-- Idempotente. Rode no SQL Editor do Studio (https://db.newgrup.cloud).
-- =====================================================================

alter table public.compras
  add column if not exists pedido_feito    smallint     not null default 0
    check (pedido_feito in (0, 1)),
  add column if not exists pedido_feito_em timestamptz;

create index if not exists compras_pedido_feito_idx
  on public.compras (empresa, pedido_feito);

-- Mantem automaticamente em "pedido feito" (pedido_andamento) quando a flag esta ligada.
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

-- Roda antes do trg_compras_updated (ordem alfabetica: 'p' < 'u'), os dois
-- alteram NEW no mesmo BEFORE.
drop trigger if exists trg_compras_pedido_feito on public.compras;
create trigger trg_compras_pedido_feito
  before insert or update on public.compras
  for each row execute function public.compras_aplica_pedido_feito();
