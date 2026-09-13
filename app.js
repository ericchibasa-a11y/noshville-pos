
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
  if(!profile.is_active){
    await sb.auth.signOut();
    $('appView').classList.add('hidden'); $('authView').classList.remove('hidden');
    throw new Error('This staff account is inactive. Please contact the manager.');
  }
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
  $('countProduct').innerHTML='<option value="">Select product</option>'+products.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
}
function renderProductGrid() {
  const q=$('saleSearch').value.toLowerCase(), cat=$('categoryFilter').value;
  const list=products.filter(p=>(!q || `${p.name} ${p.brand||''} ${p.barcode||''}`.toLowerCase().includes(q)) && (!cat || p.category_id===cat));
  $('productGrid').innerHTML=list.map(p=>{
    const stock=Number(p.stock_qty||0);
    const reorder=Number(p.reorder_level||0);
    const badge = stock<=0
      ? '<div class="stock-badge out">OUT OF STOCK</div>'
      : (p.track_stock && stock<=reorder ? '<div class="stock-badge low">LOW STOCK</div>' : '');
    return `<div class="product-card ${stock<=0?'product-disabled':''}" data-id="${p.id}">
      ${badge}
      <strong>${p.name}</strong>
      <div>${p.brand||''} ${p.pack_size||''}</div>
      <div class="price">${money(p.selling_price)}</div>
      <div class="stock">Stock: ${stock.toFixed(3)}</div>
    </div>`;
  }).join('');
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
  if(p.track_stock && Number(p.stock_qty)<=0) return toast('This product is out of stock',true);
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

function updateCountPreview() {
  const id=$('countProduct').value;
  const p=products.find(x=>x.id===id);
  const system=p?Number(p.stock_qty):0;
  $('systemQty').value=p?system.toFixed(3):'';
  const raw=$('countedQty').value;
  if(raw===''){ $('countDifference').value=''; return; }
  const counted=Number(raw||0);
  $('countDifference').value=(counted-system).toFixed(3);
}

async function saveStockAdjustment() {
  const product_id=$('countProduct').value;
  const p=products.find(x=>x.id===product_id);
  if(!p) return toast('Select a product',true);
  if($('countedQty').value==='') return toast('Enter physical counted quantity',true);

  const systemQty=Number(p.stock_qty||0);
  const countedQty=Number($('countedQty').value||0);
  if(countedQty < 0) return toast('Counted quantity cannot be negative',true);

  const diff=Number((countedQty-systemQty).toFixed(3));
  if(diff===0) return toast('No stock difference to record');

  const movement_type = diff>0 ? 'adjustment_in' : 'adjustment_out';

  const {error:me}=await sb.from('stock_movements').insert({
    product_id,
    movement_type,
    quantity:diff,
    unit_cost:p.cost_price,
    reference_type:'stock_count',
    note:`${$('countReason').value}${$('countNote').value ? ' - '+$('countNote').value : ''}`,
    created_by:session.user.id
  });
  if(me) return toast(me.message,true);

  const {error:pe}=await sb.from('products')
    .update({stock_qty:countedQty})
    .eq('id',product_id);
  if(pe) return toast(pe.message,true);

  toast(`Stock adjusted by ${diff>0?'+':''}${diff.toFixed(3)}`);
  $('countedQty').value='';
  $('countDifference').value='';
  $('countNote').value='';
  await refreshBase();
  await loadStockAdjustments();
}

async function loadStockAdjustments() {
  const {data,error}=await sb.from('stock_movements')
    .select('created_at,movement_type,quantity,note,products(name)')
    .in('movement_type',['adjustment_in','adjustment_out'])
    .order('created_at',{ascending:false})
    .limit(50);
  if(error) return toast(error.message,true);

  $('stockAdjustmentsTable').innerHTML=table(
    ['Date/Time','Product','Type','Qty','Note'],
    (data||[]).map(x=>[
      new Date(x.created_at).toLocaleString(),
      x.products?.name||'',
      x.movement_type==='adjustment_in'?'Adjustment In':'Adjustment Out',
      Number(x.quantity).toFixed(3),
      x.note||''
    ])
  );
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
  $('reorderTable').innerHTML=table(
    ['Product','Stock','Reorder Level','Need Reorder','Suggested Qty','Est Cost'],
    (data||[]).map(x=>[
      x.name,
      Number(x.stock_qty).toFixed(3),
      Number(x.reorder_level).toFixed(3),
      x.needs_reorder?'<span class="reorder-yes">YES</span>':'<span class="reorder-no">No</span>',
      Number(x.suggested_reorder_qty).toFixed(3),
      money(x.estimated_reorder_cost)
    ])
  );
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

async function loadStaff() {
  if(profile?.role!=='manager') return;
  const {data,error}=await sb.from('profiles').select('id,full_name,role,is_active,created_at').order('full_name');
  if(error) return toast(error.message,true);
  const ids=(data||[]).map(x=>x.id);
  // Emails are fetched securely from the manager Edge Function because auth.users is not exposed to browser clients.
  const {data:fn,error:fe}=await sb.functions.invoke('manage-staff',{body:{action:'list'}});
  if(fe) return toast('Staff service: '+fe.message,true);
  const emailById=Object.fromEntries((fn?.users||[]).map(x=>[x.id,x.email]));
  $('staffTable').innerHTML=table(['Name','Email','Role','Status','Actions'],(data||[]).map(u=>[
    u.full_name||'', emailById[u.id]||'', u.role,
    u.is_active?'<span class="staff-active">ACTIVE</span>':'<span class="staff-inactive">INACTIVE</span>',
    `<div class="staff-actions">
      <button data-staff-role="${u.id}" data-next-role="${u.role==='manager'?'salesperson':'manager'}">Make ${u.role==='manager'?'Salesperson':'Manager'}</button>
      <button data-staff-active="${u.id}" data-next-active="${u.is_active?'false':'true'}">${u.is_active?'Deactivate':'Activate'}</button>
    </div>`
  ]));
  document.querySelectorAll('[data-staff-role]').forEach(b=>b.onclick=()=>updateStaff(b.dataset.staffRole,{role:b.dataset.nextRole}));
  document.querySelectorAll('[data-staff-active]').forEach(b=>b.onclick=()=>updateStaff(b.dataset.staffActive,{is_active:b.dataset.nextActive==='true'}));
}

async function createStaff() {
  if(profile?.role!=='manager') return toast('Manager access required',true);
  const full_name=$('staffName').value.trim(), email=$('staffEmail').value.trim().toLowerCase(), password=$('staffPassword').value, role=$('staffRole').value;
  if(!full_name||!email) return toast('Enter employee name and email',true);
  if(password.length<8) return toast('Temporary password must be at least 8 characters',true);
  $('createStaffBtn').disabled=true;
  const {data,error}=await sb.functions.invoke('manage-staff',{body:{action:'create',full_name,email,password,role}});
  $('createStaffBtn').disabled=false;
  if(error) return toast(error.message,true);
  if(data?.error) return toast(data.error,true);
  toast('Staff account created');
  $('staffName').value=''; $('staffEmail').value=''; $('staffPassword').value=''; $('staffRole').value='salesperson';
  await loadStaff();
}

async function updateStaff(user_id,changes) {
  if(user_id===session.user.id && changes.is_active===false) return toast('You cannot deactivate your own account',true);
  const {data,error}=await sb.functions.invoke('manage-staff',{body:{action:'update',user_id,...changes}});
  if(error) return toast(error.message,true);
  if(data?.error) return toast(data.error,true);
  toast('Staff account updated'); await loadStaff();
}

async function bootstrapManager() {
  const {data,error}=await sb.rpc('bootstrap_first_manager'); if(error)return toast(error.message,true);
  toast('First manager activated'); await loadProfile(); await refreshBase();
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
  $('tab-'+name).classList.add('active'); document.querySelector(`[data-tab="${name}"]`)?.classList.add('active');
  if(name==='stock')loadReorder(); if(name==='stockcount'){updateCountPreview();loadStockAdjustments();} if(name==='expenses')loadExpenses(); if(name==='cashup'){cashupPreview();loadCashups();} if(name==='reports')loadReports(); if(name==='staff')loadStaff();
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
$('bootstrapBtn').onclick=bootstrapManager;
$('logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload();};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$('saleSearch').oninput=renderProductGrid;$('categoryFilter').onchange=renderProductGrid;$('discount').oninput=renderCart;
$('amountTendered').oninput=updateTenderChange;$('paymentMethod').onchange=()=>{updateTenderChange();};
$('completeSaleBtn').onclick=completeSale;$('clearCartBtn').onclick=()=>{cart=[];renderCart();};
$('saveProductBtn').onclick=saveProduct;$('saveSupplierBtn').onclick=saveSupplier;$('recordPurchaseBtn').onclick=recordPurchase;$('saveExpenseBtn').onclick=saveExpense;
$('countProduct').onchange=updateCountPreview;$('countedQty').oninput=updateCountPreview;$('saveStockAdjustmentBtn').onclick=saveStockAdjustment;
$('createStaffBtn').onclick=createStaff;
$('cDate').onchange=cashupPreview;$('openingFloat').oninput=cashupPreview;$('actualCash').oninput=cashupPreview;$('saveCashupBtn').onclick=saveCashup;$('refreshReportsBtn').onclick=loadReports;
init();
