const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
async function check(secure){
 const elements=new Map(),selects=[],errors=[];
 const element=()=>({value:'',disabled:false,innerHTML:'',textContent:'',addEventListener(){},appendChild(){},querySelector(){return element()}});
 const ctx={crypto:secure?crypto.webcrypto:{getRandomValues:crypto.webcrypto.getRandomValues.bind(crypto.webcrypto)},Uint8Array,Intl,Date,profile:{role:'manager'},$:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},today:()=> '2026-10-11',toast:m=>errors.push(m),escapeHtml:String,money:String,table:()=> 'rendered',document:{createElement:element},sb:{from(name){const q={select(s){selects.push([name,s]);return q},order(){return q},range(){return Promise.resolve({data:[],error:null})}};return q}}};
 ctx.window=ctx;vm.createContext(ctx);
 for(const file of ['finance-core.js','finance.js','accounting-core.js','accounting.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
 const ids=new Set();for(let i=0;i<1000;i++){const id=ctx.NoshvilleFinance.requestId();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);ids.add(id)}assert.equal(ids.size,1000);
 assert.equal(typeof elements.get('saveAssetBtn').onclick,'function');assert.equal(typeof elements.get('depPost').onclick,'function');
 await ctx.loadAssets();assert.deepEqual(errors,[]);assert.equal(elements.get('assetsTable').innerHTML,'rendered');assert(selects.some(([n,s])=>n==='fund_movements'&&s==='*'));
 const lookupIds=[];
 ctx.sb.from=()=>{const q={select(s){assert(!s.includes('original:'));return q},order(){return q},range(){return q},gte(){return q},lte(){return q},then(resolve){return Promise.resolve({data:[{id:'rev',reversal_of:'old',movement_type:'reversal',amount:100,from_account:'asset',to_account:'till'}],error:null}).then(resolve)},in(field,ids){assert.equal(field,'id');lookupIds.push(...ids);return Promise.resolve({data:[{id:'old',movement_type:'asset_purchase'}],error:null})}};return q};
 const rows=await ctx.financeRows('fund_movements','2026-10-01','2026-10-31');assert.deepEqual(lookupIds,['old']);assert.equal(rows[0].original.movement_type,'asset_purchase');assert.equal(ctx.NoshvilleFinance.totals(rows).assetPayments,-100);
 ctx.sb.from=()=>{const q={select(){return q},order(){return q},range(){return Promise.resolve({data:[{id:'old',movement_type:'asset_purchase',amount:100},{id:'rev',movement_type:'reversal',reversal_of:'old',amount:100}],error:null})},in(){throw Error('Should reuse loaded originals')}};return q};
 const all=await ctx.financeRows('fund_movements');assert.equal(ctx.NoshvilleFinance.totals(all).assetPayments,0);
}
(async()=>{await check(false);await check(true);console.log('HTTP and HTTPS finance/accounting startup and asset loading passed')})().catch(e=>{console.error(e);process.exitCode=1});
