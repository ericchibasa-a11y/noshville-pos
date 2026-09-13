
const SUPABASE_URL = "https://gknaqtvkqjwqwkovmajg.supabase.co";
const SUPABASE_KEY = "sb_publishable_P9Tl9D6E9pEZKZVqDWoKFw_NS1C0qR1";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let session = null, profile = null, products = [], categories = [], suppliers = [], cart = [];

const $ = id => document.getElementById(id);
const money = n => 'R' + Number(n||0).toFixed(2);
const today = () => new Date().toISOString().slice(0,10);
function toast(msg, error=false) {
  const el=document.createElement('div'); el.className='toast'+(error?' error':''); el.textContent=msg; $('toast').appendChild(el);
  setTimeout(()=>el.remove(),4000);
}
function table(headers, rows) {
  return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
async function loadProfile() {
  const {data,error}=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error) throw error; profile=data;
  $('userInfo').textContent=`${profile.full_name||session.user.email} • ${profile.role}`;
  document.querySelectorAll('[data-manager]').forEach(el=>el.classList.toggle('hidden',profile.role!=='manager'));
}
async function refreshBase() {
  const [c,p,s] = await Promise.all([
    sb.from('categories').select('*').eq('is_active',true).order('sort_order'),
    sb.from('products').select('*').eq('is_active',true).order('name'),
    sb.from('suppliers').select('*').eq('is_active',true).order('name')
  ]);
  categories=c.data||[]; products=p.data||[]; suppliers=s.data||[];
  renderProductGrid(); fillSelects(); renderProductsTable(); renderSuppliersTable();
}
function fillSelects() {
  $('categoryFilter').innerHTML='<option value="">All categories</option>'+categories.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  $('pCategory').innerHTML='<option value="">Select category</option>'+categories.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  $('purchaseSupplier').innerHTML='<option value="">Select supplier</option>'+suppliers.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  $('purchaseProduct').innerHTML='<option value="">Select product</option>'+products.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
}
function renderProductGrid() {
  const q=$('saleSearch').value.toLowerCase(), cat=$('categoryFilter').value;
  const list=products.filter(p=>(!q || `${p.name} ${p.brand||''} ${p.barcode||''}`.toLowerCase().includes(q)) && (!cat || p.category_id===cat));
  $('productGrid').innerHTML=list.map(p=>`<div class="product-card" data-id="${p.id}"><strong>${p.name}</strong><div>${p.brand||''} ${p.pack_size||''}</div><div class="price">${money(p.selling_price)}</div><div class="stock">Stock: ${Number(p.stock_qty).toFixed(3)}</div></div>`).join('');
  document.querySelectorAll('.product-card').forEach(el=>el.onclick=()=>addToCart(el.dataset.id));
}

function updateTenderChange() {
  const payment=$('paymentMethod').value;
  const totalText=$('total').textContent.replace('R','').replace(/,/g,'');
  const total=Number(totalText||0);
  const tender=Number($('amountTendered').value||0);
  const change = payment==='cash' ? Math.max(0,tender-total) : 0;
  $('changeDue').textContent=money(change);
  $('changeRow').classList.toggle('hidden',payment!=='cash');
}

function addToCart(id) {
  const p=products.find(x=>x.id===id); if(!p) return;
  const existing=cart.find(x=>x.id===id);
  const next=(existing?.qty||0)+1;
  if(p.track_stock && next>Number(p.stock_qty)) return toast('Not enough stock',true);
  if(existing) existing.qty=next; else cart.push({...p,qty:1});
  renderCart();
}
function renderCart() {
  $('cart').innerHTML=cart.map((x,i)=>`<div class="cart-row"><div>${x.name}</div><input type="number" min="0.001" step="0.001" value="${x.qty}" data-q="${i}"><div>${money(x.qty*x.selling_price)}</div><button data-r="${i}">×</button></div>`).join('') || '<p class="muted">No items yet</p>';
  document.querySelectorAll('[data-q]').forEach(el=>el.onchange=()=>{const i=+el.dataset.q; const q=+el.value; if(q<=0)cart.splice(i,1); else if(cart[i].track_stock && q>Number(cart[i].stock_qty)){toast('Not enough stock',true); el.value=cart[i].qty;} else cart[i].qty=q; renderCart();});
  document.querySelectorAll('[data-r]').forEach(el=>el.onclick=()=>{cart.splice(+el.dataset.r,1);renderCart();});
  const sub=cart.reduce((a,x)=>a+x.qty*Number(x.selling_price),0), disc=Number($('discount').value||0), total=Math.max(0,sub-disc);
  $('subtotal').textContent=money(sub); $('total').textContent=money(total); updateTenderChange();
}
async function completeSale() {
  if(!cart.length) return toast('Add items first',true);
  const payment=$('paymentMethod').value, disc=Number($('discount').value||0);
  const sub=cart.reduce((a,x)=>a+x.qty*Number(x.selling_price),0), total=Math.max(0,sub-disc), tender=Number($('amountTendered').value||0);
  if(payment==='cash' && tender<total) return toast('Cash tendered is less than total',true);
  const {data:sale,error:saleErr}=await sb.from('sales').insert({
    cashier_id:session.user.id,payment_method:payment,subtotal:sub,discount:disc,total_amount:total,
    amount_tendered:payment==='cash'?tender:null,change_due:payment==='cash'?tender-total:0,status:'completed'
  }).select('id,order_no').single();
  if(saleErr) return toast(saleErr.message,true);
  const items=cart.map(x=>({sale_id:sale.id,product_id:x.id,description:x.name,quantity:x.qty,unit_cost:x.cost_price,unit_price:x.selling_price}));
  const {error:itemErr}=await sb.from('sale_items').insert(items);
  if(itemErr) {
    toast('Sale header saved but item save failed: '+itemErr.message,true); return;
  }
  toast(`Sale #${sale.order_no} completed • ${money(total)}`);
  cart=[];$('discount').value=0;$('amountTendered').value='';renderCart();await refreshBase();
}
function renderProductsTable() {
  if(profile?.role!=='manager') return;
  $('productsTable').innerHTML=table(['Product','Brand','Cost','Sell','Stock','Reorder'],products.map(p=>[p.name,p.brand||'',money(p.cost_price),money(p.selling_price),Number(p.stock_qty).toFixed(3),Number(p.reorder_level).toFixed(3)]));
}
async function saveProduct() {
  const payload={
    name:$('pName').value.trim(),brand:$('pBrand').value.trim()||null,pack_size:$('pPack').value.trim()||null,
    sku:$('pSku').value.trim()||null,barcode:$('pBarcode').value.trim()||null,category_id:$('pCategory').value||null,
    cost_price:+$('pCost').value||0,selling_price:+$('pSell').value||0,stock_qty:+$('pStock').value||0,
    reorder_level:+$('pReorderLevel').value||0,reorder_qty:+$('pReorderQty').value||0
  };
  if(!payload.name) return toast('Product name required',true);
  const {error}=await sb.from('products').insert(payload); if(error)return toast(error.message,true);
  toast('Product added'); ['pName','pBrand','pPack','pSku','pBarcode','pCost','pSell','pStock','pReorderLevel','pReorderQty'].forEach(id=>$(id).value=''); await refreshBase();
}
async function saveSupplier() {
  const payload={name:$('sName').value.trim(),contact_name:$('sContact').value.trim()||null,phone:$('sPhone').value.trim()||null,email:$('sEmail').value.trim()||null};
  if(!payload.name)return toast('Supplier name required',true);
  const {error}=await sb.from('suppliers').insert(payload);if(error)return toast(error.message,true);
  toast('Supplier added'); ['sName','sContact','sPhone','sEmail'].forEach(id=>$(id).value=''); await refreshBase();
}
function renderSuppliersTable() {
  if(profile?.role!=='manager') return;
  $('suppliersTable').innerHTML=table(['Supplier','Contact','Phone','Email'],suppliers.map(s=>[s.name,s.contact_name||'',s.phone||'',s.email||'']));
}
async function recordPurchase() {
  const supplier_id=$('purchaseSupplier').value||null, product_id=$('purchaseProduct').value, qty=+$('purchaseQty').value, unit=+$('purchaseUnitCost').value;
  if(!product_id||qty<=0||unit<0)return toast('Complete product, quantity and unit cost',true);
  const {data:p,error:pe}=await sb.from('purchases').insert({supplier_id,invoice_number:$('invoiceNo').value||null,purchase_date:$('purchaseDate').value||today(),total_amount:qty*unit,created_by:session.user.id}).select('id').single();
  if(pe)return toast(pe.message,true);
  const {error:ie}=await sb.from('purchase_items').insert({purchase_id:p.id,product_id,quantity:qty,unit_cost:unit});
  if(ie)return toast(ie.message,true);
  toast('Purchase recorded and stock updated'); $('purchaseQty').value='';$('purchaseUnitCost').value=''; await refreshBase(); await loadReorder();
}
async function loadReorder() {
  const {data,error}=await sb.from('product_reorder_view').select('*').order('needs_reorder',{ascending:false}).order('name');
  if(error)return;
  $('reorderTable').innerHTML=table(['Product','Stock','Reorder Level','Need Reorder','Suggested Qty','Est Cost'],(data||[]).map(x=>[x.name,Number(x.stock_qty).toFixed(3),Number(x.reorder_level).toFixed(3),x.needs_reorder?'YES':'No',Number(x.suggested_reorder_qty).toFixed(3),money(x.estimated_reorder_cost)]));
}
async function saveExpense() {
  const amount=+$('eAmount').value;if(amount<=0)return toast('Enter expense amount',true);
  const payload={expense_date:$('eDate').value||today(),category:$('eCategory').value.trim(),description:$('eDescription').value.trim()||null,amount,payment_method:$('ePayment').value,created_by:session.user.id};
  if(!payload.category)return toast('Expense category required',true);
  const {error}=await sb.from('expenses').insert(payload);if(error)return toast(error.message,true);
  toast('Expense recorded'); $('eAmount').value='';$('eDescription').value=''; await loadExpenses();
}
async function loadExpenses() {
  if(profile?.role!=='manager') { $('expensesTable').innerHTML='<p class="muted">Expenses can be captured here. Detailed expense history is manager-only.</p>'; return; }
  const {data}=await sb.from('expenses').select('*').order('expense_date',{ascending:false}).limit(100);
  $('expensesTable').innerHTML=table(['Date','Category','Description','Amount','Payment'],(data||[]).map(x=>[x.expense_date,x.category,x.description||'',money(x.amount),x.payment_method]));
}
async function cashupPreview() {
  const d=$('cDate').value||today();
  const start=d+'T00:00:00', end=d+'T23:59:59.999';
  const [sales,exp]=await Promise.all([
    sb.from('sales').select('payment_method,total_amount').gte('sale_date',start).lte('sale_date',end).eq('status','completed'),
    sb.from('expenses').select('payment_method,amount').eq('expense_date',d)
  ]);
  const s=sales.data||[], e=exp.data||[];
  const sums={cash:0,card:0,eft:0,other:0}; s.forEach(x=>sums[x.payment_method]=(sums[x.payment_method]||0)+Number(x.total_amount));
  const cashExp=e.filter(x=>x.payment_method==='cash').reduce((a,x)=>a+Number(x.amount),0);
  const opening=+$('openingFloat').value||0, expected=opening+sums.cash-cashExp;
  const actualRaw=$('actualCash').value;
  const hasActual=actualRaw!=='' && actualRaw!==null;
  const actual=hasActual ? Number(actualRaw) : null;
  const variance=hasActual ? actual-expected : null;
  $('cashupPreview').innerHTML=[
    ['Cash Sales',money(sums.cash)],['Card',money(sums.card)],['EFT',money(sums.eft)],['Cash Expenses',money(cashExp)],['Expected Cash',money(expected)],['Variance',hasActual?money(variance):'—']
  ].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
  return {...sums,cashExp,opening,expected,actual,variance};
}
async function saveCashup() {
  const v=await cashupPreview(), d=$('cDate').value||today();
  if(v.actual===null) return toast('Enter actual cash counted before saving cash-up',true);
  const payload={cashup_date:d,cashier_id:session.user.id,opening_float:v.opening,cash_sales:v.cash,card_sales:v.card,eft_sales:v.eft,other_sales:v.other,cash_expenses:v.cashExp,expected_cash:v.expected,actual_cash:v.actual,variance:v.variance,notes:$('cashupNotes').value||null,created_by:session.user.id};
  const {error}=await sb.from('cashups').insert(payload);if(error)return toast(error.message,true);
  toast('Cash-up saved'); await loadCashups();
}
async function loadCashups() {
  const {data}=await sb.from('cashups').select('*').order('cashup_date',{ascending:false}).limit(50);
  $('cashupsTable').innerHTML=table(['Date','Cash Sales','Expected','Actual','Variance'],(data||[]).map(x=>[x.cashup_date,money(x.cash_sales),money(x.expected_cash),money(x.actual_cash),money(x.variance)]));
}
async function loadReports() {
  if(profile?.role!=='manager') return;
  const from=$('reportFrom').value||today(), to=$('reportTo').value||today();
  const [s,p,e]=await Promise.all([
    sb.from('daily_sales_summary').select('*').gte('sale_day',from).lte('sale_day',to).order('sale_day'),
    sb.from('daily_profit_summary').select('*').gte('sale_day',from).lte('sale_day',to).order('sale_day'),
    sb.from('expenses').select('amount').gte('expense_date',from).lte('expense_date',to)
  ]);
  const sales=s.data||[], profit=p.data||[], expenses=(e.data||[]).reduce((a,x)=>a+Number(x.amount),0);
  const revenue=sales.reduce((a,x)=>a+Number(x.total_sales),0), gp=profit.reduce((a,x)=>a+Number(x.gross_profit),0), net=gp-expenses;
  $('reportCards').innerHTML=[['Sales',money(revenue)],['Gross Profit',money(gp)],['Expenses',money(expenses)],['Net Profit',money(net)]].map(x=>`<div class="summary-card"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('');
  $('salesReport').innerHTML=table(['Date','Transactions','Sales','Cash','Card','EFT'],sales.map(x=>[x.sale_day,x.transactions,money(x.total_sales),money(x.cash_sales),money(x.card_sales),money(x.eft_sales)]));
  $('profitReport').innerHTML=table(['Date','Revenue','COGS','Gross Profit'],profit.map(x=>[x.sale_day,money(x.revenue),money(x.cost_of_goods),money(x.gross_profit)]));
}
async function bootstrapManager() {
  const {data,error}=await sb.rpc('bootstrap_first_manager'); if(error)return toast(error.message,true);
  toast('First manager activated'); await loadProfile(); await refreshBase();
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
  $('tab-'+name).classList.add('active'); document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');
  if(name==='stock')loadReorder(); if(name==='expenses')loadExpenses(); if(name==='cashup'){cashupPreview();loadCashups();} if(name==='reports')loadReports();
}
async function enterApp() {
  $('authView').classList.add('hidden');$('appView').classList.remove('hidden');
  try{await loadProfile();await refreshBase();}catch(e){toast(e.message,true)}
}
async function init() {
  ['purchaseDate','eDate','cDate','reportFrom','reportTo'].forEach(id=>$(id).value=today());
  const {data:{session:s}}=await sb.auth.getSession(); session=s;
  if(session) await enterApp();
}
$('loginBtn').onclick=async()=>{const {data,error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error)return toast(error.message,true);session=data.session;await enterApp();};
$('signupBtn').onclick=async()=>{const {data,error}=await sb.auth.signUp({email:$('email').value,password:$('password').value});if(error)return toast(error.message,true);toast(data.session?'Account created and signed in':'Account created. Check email if confirmation is enabled.'); if(data.session){session=data.session;$('bootstrapBtn').classList.remove('hidden');await enterApp();}};
$('bootstrapBtn').onclick=bootstrapManager;
$('logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload();};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('saleSearch').oninput=renderProductGrid;$('categoryFilter').onchange=renderProductGrid;$('discount').oninput=renderCart;
$('amountTendered').oninput=updateTenderChange;$('paymentMethod').onchange=()=>{updateTenderChange();};
$('completeSaleBtn').onclick=completeSale;$('clearCartBtn').onclick=()=>{cart=[];renderCart();};
$('saveProductBtn').onclick=saveProduct;$('saveSupplierBtn').onclick=saveSupplier;$('recordPurchaseBtn').onclick=recordPurchase;$('saveExpenseBtn').onclick=saveExpense;
$('cDate').onchange=cashupPreview;$('openingFloat').oninput=cashupPreview;$('actualCash').oninput=cashupPreview;$('saveCashupBtn').onclick=saveCashup;$('refreshReportsBtn').onclick=loadReports;
init();
