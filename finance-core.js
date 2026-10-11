// Shared calculations: capital movements never enter operating profit.
window.NoshvilleFinance = {
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
