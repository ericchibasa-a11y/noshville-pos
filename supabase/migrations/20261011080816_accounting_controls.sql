alter table public.nv_statement_lines add column sequence bigint generated always as identity;
create function nv_finance_private.guard_asset_reversal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.movement_type='reversal' and new.asset_id is not null and exists(select 1 from public.nv_journals where asset_id=new.asset_id and source_key like 'depreciation:%') then raise exception 'This asset has posted depreciation. Ask the accountant to correct its ledger before reversing the acquisition payment';end if;
 return new;
end $$;
revoke all on function nv_finance_private.guard_asset_reversal() from public,anon,authenticated;
create trigger guard_asset_reversal before insert on public.fund_movements for each row execute function nv_finance_private.guard_asset_reversal();
create or replace function nv_finance_private.dispatch(action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare jid uuid; aid uuid; st public.nv_statement_lines; bl record; dt date; amt numeric; cost numeric; dep numeric; ls jsonb; r record; res jsonb; monthdate date;
begin
 if auth.uid() is null or not coalesce(public.is_manager(),false) then raise exception 'Active manager access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('noshville-accounting',0));
 if action in ('journal','depreciation') then
  select id into jid from public.nv_journals where source_key=(case when action='journal' then 'manual:' else 'depreciation:' end)||(p->>'id')::uuid;
  if jid is not null then return jsonb_build_object('id',jid,'already_posted',true);end if;
 end if;
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
 if exists(select 1 from public.nv_lines l join public.nv_journals j on j.id=l.journal_id where l.account_code='1020' and j.journal_date<dt) or
 exists(select 1 from public.fund_movements where (from_account='bank' or to_account='bank') and movement_date<dt) or
 exists(select 1 from public.sales where payment_method::text='eft' and (sale_date at time zone 'Africa/Johannesburg')::date<dt) or
 exists(select 1 from public.expenses where payment_method::text in ('card','eft') and expense_date<dt) then
 raise exception 'Opening date must be on or before the first recorded bank transaction to avoid duplicating historic movements';end if;
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

notify pgrst,'reload schema';
