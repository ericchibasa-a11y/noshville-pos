// Shared calculations: capital movements never enter operating profit.
window.NoshvilleFinance = {
 requestId() {
  if(typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
  // getRandomValues is available on HTTP too; retain UUID v4 retry keys.
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 },
 labels: {asset_purchase:'Asset purchase',owner_contribution:'Owner contribution',owner_drawing:'Owner drawing',transfer:'Till / bank transfer',stock_payment:'Stock payment',reversal:'Correction / reversal'},
 accounts: {till:'Till cash',bank:'Business bank',owner:'Owner funds',asset:'Asset purchase',supplier:'Stock supplier',register_only:'Register only'},
 totals(rows) {
  const out={tillIn:0,tillOut:0,bankIn:0,bankOut:0,assetPayments:0,ownerContributions:0,ownerDrawings:0,stockPayments:0};
  const originals=new Map(rows.map(r=>[r.id,r]));
  for(const r of rows){
   const a=Number(r.amount);
   if(r.to_account==='till')out.tillIn+=a;if(r.from_account==='till')out.tillOut+=a;
   if(r.to_account==='bank')out.bankIn+=a;if(r.from_account==='bank')out.bankOut+=a;
   const original=r.movement_type==='reversal'?originals.get(r.reversal_of):r;
   const type=original?.movement_type||r.original?.movement_type,sign=r.movement_type==='reversal'?-1:1;
   if(type==='asset_purchase')out.assetPayments+=sign*a;if(type==='owner_contribution')out.ownerContributions+=sign*a;
   if(type==='owner_drawing')out.ownerDrawings+=sign*a;if(type==='stock_payment')out.stockPayments+=sign*a;
  }
  return out;
 },
 expected(opening,cash,expenses,inflow,outflow){return Number(opening)+Number(cash)-Number(expenses)+Number(inflow)-Number(outflow)}
};
