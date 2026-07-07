-- Limpeza pontual: remove linhas que nao sao produtos reais (tasks agregadas /
-- de teste que entraram no backfill do ClickUp, sem codigo numerico 6-14 nem SKU).
-- Idempotente. A causa foi corrigida no codigo (produtoKey nao gera mais chave
-- de fallback a partir de texto livre).
delete from public.compras
where produto_key !~ '^COD:[0-9]{6,14}$' and produto_key !~ '^SKU:';
