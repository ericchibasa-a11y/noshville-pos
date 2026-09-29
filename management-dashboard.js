const SUPABASE_URL = "https://gknaqtvkqjwqwkovmajg.supabase.co";
const SUPABASE_KEY = "sb_publishable_P9Tl9D6E9pEZKZVqDWoKFw_NS1C0qR1";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const money = n => 'R' + Number(n || 0).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
const num = n => Number(n || 0);
const esc = v => String(v ?? '').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const localDate = d => { const x=new Date(d); const off=x.getTimezoneOffset(); return new Date(x.getTime()-off*60000).toISOString().slice(0,10); };
const today = () => localDate(new Date());
let currentItemRows=[];

function toast(msg,error=false){const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=msg;$('toast').appendChild(el);setTimeout(()=>el.remove(),4500)}
function table(headers,rows){if(!rows.length)return '<div class="dash-empty">No data for this period.</div>';return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
function metric(label,value,cls=''){return `<div class="metric ${cls}"><span>${label}</span><strong>${value}</strong></div>`}
function setLoading(on){$('dashboard')?.classList.toggle('loading',on);$('refreshBtn').disabled=on}
function startIso(d){return `${d}T00:00:00.000Z`}
function endIso(d){return `${d}T23:59:59.999Z`}
function pct(a,b){return b?`${((a/b)*100).toFixed(1)}%`:'0.0%'}

async function verifyAccess(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){location.href='index.html';return null}
  const {data:profile,error}=await sb.from('profiles').select('full_name,role,is_active').eq('id',session.user.id).single();
  if(error||!profile?.is_active||profile.role!=='manager'){
    $('authGate').innerHTML='<div class="auth-card"><h2>Manager access required</h2><p class="muted">This dashboard is available to Noshville managers only.</p><a href="index.html">Return to POS</a></div>';return null
  }
  $('authGate').classList.add('hidden');$('dashboard').classList.remove('hidden');$('dashUser').textContent=`${profile.full_name||session.user.email} • Manager reporting`;return profile
}

function applyRange(kind){
  const d=new Date();let from=today(),to=today();
  if(kind==='yesterday'){d.setDate(d.getDate()-1);from=to=localDate(d)}
  if(kind==='week'){const day=(d.getDay()+6)%7;const s=new Date(d);s.setDate(d.getDate()-day);from=localDate(s)}
  if(kind==='month'){from=localDate(new Date(d.getFullYear(),d.getMonth(),1))}
  if(kind==='all'){from='2000-01-01'}
  $('fromDate').value=from;$('toDate').value=to;loadDashboard();
}

async function loadDashboard(){
  const from=$('fromDate').value||today(),to=$('toDate').value||today();
  if(from>to)return toast('From date cannot be after To date',true);
  setLoading(true);
  try{
    const [salesQ,expensesQ,productsQ,cashupsQ,purchasesQ,movesQ] = await Promise.all([
      sb.from('sales').select('id,order_no,sale_date,payment_method,total_amount,status').gte('sale_date',startIso(from)).lte('sale_date',endIso(to)).eq('status','completed').order('sale_date'),
      sb.from('expenses').select('*').gte('expense_date',from).lte('expense_date',to).order('expense_date',{ascending:false}),
      sb.from('products').select('id,sku,name,brand,pack_size,cost_price,selling_price,stock_qty,reorder_level,reorder_qty,track_stock,is_active').eq('is_active',true).order('name'),
      sb.from('cashups').select('*').gte('cashup_date',from).lte('cashup_date',to).order('cashup_date',{ascending:false}),
      sb.from('purchases').select('id,purchase_date,invoice_number,total_amount,transport_cost,suppliers(name)').gte('purchase_date',from).lte('purchase_date',to).order('purchase_date',{ascending:false}),
      sb.from('stock_movements').select('created_at,movement_type,quantity,unit_cost,note,products(name)').gte('created_at',startIso(from)).lte('created_at',endIso(to)).order('created_at',{ascending:false}).limit(1000)
    ]);
    [salesQ,expensesQ,productsQ,cashupsQ,purchasesQ,movesQ].forEach(q=>{if(q.error)throw q.error});
    const sales=salesQ.data||[],expenses=expensesQ.data||[],products=productsQ.data||[],cashups=cashupsQ.data||[],purchases=purchasesQ.data||[],moves=movesQ.data||[];
    const saleIds=sales.map(x=>x.id),purchaseIds=purchases.map(x=>x.id);
    const saleItemsQ=saleIds.length?await sb.from('sale_items').select('sale_id,product_id,description,quantity,unit_cost,unit_price,line_total,line_cost').in('sale_id',saleIds):{data:[]};
    const purchaseItemsQ=purchaseIds.length?await sb.from('purchase_items').select('purchase_id,product_id,quantity,unit_cost,line_total,products(name)').in('purchase_id',purchaseIds):{data:[]};
    if(saleItemsQ.error)throw saleItemsQ.error;if(purchaseItemsQ.error)throw purchaseItemsQ.error;
    renderAll({from,to,sales,items:saleItemsQ.data||[],expenses,products,cashups,purchases,purchaseItems:purchaseItemsQ.data||[],moves});
  }catch(e){console.error(e);toast('Dashboard could not load: '+e.message,true)}finally{setLoading(false)}
}

function renderAll(d){
  const {sales,items,expenses,products,cashups,purchases,purchaseItems,moves}=d;
  const revenue=sales.reduce((a,x)=>a+num(x.total_amount),0);
  const cogs=items.reduce((a,x)=>a+num(x.line_cost||num(x.quantity)*num(x.unit_cost)),0);
  const gp=revenue-cogs,expenseTotal=expenses.reduce((a,x)=>a+num(x.amount),0),net=gp-expenseTotal,units=items.reduce((a,x)=>a+num(x.quantity),0);
  $('overviewMetrics').innerHTML=[metric('Sales',money(revenue)),metric('Transactions',sales.length),metric('Units Sold',units.toFixed(0)),metric('COGS',money(cogs)),metric('Gross Profit',money(gp),gp>=0?'good':'bad'),metric('Gross Margin',pct(gp,revenue)),metric('Expenses',money(expenseTotal)),metric('Net Profit',money(net),net>=0?'good':'bad')].join('');
  $('profitMetrics').innerHTML=[metric('Revenue',money(revenue)),metric('COGS',money(cogs)),metric('Gross Profit',money(gp),gp>=0?'good':'bad'),metric('Expenses',money(expenseTotal)),metric('Net Profit',money(net),net>=0?'good':'bad'),metric('Net Margin',pct(net,revenue))].join('');

  const payments={cash:0,card:0,eft:0,other:0};sales.forEach(x=>payments[x.payment_method]=(payments[x.payment_method]||0)+num(x.total_amount));
  $('paymentTable').innerHTML=table(['Payment','Sales','% of Sales'],Object.entries(payments).map(([k,v])=>[esc(k.toUpperCase()),money(v),pct(v,revenue)]));

  const stockCost=products.reduce((a,p)=>a+num(p.stock_qty)*num(p.cost_price),0),stockRetail=products.reduce((a,p)=>a+num(p.stock_qty)*num(p.selling_price),0);
  const low=products.filter(p=>p.track_stock&&num(p.stock_qty)>0&&num(p.stock_qty)<=num(p.reorder_level));const out=products.filter(p=>p.track_stock&&num(p.stock_qty)<=0);
  const stockMetrics=[metric('Active Products',products.length),metric('Stock Cost Value',money(stockCost)),metric('Stock Retail Value',money(stockRetail)),metric('Potential Margin',money(stockRetail-stockCost)),metric('Low Stock',low.length,low.length?'bad':''),metric('Out of Stock',out.length,out.length?'bad':'')].join('');
  $('inventoryMetrics').innerHTML=stockMetrics;$('stockMetrics').innerHTML=stockMetrics;

  const byDay={};sales.forEach(s=>{const day=String(s.sale_date).slice(0,10);byDay[day]??={sales:0,tx:0,cogs:0};byDay[day].sales+=num(s.total_amount);byDay[day].tx++});
  const saleById=Object.fromEntries(sales.map(s=>[s.id,String(s.sale_date).slice(0,10)]));items.forEach(i=>{const day=saleById[i.sale_id];if(day&&byDay[day])byDay[day].cogs+=num(i.line_cost||num(i.quantity)*num(i.unit_cost))});
  $('dailyTable').innerHTML=table(['Date','Transactions','Sales','COGS','Gross Profit'],Object.keys(byDay).sort().reverse().map(day=>[day,byDay[day].tx,money(byDay[day].sales),money(byDay[day].cogs),money(byDay[day].sales-byDay[day].cogs)]));

  const perf={};products.forEach(p=>perf[p.id]={id:p.id,sku:p.sku||'',name:p.name,qty:0,revenue:0,cost:0,gp:0,stock:num(p.stock_qty)});
  items.forEach(i=>{const k=i.product_id||`text:${i.description}`;perf[k]??={id:k,sku:'',name:i.description||'Unknown',qty:0,revenue:0,cost:0,gp:0,stock:0};const r=perf[k];const rv=num(i.line_total||num(i.quantity)*num(i.unit_price)),co=num(i.line_cost||num(i.quantity)*num(i.unit_cost));r.qty+=num(i.quantity);r.revenue+=rv;r.cost+=co;r.gp+=rv-co});
  currentItemRows=Object.values(perf);
  const sold=currentItemRows.filter(x=>x.qty>0);const top=[...sold].sort((a,b)=>b.qty-a.qty).slice(0,20),least=[...sold].sort((a,b)=>a.qty-b.qty).slice(0,20),zero=currentItemRows.filter(x=>x.qty===0).sort((a,b)=>a.name.localeCompare(b.name));
  const perfRows=r=>[esc(r.sku),esc(r.name),r.qty.toFixed(3),money(r.revenue),money(r.cost),money(r.gp),pct(r.gp,r.revenue),r.stock.toFixed(3)];
  $('topItemsTable').innerHTML=table(['SKU','Product','Qty Sold','Sales','COGS','GP','Margin','Stock'],top.map(perfRows));
  $('leastItemsTable').innerHTML=table(['SKU','Product','Qty Sold','Sales','COGS','GP','Margin','Stock'],least.map(perfRows));
  $('zeroItemsTable').innerHTML=table(['SKU','Product','Current Stock','Selling Price'],zero.map(r=>{const p=products.find(x=>x.id===r.id);return[esc(r.sku),esc(r.name),r.stock.toFixed(3),money(p?.selling_price)]}));
  $('itemPerformanceTable').innerHTML=table(['SKU','Product','Qty Sold','Sales','COGS','GP','Margin','Stock'],[...currentItemRows].sort((a,b)=>b.revenue-a.revenue).map(perfRows));

  const lowCombined=[...out.map(p=>({...p,status:'OUT'})),...low.map(p=>({...p,status:'LOW'}))];
  $('lowStockTable').innerHTML=table(['Product','Stock','Reorder Level','Status'],lowCombined.map(p=>[esc(p.name),num(p.stock_qty).toFixed(3),num(p.reorder_level).toFixed(3),`<span class="pill ${p.status==='OUT'?'danger':'warn'}">${p.status}</span>`]));
  $('stockValueTable').innerHTML=table(['Product','Qty','Cost Value','Retail Value'],[...products].sort((a,b)=>num(b.stock_qty)*num(b.cost_price)-num(a.stock_qty)*num(a.cost_price)).slice(0,30).map(p=>[esc(p.name),num(p.stock_qty).toFixed(3),money(num(p.stock_qty)*num(p.cost_price)),money(num(p.stock_qty)*num(p.selling_price))]));
  $('stockMovementTable').innerHTML=table(['Date/Time','Product','Type','Qty','Unit Cost','Note'],moves.map(m=>[new Date(m.created_at).toLocaleString(),esc(m.products?.name||''),esc(m.movement_type),num(m.quantity).toFixed(3),money(m.unit_cost),esc(m.note||'')]));

  const exBy={};expenses.forEach(x=>exBy[x.category]=(exBy[x.category]||0)+num(x.amount));
  $('expenseCategoryTable').innerHTML=table(['Category','Amount','% of Expenses'],Object.entries(exBy).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[esc(k),money(v),pct(v,expenseTotal)]));
  $('expenseTable').innerHTML=table(['Date','Category','Description','Amount','Payment'],expenses.map(x=>[x.expense_date,esc(x.category),esc(x.description||''),money(x.amount),esc(x.payment_method)]));

  const totalVariance=cashups.reduce((a,x)=>a+num(x.variance),0);$('cashupMetrics').innerHTML=[metric('Cash-Ups Closed',cashups.length),metric('Total Variance',money(totalVariance),Math.abs(totalVariance)>0.01?'bad':'good'),metric('Cash Sales',money(cashups.reduce((a,x)=>a+num(x.cash_sales),0))),metric('Actual Cash',money(cashups.reduce((a,x)=>a+num(x.actual_cash),0)))].join('');
  $('cashupTable').innerHTML=table(['Date','Cash Sales','Card','EFT','Expected','Actual','Variance'],cashups.map(x=>[x.cashup_date,money(x.cash_sales),money(x.card_sales),money(x.eft_sales),money(x.expected_cash),money(x.actual_cash),money(x.variance)]));
  const closedDates=new Set(cashups.map(x=>x.cashup_date)),salesByDate={};sales.forEach(s=>{const day=String(s.sale_date).slice(0,10);salesByDate[day]=(salesByDate[day]||0)+num(s.total_amount)});
  const unclosed=Object.entries(salesByDate).filter(([day])=>!closedDates.has(day));$('unclosedTable').innerHTML=table(['Date','Sales','Status'],unclosed.map(([day,v])=>[day,money(v),'<span class="pill danger">UNCLOSED</span>']));

  const purchaseTotal=purchases.reduce((a,x)=>a+num(x.total_amount)+num(x.transport_cost),0);const receivedUnits=purchaseItems.reduce((a,x)=>a+num(x.quantity),0);
  $('purchaseMetrics').innerHTML=[metric('Purchases',purchases.length),metric('Purchase Value',money(purchaseTotal)),metric('Units Received',receivedUnits.toFixed(3))].join('');
  $('purchaseTable').innerHTML=table(['Date','Invoice','Supplier','Goods','Transport','Total'],purchases.map(p=>[p.purchase_date,esc(p.invoice_number||''),esc(p.suppliers?.name||''),money(p.total_amount),money(p.transport_cost),money(num(p.total_amount)+num(p.transport_cost))]));
  const purchaseMap=Object.fromEntries(purchases.map(p=>[p.id,p]));$('purchaseItemTable').innerHTML=table(['Date','Invoice','Product','Qty','Unit Cost','Line Total'],purchaseItems.map(i=>{const p=purchaseMap[i.purchase_id]||{};return[p.purchase_date||'',esc(p.invoice_number||''),esc(i.products?.name||''),num(i.quantity).toFixed(3),money(i.unit_cost),money(i.line_total||num(i.quantity)*num(i.unit_cost))]}));
}

function exportCsv(){
  const rows=[['SKU','Product','Qty Sold','Sales','COGS','Gross Profit','Current Stock'],...currentItemRows.map(r=>[r.sku,r.name,r.qty,r.revenue,r.cost,r.gp,r.stock])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`noshville-item-performance-${$('fromDate').value}-to-${$('toDate').value}.csv`;a.click();URL.revokeObjectURL(a.href)
}

async function init(){
  const ok=await verifyAccess();if(!ok)return;
  $('fromDate').value=today();$('toDate').value=today();
  $('refreshBtn').onclick=loadDashboard;$('printBtn').onclick=()=>window.print();$('csvBtn').onclick=exportCsv;
  document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>applyRange(b.dataset.range));
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.dash-view').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`view-${b.dataset.view}`).classList.add('active')});
  await loadDashboard();
}
init();