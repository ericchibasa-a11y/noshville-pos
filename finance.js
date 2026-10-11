let assetRequestId=crypto.randomUUID(),fundRequestId=crypto.randomUUID();
const financeSelect='*,original:fund_movements!fund_movements_reversal_of_fkey(movement_type)';
const financeText=id=>$(id).value.trim()||null;
function managerFinance(){if(profile?.role!=='manager')throw new Error('Manager access required');}
async function financeRows(tableName,from,to){
 let rows=[];
 for(let offset=0;;offset+=1000){
  let q=sb.from(tableName).select(tableName==='fund_movements'?financeSelect:'*').order(tableName==='fund_movements'?'movement_date':'purchase_date',{ascending:false}).order('id').range(offset,offset+999);
  if(from)q=q.gte('movement_date',from).lte('movement_date',to);
  const {data,error}=await q;if(error)throw error;rows.push(...data);if(data.length<1000)return rows;
 }
}
function financeMovementTable(rows,corrections=false){
 const reversed=new Set(rows.filter(r=>r.reversal_of).map(r=>r.reversal_of));
 return table(['Date','Type','From','To','Amount','Description','Reference',...(corrections?['Correction']:[])],rows.map(r=>[
  escapeHtml(r.movement_date),escapeHtml(NoshvilleFinance.labels[r.movement_type]||r.movement_type),escapeHtml(NoshvilleFinance.accounts[r.from_account]),escapeHtml(NoshvilleFinance.accounts[r.to_account]),money(r.amount),escapeHtml(r.description),escapeHtml(r.reference||''),
  ...(corrections?[r.movement_type==='reversal'?'Reversal':reversed.has(r.id)?'Reversed':`<button data-reverse-fund="${r.id}">Reverse</button>`]:[])
 ]));
}
async function loadAssets(){
 try{
  managerFinance();const [assets,funds]=await Promise.all([financeRows('business_assets'),financeRows('fund_movements')]);
  const reversed=new Set(funds.filter(r=>r.movement_type==='reversal'&&r.asset_id).map(r=>r.asset_id));
  const active=assets.filter(a=>!reversed.has(a.id));
  $('assetMetrics').innerHTML=[['Registered Assets',active.length],['Purchase Cost',money(active.reduce((s,a)=>s+Number(a.purchase_cost),0))]].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
  $('assetsTable').innerHTML=table(['Date','Asset','Serial','Cost','Funding','Supplier','Invoice','Location','Condition','Status'],assets.map(a=>[escapeHtml(a.purchase_date),escapeHtml(a.asset_name),escapeHtml(a.serial_number||''),money(a.purchase_cost),escapeHtml(NoshvilleFinance.accounts[a.payment_source]),escapeHtml(a.supplier||''),escapeHtml(a.invoice_reference||''),escapeHtml(a.location||''),escapeHtml(a.condition),reversed.has(a.id)?'Payment reversed':'Registered']));
 }catch(e){$('assetsTable').textContent='Could not load assets: '+e.message;toast(e.message,true)}
}
async function saveAsset(){
 const btn=$('saveAssetBtn');if(btn.disabled)return;btn.disabled=true;
 try{
  managerFinance();const cost=Number($('aCost').value);
  if(!financeText('aName')||!$('aDate').value||!Number.isFinite(cost)||cost<=0)throw new Error('Enter asset name, purchase date and a positive cost');
  const {error}=await sb.rpc('record_business_asset',{p_id:assetRequestId,p_name:financeText('aName'),p_date:$('aDate').value,p_cost:cost,p_source:$('aSource').value,p_serial:financeText('aSerial'),p_supplier:financeText('aSupplier'),p_reference:financeText('aReference'),p_location:financeText('aLocation'),p_condition:$('aCondition').value,p_notes:financeText('aNotes')});
  if(error)throw error;
  assetRequestId=crypto.randomUUID();['aName','aCost','aSerial','aSupplier','aReference','aNotes'].forEach(id=>$(id).value='');
  toast('Asset recorded. Its payment is recorded once and excluded from operating expenses.');await loadAssets();
 }catch(e){toast(e.message,true)}finally{btn.disabled=false}
}
function fundAccounts(){
 const type=$('fType').value;
 const from=type==='owner_contribution'?['owner']:type==='stock_payment'?['till','bank','owner']:['till','bank'];
 const to=type==='owner_contribution'?['till','bank']:type==='owner_drawing'?['owner']:type==='stock_payment'?['supplier']:['till','bank'];
 const old=$('fFrom').value;
 const options=a=>a.map(x=>`<option value="${x}">${NoshvilleFinance.accounts[x]}</option>`).join('');
 $('fFrom').innerHTML=options(from);if(from.includes(old))$('fFrom').value=old;
 $('fTo').innerHTML=options(to.filter(x=>x!==$('fFrom').value));
}
async function loadFunds(){
 try{managerFinance();const rows=await financeRows('fund_movements');$('fundsTable').innerHTML=financeMovementTable(rows,true);
  $('fundsTable').querySelectorAll('[data-reverse-fund]').forEach(b=>b.onclick=()=>reverseFund(rows.find(r=>r.id===b.dataset.reverseFund),b));
 }catch(e){$('fundsTable').textContent='Could not load movements: '+e.message;toast(e.message,true)}
}
async function saveFund(){
 const btn=$('saveFundBtn');if(btn.disabled)return;btn.disabled=true;
 try{
  managerFinance();const amount=Number($('fAmount').value);
  if(!$('fDate').value||!financeText('fDescription')||!Number.isFinite(amount)||amount<=0)throw new Error('Enter date, description and a positive amount');
  const {error}=await sb.from('fund_movements').insert({id:fundRequestId,movement_date:$('fDate').value,movement_type:$('fType').value,from_account:$('fFrom').value,to_account:$('fTo').value,amount,description:financeText('fDescription'),reference:financeText('fReference'),created_by:session.user.id});
  if(error){if(error.code!=='23505')throw error;const existing=await sb.from('fund_movements').select('id').eq('id',fundRequestId).maybeSingle();if(existing.error||!existing.data)throw error;}
  fundRequestId=crypto.randomUUID();['fAmount','fDescription','fReference'].forEach(id=>$(id).value='');toast('Movement recorded');await loadFunds();
 }catch(e){toast(e.message,true)}finally{btn.disabled=false}
}
async function reverseFund(row,btn){
 if(!row||btn.disabled)return;
 const date=prompt('Correction date (YYYY-MM-DD). Till corrections must use a date that has not been cashed up.',today());if(!date)return;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return toast('Enter a date as YYYY-MM-DD',true);
 const reason=prompt('Reason for reversing this movement:');if(!reason?.trim())return;
 btn.disabled=true;
 try{managerFinance();const {error}=await sb.from('fund_movements').insert({movement_date:date,movement_type:'reversal',from_account:row.to_account,to_account:row.from_account,amount:row.amount,description:'Reversal: '+reason.trim(),reference:row.reference,asset_id:row.asset_id,reversal_of:row.id,created_by:session.user.id});if(error)throw error;toast('Correction recorded; original retained');await loadFunds();}catch(e){toast(e.message,true);btn.disabled=false}
}
async function loadFinanceReport(from,to){
 try{const rows=await financeRows('fund_movements',from,to),t=NoshvilleFinance.totals(rows);
 $('financeReportCards').innerHTML=[['Asset Payments',money(t.assetPayments)],['Owner Contributions',money(t.ownerContributions)],['Owner Drawings',money(t.ownerDrawings)],['Stock Payments',money(t.stockPayments)],['Till Funds In',money(t.tillIn)],['Till Funds Out',money(t.tillOut)],['Bank Movements In',money(t.bankIn)],['Bank Movements Out',money(t.bankOut)]].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
 $('financeReport').innerHTML=financeMovementTable(rows);
 }catch(e){$('financeReportCards').innerHTML='';$('financeReport').textContent='Financial movements could not load: '+e.message;toast(e.message,true)}
}
['aDate','fDate'].forEach(id=>$(id).value=today());
$('saveAssetBtn').onclick=saveAsset;$('saveFundBtn').onclick=saveFund;$('fType').onchange=fundAccounts;$('fFrom').onchange=fundAccounts;
$('assetForm').addEventListener('input',()=>assetRequestId=crypto.randomUUID());$('fundForm').addEventListener('input',()=>fundRequestId=crypto.randomUUID());
fundAccounts();
