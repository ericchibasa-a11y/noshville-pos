-- Additive finance records. Existing sales, purchases, expenses and cash-ups are preserved.
create table if not exists public.business_assets (
 id uuid primary key default gen_random_uuid(),
 asset_name text not null check (length(btrim(asset_name))>0),
 serial_number text, purchase_date date not null, purchase_cost numeric(12,2) not null check (purchase_cost>0),
 supplier text, invoice_reference text, location text, condition text not null default 'Good',
 payment_source text not null check (payment_source in ('till','bank','owner','register_only')),
 notes text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.fund_movements (
 id uuid primary key default gen_random_uuid(), movement_date date not null,
 movement_type text not null check (movement_type in ('asset_purchase','owner_contribution','owner_drawing','transfer','stock_payment','reversal')),
 from_account text not null check (from_account in ('till','bank','owner','asset','supplier')),
 to_account text not null check (to_account in ('till','bank','owner','asset','supplier')),
 amount numeric(12,2) not null check (amount>0), description text not null check(length(btrim(description))>0),
 reference text, asset_id uuid references public.business_assets(id), reversal_of uuid unique references public.fund_movements(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 check (from_account<>to_account),
 check (
  (movement_type='asset_purchase' and from_account in ('till','bank','owner') and to_account='asset' and asset_id is not null and reversal_of is null) or
  (movement_type='owner_contribution' and from_account='owner' and to_account in ('till','bank') and asset_id is null and reversal_of is null) or
  (movement_type='owner_drawing' and from_account in ('till','bank') and to_account='owner' and asset_id is null and reversal_of is null) or
  (movement_type='transfer' and from_account in ('till','bank') and to_account in ('till','bank') and asset_id is null and reversal_of is null) or
  (movement_type='stock_payment' and from_account in ('till','bank','owner') and to_account='supplier' and asset_id is null and reversal_of is null) or
  (movement_type='reversal' and reversal_of is not null)
 )
);
create unique index if not exists fund_movements_one_asset_payment on public.fund_movements(asset_id) where movement_type='asset_purchase';
create index if not exists fund_movements_date_idx on public.fund_movements(movement_date);
create index if not exists fund_movements_creator_idx on public.fund_movements(created_by);
create index if not exists business_assets_creator_idx on public.business_assets(created_by);
alter table public.business_assets enable row level security;
alter table public.fund_movements enable row level security;
revoke all on public.business_assets,public.fund_movements from anon,authenticated;
grant select,insert on public.business_assets,public.fund_movements to authenticated;
drop policy if exists assets_manager_read on public.business_assets;
create policy assets_manager_read on public.business_assets for select to authenticated using ((select public.is_manager()));
drop policy if exists assets_manager_insert on public.business_assets;
create policy assets_manager_insert on public.business_assets for insert to authenticated with check ((select public.is_manager()) and created_by=(select auth.uid()));
drop policy if exists funds_manager_read on public.fund_movements;
create policy funds_manager_read on public.fund_movements for select to authenticated using ((select public.is_manager()));
drop policy if exists funds_manager_insert on public.fund_movements;
create policy funds_manager_insert on public.fund_movements for insert to authenticated with check ((select public.is_manager()) and created_by=(select auth.uid()));

create or replace function public.validate_fund_movement() returns trigger language plpgsql security invoker set search_path=public as $$
declare original public.fund_movements; a public.business_assets;
begin
 if not coalesce(public.is_manager(),false) or new.created_by is distinct from auth.uid() then raise exception 'Active manager access required'; end if;
 if new.movement_date > (now() at time zone 'Africa/Johannesburg')::date then raise exception 'Future payments cannot be recorded'; end if;
 if new.from_account='till' or new.to_account='till' then
  perform pg_advisory_xact_lock(hashtextextended('noshville-till-'||new.movement_date::text,0));
  if exists(select 1 from public.cashups where cashup_date=new.movement_date) then
   raise exception 'This day is already cashed up. Use an open date for a correction; register historical assets without a new payment.';
  end if;
 end if;
 if new.movement_type='asset_purchase' then
  select * into a from public.business_assets where id=new.asset_id;
  if a.id is null or a.purchase_cost<>new.amount or a.payment_source<>new.from_account or a.purchase_date<>new.movement_date then
   raise exception 'Asset payment must match the asset cost, date and funding source';
  end if;
 elsif new.movement_type='reversal' then
  perform pg_advisory_xact_lock(hashtextextended('noshville-reversal-'||new.reversal_of::text,0));
  select * into original from public.fund_movements where id=new.reversal_of;
  if original.id is null or original.movement_type='reversal' or original.amount<>new.amount or original.from_account<>new.to_account or original.to_account<>new.from_account or original.asset_id is distinct from new.asset_id then
   raise exception 'Reversal must exactly offset an original movement';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.validate_fund_movement() from public,anon,authenticated;
drop trigger if exists validate_fund_movement on public.fund_movements;
create trigger validate_fund_movement before insert on public.fund_movements for each row execute function public.validate_fund_movement();

create or replace function public.record_business_asset(p_id uuid,p_name text,p_date date,p_cost numeric,p_source text,p_serial text default null,p_supplier text default null,p_reference text default null,p_location text default null,p_condition text default 'Good',p_notes text default null)
returns uuid language plpgsql security invoker set search_path=public as $$
begin
 if not coalesce(public.is_manager(),false) then raise exception 'Active manager access required'; end if;
 if p_date > (now() at time zone 'Africa/Johannesburg')::date then raise exception 'Future purchases cannot be recorded'; end if;
 -- A stable request ID makes retrying a submitted form safe.
 if exists(select 1 from public.business_assets where id=p_id and created_by=auth.uid()) then return p_id; end if;
 insert into public.business_assets(id,asset_name,purchase_date,purchase_cost,payment_source,serial_number,supplier,invoice_reference,location,condition,notes,created_by)
 values(p_id,btrim(p_name),p_date,p_cost,p_source,p_serial,p_supplier,p_reference,p_location,p_condition,p_notes,auth.uid());
 if p_source<>'register_only' then
  insert into public.fund_movements(id,movement_date,movement_type,from_account,to_account,amount,description,reference,asset_id,created_by)
  values(p_id,p_date,'asset_purchase',p_source,'asset',p_cost,'Asset purchase: '||btrim(p_name),p_reference,p_id,auth.uid());
 end if;
 return p_id;
end $$;
revoke all on function public.record_business_asset(uuid,text,date,numeric,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.record_business_asset(uuid,text,date,numeric,text,text,text,text,text,text,text) to authenticated;

-- Return only totals needed for cash-up. Staff cannot read manager-only asset or fund details.
create or replace function public.finance_cashup_totals(p_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare s jsonb; e numeric; fi numeric; fo numeric;
begin
 if auth.uid() is null or not coalesce(public.is_active_user(),false) then raise exception 'Active POS account required'; end if;
 select jsonb_build_object('cash',coalesce(sum(total_amount) filter(where payment_method='cash'),0),'card',coalesce(sum(total_amount) filter(where payment_method='card'),0),'eft',coalesce(sum(total_amount) filter(where payment_method='eft'),0),'other',coalesce(sum(total_amount) filter(where payment_method='other'),0)) into s
 from public.sales where status='completed' and sale_date >= (p_date::timestamp at time zone 'Africa/Johannesburg') and sale_date < ((p_date+1)::timestamp at time zone 'Africa/Johannesburg');
 select coalesce(sum(amount),0) into e from public.expenses where expense_date=p_date and payment_method='cash';
 select coalesce(sum(amount) filter(where to_account='till'),0),coalesce(sum(amount) filter(where from_account='till'),0) into fi,fo from public.fund_movements where movement_date=p_date;
 return s||jsonb_build_object('cashExp',e,'fundIn',fi,'fundOut',fo);
end $$;
revoke all on function public.finance_cashup_totals(date) from public,anon;
grant execute on function public.finance_cashup_totals(date) to authenticated;
alter table public.cashups add column if not exists fund_cash_in numeric(12,2) not null default 0, add column if not exists fund_cash_out numeric(12,2) not null default 0;
create or replace function public.calculate_finance_cashup() returns trigger language plpgsql security invoker set search_path=public as $$
declare totals jsonb;
begin
 if not coalesce(public.is_active_user(),false) then raise exception 'Active POS account required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('noshville-till-'||new.cashup_date::text,0));
 totals:=public.finance_cashup_totals(new.cashup_date);
 new.cash_sales:=(totals->>'cash')::numeric; new.card_sales:=(totals->>'card')::numeric; new.eft_sales:=(totals->>'eft')::numeric; new.other_sales:=(totals->>'other')::numeric;
 new.cash_expenses:=(totals->>'cashExp')::numeric; new.fund_cash_in:=(totals->>'fundIn')::numeric; new.fund_cash_out:=(totals->>'fundOut')::numeric;
 new.expected_cash:=new.opening_float+new.cash_sales-new.cash_expenses+new.fund_cash_in-new.fund_cash_out;
 new.variance:=new.actual_cash-new.expected_cash;
 return new;
end $$;
revoke all on function public.calculate_finance_cashup() from public,anon,authenticated;
drop trigger if exists calculate_finance_cashup on public.cashups;
create trigger calculate_finance_cashup before insert on public.cashups for each row execute function public.calculate_finance_cashup();
notify pgrst,'reload schema';
