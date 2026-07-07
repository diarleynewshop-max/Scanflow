-- Bucket publico para as fotos dos itens de compra. A tela sobe a foto (vinda do
-- ERP) uma vez e guarda a URL publica em compras.foto_url — proximas cargas usam
-- a URL direto, sem reconsultar o ERP.
insert into storage.buckets (id, name, public)
values ('compras-fotos', 'compras-fotos', true)
on conflict (id) do nothing;

-- PILOTO: libera anon para ler/gravar neste bucket (RLS em storage.objects).
drop policy if exists compras_fotos_anon_all on storage.objects;
create policy compras_fotos_anon_all on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'compras-fotos')
  with check (bucket_id = 'compras-fotos');
