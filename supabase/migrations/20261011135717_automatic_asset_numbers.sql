lock table public.business_assets in access exclusive mode;
create sequence public.business_asset_number_seq minvalue 1 maxvalue 999999 no cycle;
alter table public.business_assets add column asset_number text;
with numbered as (
 select id,row_number() over(order by created_at,id) as n from public.business_assets
)
update public.business_assets a set asset_number='NSH-A-'||lpad(n.n::text,6,'0') from numbered n where a.id=n.id;
select setval('public.business_asset_number_seq',greatest((select count(*) from public.business_assets),1),(select count(*)>0 from public.business_assets));
alter table public.business_assets alter column asset_number set default ('NSH-A-'||lpad(nextval('public.business_asset_number_seq')::text,6,'0'));
alter table public.business_assets alter column asset_number set not null;
alter table public.business_assets add constraint business_assets_asset_number_unique unique(asset_number);
alter table public.business_assets add constraint business_assets_asset_number_format check(asset_number ~ '^NSH-A-[0-9]{6}$');
revoke all on sequence public.business_asset_number_seq from public,anon;
grant usage on sequence public.business_asset_number_seq to authenticated;
notify pgrst,'reload schema';
