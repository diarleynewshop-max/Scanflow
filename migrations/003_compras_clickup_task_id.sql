-- Transicao dual-write: guarda o ID da task do ClickUp em cada linha de compras,
-- para as acoes existentes (mover status, PDF, galpao) seguirem funcionando
-- enquanto o ClickUp ainda esta ativo. Sai quando o ClickUp for cortado.
alter table public.compras add column if not exists clickup_task_id text;
create index if not exists compras_clickup_task_id_idx on public.compras (clickup_task_id);
