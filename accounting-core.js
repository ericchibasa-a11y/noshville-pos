(function(root){
'use strict';
const n=x=>Number(x||0),round=x=>Math.round((x+Number.EPSILON)*100)/100;
function balances(accounts,journals,lines,from,to){
 const js=new Map(journals.filter(j=>j.journal_date<=to&&(!from||j.journal_date>=from)).map(j=>[j.id,j]));
 return accounts.map(a=>{const ls=lines.filter(l=>l.account_code===a.code&&js.has(l.journal_id)),debit=round(ls.reduce((s,l)=>s+n(l.debit),0)),credit=round(ls.reduce((s,l)=>s+n(l.credit),0));return {...a,debit,credit,balance:round(debit-credit)}});
}
function statements(period,cumulative){
 const val=(rows,code)=>n(rows.find(a=>a.code===code)?.balance);
 const revenue=-val(period,'4000'),cogs=val(period,'5000')+val(period,'5100'),other=-val(period,'4100'),expenses=val(period,'6000')+val(period,'6100'),depreciation=val(period,'6200'),tax=val(period,'6300');
 const cumulativeProfit=-cumulative.filter(a=>['income','expense'].includes(a.kind)).reduce((s,a)=>s+a.balance,0);
 const assets=cumulative.filter(a=>a.kind==='asset').reduce((s,a)=>s+a.balance,0),liabilities=-cumulative.filter(a=>a.kind==='liability').reduce((s,a)=>s+a.balance,0),equity=-cumulative.filter(a=>a.kind==='equity').reduce((s,a)=>s+a.balance,0)+cumulativeProfit;
 return {revenue,cogs,gross:round(revenue-cogs),other,expenses,depreciation,tax,profit:round(revenue-cogs+other-expenses-depreciation-tax),assets:round(assets),liabilities:round(liabilities),equity:round(equity),positionDifference:round(assets-liabilities-equity)};
}
function bank(journals,lines,statements,matches,config,to){
 const openingDate=config?.opening_date||'0001-01-01',byJournal=new Map(journals.map(j=>[j.id,j]));
 const book=lines.filter(l=>l.account_code==='1020'&&byJournal.get(l.journal_id)?.journal_date<=to).map(l=>({...l,date:byJournal.get(l.journal_id).journal_date,description:byJournal.get(l.journal_id).description,reference:byJournal.get(l.journal_id).reference,amount:round(n(l.debit)-n(l.credit))}));
 const ss=statements.filter(s=>s.transaction_date<=to&&s.transaction_date>=openingDate).sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||Number(a.sequence||0)-Number(b.sequence||0)||a.id.localeCompare(b.id));
 const matchMap=new Map(matches.map(m=>[m.statement_id,m.line_id]));
 const matchedBook=new Set(ss.filter(s=>matchMap.has(s.id)&&book.some(b=>b.id===matchMap.get(s.id))).map(s=>matchMap.get(s.id)));
 const unStatement=ss.filter(s=>!matchedBook.has(matchMap.get(s.id))),unBook=book.filter(b=>!matchedBook.has(b.id)&&byJournal.get(b.journal_id).source_key!=='bank-opening'&&b.date>=openingDate);
 const statementBalance=round(n(config?.opening_balance)+ss.reduce((s,x)=>s+n(x.amount),0)),bookBalance=round(book.reduce((s,x)=>s+x.amount,0));
 const adjustedStatement=round(statementBalance+unBook.reduce((s,x)=>s+x.amount,0)),adjustedBook=round(bookBalance+unStatement.reduce((s,x)=>s+n(x.amount),0));
 const reportedDifferences=[];let rolling=n(config?.opening_balance);for(const s of ss){rolling=round(rolling+n(s.amount));if(s.balance!==null&&Math.abs(n(s.balance)-rolling)>0.005)reportedDifferences.push(s);}
 return {reportedDifferences,book,ss,unStatement,unBook,statementBalance,bookBalance,adjustedStatement,adjustedBook,difference:round(adjustedStatement-adjustedBook),rawDifference:round(statementBalance-bookBalance),latestReportedBalance:[...ss].reverse().find(s=>s.balance!==null)?.balance??null};
}
// RFC-style quoted CSV, including embedded commas and newlines.
function csv(text){let rows=[],row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}else field+=c;}
 if(quoted)throw Error('CSV has an unclosed quote');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2)throw Error('CSV needs headings and at least one transaction');
 const headers=rows.shift().map(x=>x.trim().toLowerCase().replace(/^\uFEFF/,''));
 const index=k=>headers.indexOf(k),date=index('date'),description=index('description'),debit=index('debit'),credit=index('credit'),reference=index('reference'),balance=index('balance');
 if(date<0||description<0||debit<0||credit<0)throw Error('Required CSV headings: Date, Description, Debit, Credit. Optional: Reference, Balance');
 const num=x=>{const s=String(x||'0').replace(/[R\s,]/g,'');if(!/^-?\d+(\.\d{1,2})?$/.test(s))throw Error('Invalid money value: '+x);return Number(s)};
 return rows.map((r,i)=>{const d=r[date]?.trim(),out=num(r[debit]),inn=num(r[credit]);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d)throw Error('Row '+(i+2)+': use dates YYYY-MM-DD');if(!((out>0&&inn===0)||(inn>0&&out===0)))throw Error('Row '+(i+2)+': one positive debit or credit required');return {date:d,description:r[description]?.trim()||'Bank statement',reference:reference>=0?r[reference]:null,amount:round(inn-out),balance:balance>=0&&r[balance]?.trim()?num(r[balance]):null};});
}
const api={balances,statements,bank,csv};root.NoshvilleAccounting=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
