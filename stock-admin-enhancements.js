(() => {
  let massDraft = {};
  let usageRows = [];

  function addStyles(){
    if(document.getElementById('stockAdminEnhancementStyles')) return;
    const s=document.createElement('style');
    s.id='stockAdminEnhancementStyles';
    s.textContent=`
      .enhance-card{margin-top:22px;padding-top:18px;border-top:2px solid var(--line)}
      .enhance-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,260px) auto auto;gap:8px;align-items:center;margin:10px 0}
      .enhance-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
      .mass-table input[type=number]{min-width:120px}
      .mass-table input[type=checkbox]{width:auto;transform:scale(1.15)}
      .variance-pos{color:#166534;font-weight:800}.variance-neg{color:#991b1b;font-weight:800}.variance-zero{color:#64748b}
      .status-pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:900}
      .status-on{background:#dcfce7;color:#166534;border:1px solid #86efac}
      .status-off{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
      .usage-actions{display:flex;gap:6px;flex-wrap:wrap}.usage-actions button{padding:6px 8px;font-size:11px}
      .mass-summary{font-size:12px;color:#64748b;margin:7px 0}
      @media(max-width:800px){.enhance-toolbar{grid-template-columns:1fr}.enhance-toolbar button{width:100%}}
    `;
    document.head.appendChild(s);
  }

  function esc(v){return String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));}
  function activeInputProducts(){ return products.filter(p=>p.input_active!==false); }
  function activeSellableProducts(){ return products.filter(p=>p.sellable_active!==false); }

  function installOverrides(){
    const originalRenderProductGrid = renderProductGrid;
    renderProductGrid = function(){
      const all=products;
      try{ products=activeSellableProducts(); return originalRenderProductGrid(); }
      finally{ products=all; }
    };

    const originalFillSelects = fillSelects;
    fillSelects = function(){
      originalFillSelects();
      const inputList=activeInputProducts();
      if($('purchaseProduct')) $('purchaseProduct').innerHTML='<option value="">Select product</option>'+inputList.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
      if($('countProduct')) $('countProduct').innerHTML='<option value="">Select product</option>'+inputList.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
      if($('barcodeProduct')) $('barcodeProduct').innerHTML='<option value="">Select product</option>'+activeSellableProducts().map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
    };
  }

  function installMassUI(){
    const panel=document.querySelector('#tab-stockcount .panel'); if(!panel||document.getElementById('massStockCard')) return;
    const recent=[...panel.querySelectorAll('h3')].find(x=>x.textContent.trim()==='Recent Adjustments');
    const card=document.createElement('div'); card.className='enhance-card'; card.id='massStockCard';
    card.innerHTML=`
      <h3>Mass Stock Adjustment</h3>
      <p class="muted">Adjust one or many input items from one screen. Only rows with a physical count and a difference will be changed.</p>
      <div class="enhance-toolbar">
        <input id="massSearch" placeholder="Search product / SKU / brand">
        <select id="massCategory"><option value="">All categories</option></select>
        <button id="massSelectVisible">Select Visible</button>
        <button id="massClearSelection">Clear Selection</button>
      </div>
      <div class="form-grid">
        <select id="massReason">
          <option value="Physical count adjustment">Physical count adjustment</option>
          <option value="Damage / waste">Damage / waste</option>
          <option value="Found stock">Found stock</option>
          <option value="Data correction">Data correction</option>
          <option value="Other">Other</option>
        </select>
        <input id="massNote" placeholder="Optional note for this batch">
      </div>
      <div id="massSummary" class="mass-summary"></div>
      <div id="massStockTable" class="table-wrap mass-table"></div>
      <div class="enhance-actions"><button id="saveMassAdjustments" class="primary">Save All Adjustments</button></div>
    `;
    if(recent) panel.insertBefore(card,recent); else panel.appendChild(card);
    $('massSearch').oninput=renderMassTable;
    $('massCategory').onchange=renderMassTable;
    $('massSelectVisible').onclick=()=>{ visibleMassProducts().forEach(p=>{massDraft[p.id]??={counted:'',selected:false};massDraft[p.id].selected=true;});renderMassTable(); };
    $('massClearSelection').onclick=()=>{Object.values(massDraft).forEach(x=>x.selected=false);renderMassTable();};
    $('saveMassAdjustments').onclick=saveMassAdjustments;
  }

  function installUsageUI(){
    const panel=document.querySelector('#tab-products .panel'); if(!panel||document.getElementById('usageAdminCard')) return;
    const anchor=$('productsTable');
    const card=document.createElement('div'); card.className='enhance-card'; card.id='usageAdminCard';
    card.innerHTML=`
      <h3>Item Activation / Deactivation</h3>
      <p class="muted">Control whether each item can be sold, used as a stock/input item, or both. Deactivating Sellable removes it from the SALE screen; deactivating Input removes it from purchasing and stock-count adjustment lists.</p>
      <div class="enhance-toolbar">
        <input id="usageSearch" placeholder="Search product / SKU / brand">
        <select id="usageFilter"><option value="all">All items</option><option value="selloff">Sellable inactive</option><option value="inputoff">Input inactive</option><option value="bothoff">Both inactive</option></select>
        <button id="usageRefresh">Refresh</button><span></span>
      </div>
      <div id="usageTable" class="table-wrap"></div>
    `;
    anchor.insertAdjacentElement('afterend',card);
    $('usageSearch').oninput=renderUsageTable;
    $('usageFilter').onchange=renderUsageTable;
    $('usageRefresh').onclick=loadUsageRows;
  }

  function categoryName(id){ return categories.find(c=>c.id===id)?.name||''; }
  function visibleMassProducts(){
    const q=($('massSearch')?.value||'').trim().toLowerCase(), cat=$('massCategory')?.value||'';
    return activeInputProducts().filter(p=>(!q||`${p.name} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(q))&&(!cat||p.category_id===cat));
  }

  function renderMassTable(){
    if(!$('massStockTable')) return;
    if($('massCategory')){
      const cur=$('massCategory').value;
      $('massCategory').innerHTML='<option value="">All categories</option>'+categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
      $('massCategory').value=cur;
    }
    const list=visibleMassProducts();
    const selected=Object.values(massDraft).filter(x=>x.selected).length;
    $('massSummary').textContent=`${list.length} visible input item(s) • ${selected} selected`;
    $('massStockTable').innerHTML=table(['Use','SKU','Product','Category','System Qty','Physical Count','Variance'],list.map(p=>{
      const d=massDraft[p.id]||{counted:'',selected:false};
      const has=d.counted!==''&&d.counted!==null;
      const variance=has?Number(d.counted)-Number(p.stock_qty||0):null;
      const vClass=variance===null?'variance-zero':variance>0?'variance-pos':variance<0?'variance-neg':'variance-zero';
      return [
        `<input type="checkbox" data-mass-select="${p.id}" ${d.selected?'checked':''}>`,
        esc(p.sku||''),esc(p.name),esc(categoryName(p.category_id)),Number(p.stock_qty||0).toFixed(3),
        `<input type="number" min="0" step="0.001" data-mass-count="${p.id}" value="${esc(d.counted)}" placeholder="Count">`,
        `<span class="${vClass}">${variance===null?'—':(variance>0?'+':'')+variance.toFixed(3)}</span>`
      ];
    }));
    document.querySelectorAll('[data-mass-select]').forEach(el=>el.onchange=()=>{const id=el.dataset.massSelect;massDraft[id]??={counted:'',selected:false};massDraft[id].selected=el.checked;updateMassSummary();});
    document.querySelectorAll('[data-mass-count]').forEach(el=>el.oninput=()=>{const id=el.dataset.massCount;massDraft[id]??={counted:'',selected:false};massDraft[id].counted=el.value;massDraft[id].selected=el.value!=='';renderMassTable();});
  }

  function updateMassSummary(){
    if(!$('massSummary')) return;
    $('massSummary').textContent=`${visibleMassProducts().length} visible input item(s) • ${Object.values(massDraft).filter(x=>x.selected).length} selected`;
  }

  async function saveMassAdjustments(){
    if(profile?.role!=='manager') return toast('Manager access required',true);
    const rows=Object.entries(massDraft).filter(([,d])=>d.selected&&d.counted!=='').map(([id,d])=>({product_id:id,counted_qty:Number(d.counted)}));
    if(!rows.length) return toast('Select at least one item and enter its physical count',true);
    if(rows.some(x=>!Number.isFinite(x.counted_qty)||x.counted_qty<0)) return toast('All selected physical counts must be zero or more',true);
    const changed=rows.filter(r=>{const p=products.find(x=>x.id===r.product_id);return p&&Number(r.counted_qty)!==Number(p.stock_qty||0);});
    if(!changed.length) return toast('No stock differences to save');
    if(!confirm(`Save mass stock adjustment for ${changed.length} product(s)?`)) return;
    $('saveMassAdjustments').disabled=true;
    const {data,error}=await sb.rpc('mass_stock_adjustment',{p_adjustments:changed,p_reason:$('massReason').value,p_note:$('massNote').value.trim()||null});
    $('saveMassAdjustments').disabled=false;
    if(error) return toast(error.message,true);
    toast(`${Number(data||0)} stock item(s) adjusted`);
    massDraft={}; $('massNote').value='';
    await refreshBase(); renderMassTable(); await loadStockAdjustments();
  }

  async function loadUsageRows(){
    if(profile?.role!=='manager'||!$('usageTable')) return;
    const {data,error}=await sb.from('products').select('id,sku,name,brand,is_active,sellable_active,input_active').order('name');
    if(error) return toast(error.message,true);
    usageRows=data||[]; renderUsageTable();
  }

  function renderUsageTable(){
    if(!$('usageTable')) return;
    const q=($('usageSearch')?.value||'').trim().toLowerCase(), f=$('usageFilter')?.value||'all';
    const rows=usageRows.filter(p=>{
      const match=!q||`${p.name} ${p.sku||''} ${p.brand||''}`.toLowerCase().includes(q);
      const sf=p.sellable_active!==false, inf=p.input_active!==false;
      const ff=f==='all'||(f==='selloff'&&!sf)||(f==='inputoff'&&!inf)||(f==='bothoff'&&!sf&&!inf);
      return match&&ff;
    });
    $('usageTable').innerHTML=table(['SKU','Product','Master','Sellable','Input','Actions'],rows.map(p=>{
      const sf=p.sellable_active!==false, inf=p.input_active!==false;
      return [esc(p.sku||''),esc(p.name),p.is_active?'<span class="status-pill status-on">ACTIVE</span>':'<span class="status-pill status-off">MASTER OFF</span>',sf?'<span class="status-pill status-on">ACTIVE</span>':'<span class="status-pill status-off">INACTIVE</span>',inf?'<span class="status-pill status-on">ACTIVE</span>':'<span class="status-pill status-off">INACTIVE</span>',`<div class="usage-actions"><button data-usage="sell" data-id="${p.id}" data-next="${sf?'false':'true'}">${sf?'Deactivate Sellable':'Activate Sellable'}</button><button data-usage="input" data-id="${p.id}" data-next="${inf?'false':'true'}">${inf?'Deactivate Input':'Activate Input'}</button><button data-usage="both" data-id="${p.id}" data-next="${sf&&inf?'false':'true'}">${sf&&inf?'Deactivate Both':'Activate Both'}</button></div>`];
    }));
    document.querySelectorAll('[data-usage]').forEach(b=>b.onclick=()=>toggleUsage(b.dataset.id,b.dataset.usage,b.dataset.next==='true'));
  }

  async function toggleUsage(id,type,next){
    if(profile?.role!=='manager') return toast('Manager access required',true);
    const p=usageRows.find(x=>x.id===id); if(!p) return;
    let sell=p.sellable_active!==false, input=p.input_active!==false;
    if(type==='sell') sell=next; else if(type==='input') input=next; else {sell=next;input=next;}
    const {error}=await sb.rpc('set_product_usage_status',{p_product_id:id,p_sellable_active:sell,p_input_active:input});
    if(error) return toast(error.message,true);
    toast(`${p.name}: Sellable ${sell?'ON':'OFF'} • Input ${input?'ON':'OFF'}`);
    await refreshBase(); await loadUsageRows(); renderMassTable();
  }

  function hookTabs(){
    document.querySelector('[data-tab="stockcount"]')?.addEventListener('click',()=>setTimeout(renderMassTable,0));
    document.querySelector('[data-tab="products"]')?.addEventListener('click',()=>setTimeout(loadUsageRows,0));
  }

  addStyles();
  installOverrides();
  installMassUI();
  installUsageUI();
  hookTabs();

  const oldEnterApp=enterApp;
  enterApp=async function(){
    await oldEnterApp();
    if(profile?.role==='manager'){
      renderMassTable();
      loadUsageRows();
    }
  };
})();