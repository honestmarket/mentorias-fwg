-- Plataforma de Mentorias FWG: armazenamento em documentos (espelha as coleções da versão do Claude)
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create table if not exists public.admins (email text primary key);
alter table public.docs enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create policy admins_ver_proprio on public.admins for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
-- mentor (admin): acesso total
create policy docs_admin_tudo on public.docs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- portal do mentorado: só os pacotes criptografados (abertos com usuário e senha do portal)
create policy docs_portal_leitura on public.docs for select to anon, authenticated
  using (col = 'portal');

grant select on public.docs to anon;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.admins to authenticated;

-- só e-mails de mentores cadastrados (tabela admins) podem criar conta
create or replace function public.somente_admins_cadastro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins where email = lower(new.email)) then
    raise exception 'EMAIL_NAO_CADASTRADO';
  end if;
  return new;
end $$;
create trigger somente_admins_cadastro before insert on auth.users
  for each row execute function public.somente_admins_cadastro();

insert into public.admins (email) values ('murilo@honestmarketbrasil.com.br') on conflict do nothing;

alter publication supabase_realtime add table public.docs;

-- arquivos: nomes aleatórios, leitura por link; envio e exclusão só pelo mentor
insert into storage.buckets (id, name, public, file_size_limit)
values ('arquivos', 'arquivos', true, 20971520)
on conflict (id) do update set public = true, file_size_limit = 20971520;
create policy arquivos_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'arquivos' and public.is_admin());
create policy arquivos_admin_select on storage.objects for select to authenticated using (bucket_id = 'arquivos' and public.is_admin());
create policy arquivos_admin_update on storage.objects for update to authenticated using (bucket_id = 'arquivos' and public.is_admin());
create policy arquivos_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'arquivos' and public.is_admin());
