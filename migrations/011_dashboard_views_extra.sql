-- =====================================================================
-- DASHBOARD — views que faltavam (semana / conferente / secao) + foto por JOIN
--
-- Decisoes (2026-07-06):
--  1) Semana comeca na SEGUNDA -> date_trunc('week', ...) do Postgres ja e segunda.
--  2) Empresas ficam SEPARADAS (NEWSHOP/SOYE/FACIL). Os 5 filtros da tela
--     (NEWSHOP / SO FACIL / SO SOYE / SOYE+FACIL / TUDO) sao no front, somando os
--     conjuntos de empresa — por isso as views agrupam por empresa e o app soma.
--  3) Sem D+1 / sem snapshot: tudo ao vivo (a view sempre reflete o estado atual).
--  4) Foto do item: reaproveita a URL ja salva em compras.foto_url (Storage) via
--     JOIN por codigo — NAO duplica imagem, gasta o minimo de memoria.
--
-- Idempotente. Depende das tabelas da migration 009.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Resumo por SEMANA (segunda a domingo).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Quem fez as listas (por conferente) — inclui tempo total gasto.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Por SECAO — quanto foi separado / nao tinha / parcial / pendente por setor.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Frequencia de item — AGORA com a foto reaproveitada de compras.foto_url.
-- Prioridade da foto: a que veio na conferencia (se for URL) -> senao a URL ja
-- salva no Storage em compras (JOIN por codigo). Nunca guarda o blob aqui.
-- (Substitui a view criada na migration 009, adicionando foto_url.)
-- ---------------------------------------------------------------------
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
