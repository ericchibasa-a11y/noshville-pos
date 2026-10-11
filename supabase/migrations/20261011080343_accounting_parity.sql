-- Manager accounting, additive to the operational POS. Private guarded writer;
-- posted journals are append-only and sources synchronise by content signature.
create schema if not exists nv_finance_private;
revoke all on schema nv_finance_private from public,anon;
grant usage on schema nv_finance_private to authenticated;
create table public.nv_accounts(code text primary key,name text not null,kind text not null check(kind in ('asset','liability','equity','income','expense')));
insert into public.nv_accounts values
('1000','Till cash','asset'),('1020','Business bank','asset'),('1030','Card settlement clearing','asset'),('1040','Other payment clearing','asset'),('1100','Debtors','asset'),('1200','Retail inventory','asset'),('1500','Equipment at cost','asset'),('1590','Accumulated depreciation','asset'),
('2000','Trade creditors','liability'),('2100','Loans','liability'),('3000','Owner capital','equity'),('3010','Owner drawings','equity'),('3100','Opening balance equity','equity'),('3200','Retained earnings','equity'),
('4000','Retail sales','income'),('4100','Other income','income'),('5000','Retail cost of sales','expense'),('5100','Stock adjustment expense','expense'),('6000','Operating expenses','expense'),('6100','Bank charges','expense'),('6200','Depreciation expense','expense'),('6300','Income tax expense','expense');
create table public.nv_journals(id uuid primary key default gen_random_uuid(),journal_date date not null,description text not null check(length(btrim(description))>0),reference text,source_key text unique,reversal_of uuid unique references public.nv_journals(id),asset_id uuid references public.business_assets(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create table public.nv_lines(id uuid primary key default gen_random_uuid(),journal_id uuid not null references public.nv_journals(id),account_code text not null references public.nv_accounts(code),debit numeric(14,2) not null default 0 check(debit>=0),credit numeric(14,2) not null default 0 check(credit>=0),check((debit>0 and credit=0) or (credit>0 and debit=0)));
create index nv_lines_journal_idx on public.nv_lines(journal_id);
create index nv_lines_account_idx on public.nv_lines(account_code);
create index nv_journals_date_idx on public.nv_journals(journal_date);
create index nv_journals_asset_idx on public.nv_journals(asset_id);
create table public.nv_source_posts(source_key text primary key,signature text not null,journal_id uuid references public.nv_journals(id));
create table public.nv_periods(month_start date primary key check(extract(day from month_start)=1),closed_by uuid references public.profiles(id),closed_at timestamptz,notes text);
create table public.nv_bank_config(id boolean primary key default true check(id),bank_name text not null,account_name text not null,last_four text check(last_four ~ '^[0-9]{4}$'),opening_date date not null,opening_balance numeric(14,2) not null,created_by uuid references public.profiles(id));
create table public.nv_statement_lines(id uuid primary key default gen_random_uuid(),transaction_date date not null,description text not null,reference text,amount numeric(14,2) not null check(amount<>0),balance numeric(14,2),import_key text unique,created_by uuid references public.profiles(id),created_at timestamptz default now());
create table public.nv_bank_matches(id uuid primary key default gen_random_uuid(),statement_id uuid unique not null references public.nv_statement_lines(id),line_id uuid unique not null references public.nv_lines(id),created_by uuid references public.profiles(id),created_at timestamptz default now());
create table public.nv_period_events(id uuid primary key default gen_random_uuid(),month_start date not null,action text not null,notes text not null,created_by uuid references public.profiles(id),created_at timestamptz default now());
do $$ declare t text; begin foreach t in array array['nv_accounts','nv_journals','nv_lines','nv_source_posts','nv_periods','nv_bank_config','nv_statement_lines','nv_bank_matches','nv_period_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy manager_read on public.%I for select to authenticated using ((select public.is_manager()))',t);
 end loop; end $$;

create function nv_finance_private.post(p_date date,p_description text,p_reference text,p_key text,p_lines jsonb,p_asset uuid default null,p_reversal uuid default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare jid uuid; x jsonb; d numeric; c numeric; td numeric:=0; tc numeric:=0;
begin
 if p_date is null or p_date>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'Use a valid posting date, not a future date'; end if;
 if exists(select 1 from public.nv_periods where month_start=date_trunc('month',p_date)::date and closed_at is not null) then raise exception 'Accounting month is closed. Reopen it with a reason before posting'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'At least two journal lines required'; end if;
 for x in select value from jsonb_array_elements(p_lines) loop
 d:=round(coalesce((x->>'debit')::numeric,0),2);c:=round(coalesce((x->>'credit')::numeric,0),2);
 if not ((d>0 and c=0) or (c>0 and d=0)) then raise exception 'Each journal line needs one positive debit or credit'; end if;
 td:=td+d;tc:=tc+c;
 end loop;
 if td<>tc or td<=0 then raise exception 'Journal debits and credits must balance'; end if;
 insert into public.nv_journals(journal_date,description,reference,source_key,asset_id,reversal_of,created_by) values(p_date,btrim(p_description),p_reference,p_key,p_asset,p_reversal,auth.uid()) returning id into jid;
 insert into public.nv_lines(journal_id,account_code,debit,credit) select jid,value->>'account',round(coalesce((value->>'debit')::numeric,0),2),round(coalesce((value->>'credit')::numeric,0),2) from jsonb_array_elements(p_lines);
 return jid;
end $$;
create function nv_finance_private.pair(p_debit text,p_credit text,p_amount numeric) returns jsonb language sql immutable set search_path='' as $$ select case when round(p_amount,2)>0 then jsonb_build_array(jsonb_build_object('account',p_debit,'debit',round(p_amount,2)),jsonb_build_object('account',p_credit,'credit',round(p_amount,2))) else '[]'::jsonb end $$;
create function nv_finance_private.sync_source(k text,dt date,descr text,ref text,ls jsonb,asset uuid default null) returns boolean language plpgsql set search_path='' as $$
declare sig text:=md5(jsonb_build_array(dt,descr,ref,ls)::text); old public.nv_source_posts; jid uuid; revlines jsonb;
begin
 select * into old from public.nv_source_posts where source_key=k;
 if old.signature=sig then return false; end if;
 if old.journal_id is not null then
 select jsonb_agg(jsonb_build_object('account',account_code,'debit',credit,'credit',debit)) into revlines from public.nv_lines where journal_id=old.journal_id;
 perform nv_finance_private.post(dt,'Source correction: '||descr,ref,null,revlines,asset,old.journal_id);
 end if;
 if jsonb_array_length(ls)>0 then jid:=nv_finance_private.post(dt,descr,ref,null,ls,asset); end if;
 insert into public.nv_source_posts values(k,sig,jid) on conflict(source_key) do update set signature=excluded.signature,journal_id=excluded.journal_id;
 return true;
end $$;
create function nv_finance_private.sync_all() returns jsonb language plpgsql set search_path='' as $$
declare r record; ls jsonb; amt numeric; counter text; changes int:=0; dt date; ad text; ac text;
begin
 for r in select s.*,coalesce((select sum(line_cost) from public.sale_items where sale_id=s.id),0) cost from public.sales s loop
 dt:=(r.sale_date at time zone 'Africa/Johannesburg')::date;
 counter:=case r.payment_method::text when 'cash' then '1000' when 'card' then '1030' when 'eft' then '1020' else '1040' end;
 ls:=case when r.status::text='completed' then nv_finance_private.pair(counter,'4000',r.total_amount)||nv_finance_private.pair('5000','1200',r.cost) else '[]'::jsonb end;
 if nv_finance_private.sync_source('sale:'||r.id,dt,'POS sale '||r.order_no,r.order_no::text,ls) then changes:=changes+1; end if;
 end loop;
 for r in select * from public.expenses loop
 counter:=case r.payment_method::text when 'cash' then '1000' when 'card' then '1020' when 'eft' then '1020' else '1040' end;
 if nv_finance_private.sync_source('expense:'||r.id,r.expense_date,'Expense — '||r.category||': '||r.description,null,nv_finance_private.pair('6000',counter,r.amount)) then changes:=changes+1;end if;
 end loop;
 for r in select p.*,coalesce((select sum(line_total) from public.purchase_items where purchase_id=p.id),0) cost from public.purchases p loop
 if nv_finance_private.sync_source('purchase:'||r.id,r.purchase_date,'Stock receipt',r.invoice_number,nv_finance_private.pair('1200','2000',r.cost+coalesce(r.transport_cost,0))) then changes:=changes+1;end if;
 end loop;
 for r in select * from public.business_assets where payment_source='register_only' loop
 if nv_finance_private.sync_source('asset:'||r.id,r.purchase_date,'Existing asset: '||r.asset_name,r.invoice_reference,nv_finance_private.pair('1500','3100',r.purchase_cost),r.id) then changes:=changes+1;end if;
 end loop;
 for r in select * from public.fund_movements order by created_at,id loop
 ad:=case r.to_account when 'till' then '1000' when 'bank' then '1020' when 'asset' then '1500' when 'supplier' then '2000' when 'owner' then '3010' end;
 ac:=case r.from_account when 'till' then '1000' when 'bank' then '1020' when 'owner' then '3000' when 'asset' then '1500' when 'supplier' then '2000' end;
 if r.movement_type='reversal' then
  select case f.from_account when 'till' then '1000' when 'bank' then '1020' when 'owner' then '3000' end,
         case f.to_account when 'till' then '1000' when 'bank' then '1020' when 'asset' then '1500' when 'supplier' then '2000' when 'owner' then '3010' end into ad,ac from public.fund_movements f where f.id=r.reversal_of;
 end if;
 if nv_finance_private.sync_source('fund:'||r.id,r.movement_date,r.description,r.reference,nv_finance_private.pair(ad,ac,r.amount),r.asset_id) then changes:=changes+1;end if;
 end loop;
 for r in select * from public.stock_movements where movement_type::text in ('adjustment_in','adjustment_out') loop
 amt:=abs(r.quantity*r.unit_cost);dt:=(r.created_at at time zone 'Africa/Johannesburg')::date;
 ls:=case when r.movement_type::text='adjustment_in' then nv_finance_private.pair('1200','5100',amt) else nv_finance_private.pair('5100','1200',amt) end;
 if nv_finance_private.sync_source('stock:'||r.id,dt,coalesce(r.note,'Physical stock adjustment'),null,ls) then changes:=changes+1;end if;
 end loop;
 return jsonb_build_object('changed_sources',changes,'missing_sale_costs',(select count(*) from public.sale_items i join public.sales s on s.id=i.sale_id where s.status::text='completed' and i.line_cost<=0),'source_count',(select count(*) from public.nv_source_posts));
end $$;
create function nv_finance_private.dispatch(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare jid uuid; aid uuid; st public.nv_statement_lines; bl record; dt date; amt numeric; cost numeric; dep numeric; ls jsonb; r record; res jsonb; monthdate date;
begin
 if auth.uid() is null or not coalesce(public.is_manager(),false) then raise exception 'Active manager access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('noshville-accounting',0));
 if action='sync' then return nv_finance_private.sync_all();
 elsif action='journal' then
 -- Manual postings cannot impersonate asset depreciation or automatic sources.
 if exists(select 1 from jsonb_array_elements(p->'lines') x where x->>'account' in ('1500','1590','6200')) then raise exception 'Use Assets for asset values and depreciation';end if;
 jid:=nv_finance_private.post((p->>'date')::date,p->>'description',p->>'reference','manual:'||(p->>'id')::uuid,p->'lines');
 return jsonb_build_object('id',jid);
 elsif action='reverse' then
 select * into r from public.nv_journals where id=(p->>'id')::uuid;
 if r.id is null or r.reversal_of is not null or r.asset_id is not null or r.source_key not like 'manual:%' then raise exception 'Only manual non-asset journals can be reversed here; correct source entries in their original screen';end if;
 select jsonb_agg(jsonb_build_object('account',account_code,'debit',credit,'credit',debit)) into ls from public.nv_lines where journal_id=r.id;
 jid:=nv_finance_private.post((p->>'date')::date,'Reversal: '||(p->>'reason'),r.reference,null,ls,null,r.id);
 return jsonb_build_object('id',jid);
 elsif action='depreciation' then
 perform nv_finance_private.sync_all();aid:=(p->>'asset')::uuid;dt:=(p->>'date')::date;amt:=round((p->>'amount')::numeric,2);
 select purchase_cost into cost from public.business_assets where id=aid and purchase_date<=dt;
 if cost is null or exists(select 1 from public.fund_movements where asset_id=aid and movement_type='reversal') then raise exception 'Select an active asset acquired by the posting date';end if;
 select coalesce(sum(l.credit-l.debit),0) into dep from public.nv_lines l join public.nv_journals j on j.id=l.journal_id where j.asset_id=aid and l.account_code='1590';
 if amt is null or amt<=0 or dep+amt>cost then raise exception 'Depreciation must be positive and cannot exceed the remaining asset cost';end if;
 if exists(select 1 from public.nv_journals where asset_id=aid and journal_date>dt and source_key like 'depreciation:%') then raise exception 'Depreciation date cannot precede an existing depreciation posting';end if;
 jid:=nv_finance_private.post(dt,'Depreciation',p->>'reference','depreciation:'||(p->>'id')::uuid,nv_finance_private.pair('6200','1590',amt),aid);
 return jsonb_build_object('id',jid);
 elsif action='bank_setup' then
 if exists(select 1 from public.nv_bank_config) then raise exception 'Bank opening balance is already configured; use a correcting journal';end if;
 dt:=(p->>'date')::date;amt:=round((p->>'amount')::numeric,2);
 if dt is null or amt is null or dt>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'Valid opening date and amount required';end if;
 insert into public.nv_bank_config(bank_name,account_name,last_four,opening_date,opening_balance,created_by) values(p->>'bank',p->>'name',nullif(p->>'last_four',''),dt,amt,auth.uid());
 if amt<>0 then jid:=nv_finance_private.post(dt,'Bank opening balance',null,'bank-opening',case when amt>0 then nv_finance_private.pair('1020','3100',amt) else nv_finance_private.pair('3100','1020',-amt) end);end if;
 return jsonb_build_object('id',jid);
 elsif action='statement' then
 if not exists(select 1 from public.nv_bank_config) then raise exception 'Set up the business bank account first';end if;
 if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows')>2000 then raise exception 'Import at most 2000 statement rows';end if;
 for r in select value x from jsonb_array_elements(p->'rows') loop
 dt:=(r.x->>'date')::date;
 if dt<(select opening_date from public.nv_bank_config) or dt>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'Statement date must be between bank opening and today';end if;
 insert into public.nv_statement_lines(id,transaction_date,description,reference,amount,balance,import_key,created_by) values(coalesce((r.x->>'id')::uuid,gen_random_uuid()),dt,r.x->>'description',r.x->>'reference',(r.x->>'amount')::numeric,(r.x->>'balance')::numeric,r.x->>'key',auth.uid()) on conflict do nothing;
 end loop;
 return jsonb_build_object('imported',jsonb_array_length(p->'rows'));
 elsif action='match' then
 select * into st from public.nv_statement_lines where id=(p->>'statement')::uuid;
 select l.*,j.journal_date into bl from public.nv_lines l join public.nv_journals j on j.id=l.journal_id where l.id=(p->>'line')::uuid and l.account_code='1020';
 if st.id is null or bl.id is null or st.amount<>bl.debit-bl.credit then raise exception 'Statement and bank book amounts/directions must match exactly';end if;
 insert into public.nv_bank_matches(statement_id,line_id,created_by) values(st.id,bl.id,auth.uid());return jsonb_build_object('matched',true);
 elsif action in ('close','reopen') then
 monthdate:=date_trunc('month',(p->>'month')::date)::date;
 if monthdate is null or length(btrim(coalesce(p->>'notes','')))=0 then raise exception 'Month and review / reopening reason required';end if;
 if action='close' then
  if (monthdate+interval '1 month')::date>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'Only completed months can be closed';end if;
  res:=nv_finance_private.sync_all();
  insert into public.nv_periods values(monthdate,auth.uid(),now(),p->>'notes') on conflict(month_start) do update set closed_by=excluded.closed_by,closed_at=excluded.closed_at,notes=excluded.notes;
 else
  update public.nv_periods set closed_at=null,closed_by=null,notes=p->>'notes' where month_start=monthdate;
 end if;
 insert into public.nv_period_events(month_start,action,notes,created_by) values(monthdate,action,p->>'notes',auth.uid());
 return jsonb_build_object('status',action);
 end if;
 raise exception 'Unknown accounting action';
end $$;
revoke all on all functions in schema nv_finance_private from public,anon,authenticated;
grant execute on function nv_finance_private.dispatch(text,jsonb) to authenticated;
create function public.nv_accounting(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select nv_finance_private.dispatch(p_action,p_payload)$$;
revoke all on function public.nv_accounting(text,jsonb) from public,anon;
grant execute on function public.nv_accounting(text,jsonb) to authenticated;
notify pgrst,'reload schema';
