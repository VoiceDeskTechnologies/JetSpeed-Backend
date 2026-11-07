insert into storage.buckets (id, name, public) values ('delivery-proof', 'delivery-proof', false) on conflict (id) do nothing;
create policy "authenticated users upload delivery proof" on storage.objects for insert to authenticated with check (bucket_id = 'delivery-proof');
create policy "authenticated users read delivery proof" on storage.objects for select to authenticated using (bucket_id = 'delivery-proof');
