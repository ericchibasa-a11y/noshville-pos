const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('finance-core.js','utf8'),ctx);
const f=ctx.window.NoshvilleFinance;
const movements=[{id:'a',movement_type:'asset_purchase',from_account:'till',to_account:'asset',amount:3000},{id:'b',movement_type:'owner_contribution',from_account:'owner',to_account:'till',amount:1000},{id:'c',movement_type:'transfer',from_account:'till',to_account:'bank',amount:500},{id:'d',movement_type:'owner_drawing',from_account:'bank',to_account:'owner',amount:200}];
const t=f.totals(movements);assert.equal(t.tillIn,1000);assert.equal(t.tillOut,3500);assert.equal(t.bankIn,500);assert.equal(t.bankOut,200);assert.equal(t.assetPayments,3000);assert.equal(f.expected(500,6000,100,t.tillIn,t.tillOut),3900);
const crossPeriod=f.totals([{id:'e',movement_type:'reversal',from_account:'asset',to_account:'till',amount:3000,reversal_of:'a',original:{movement_type:'asset_purchase'}}]);assert.equal(crossPeriod.assetPayments,-3000);assert.equal(crossPeriod.tillIn,3000);
console.log('Finance calculation scenarios passed');
