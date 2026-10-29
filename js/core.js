/* BDL PrepHub — js/core.js — shared data + helpers: users, SKU parser, VAT, dates, nav, search, stats.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── BROWSER STORAGE GUARD (v52.7) ────────────────────────────────────────────
/* Every app on jackbithellamazon.github.io shares ONE browser storage pot
   (~5 MB for all of them). On 27 Sep 2026 another app filled it and Sourcing's
   saves failed with nothing on screen. PrepHub's real work goes straight to the
   database, but the LOGIN lives in that pot: full pot = can't sign in, and the
   hourly login renewal can't be kept, so you're signed out within the hour.
   So: every write goes through lsSet. It never swallows a full pot —
   1) it drops our own throw-away copy (LS_DROP) and tries again,
   2) then it clears the stale old value of that key and tries again,
   3) then it keeps the value in memory for this tab (so the page and the login
      carry on) and shows the red bar. Everything below this file uses these. */
const LS_MEM={};                       // values the browser refused, held for this tab
const LS_DROP=['lv3_hub_sales'];       // our own copies of data that lives elsewhere — first to go
let _lsFull=false;
const _lsQuota=e=>!!e&&(e.name==='QuotaExceededError'||e.name==='NS_ERROR_DOM_QUOTA_REACHED'||e.code===22||e.code===1014);
function lsGet(k){
  if(Object.prototype.hasOwnProperty.call(LS_MEM,k))return LS_MEM[k];
  try{return localStorage.getItem(k);}catch(e){return null;}
}
function lsSet(k,v){
  v=String(v);
  const put=()=>{localStorage.setItem(k,v);delete LS_MEM[k];return true;};
  try{return put();}catch(e){
    if(_lsQuota(e)){
      LS_DROP.forEach(d=>{if(d!==k)try{localStorage.removeItem(d);}catch(_){}});
      try{return put();}catch(_){}
      try{localStorage.removeItem(k);}catch(_){}   // a stale old value must not come back on refresh
      try{return put();}catch(_){}
    }
    LS_MEM[k]=v;lsFullBar(e);return false;
  }
}
function lsDel(k){delete LS_MEM[k];try{localStorage.removeItem(k);}catch(e){}}
/* the login's storage — same key ('bdl-prephub-auth') and format as before, so
   nobody is signed out by this change */
const PH_AUTH_STORE={getItem:k=>lsGet(k),setItem:(k,v)=>{lsSet(k,v);},removeItem:k=>lsDel(k)};
function lsFullBar(e){
  _lsFull=true;
  try{console.warn('[PrepHub] browser storage refused a save — holding it in memory',e);}catch(_){}
  phBar('lsFullBar','⚠ <b>This laptop\'s browser storage is full.</b> PrepHub is still saving everything to the database, but this laptop won\'t remember your settings after a refresh. Tell Jack.');
}
/* the red bars stack at the bottom of every page, one per problem */
function phBar(id,html,bg){
  const paint=()=>{
    if(document.getElementById(id))return;
    let box=document.getElementById('phBars');
    if(!box){box=document.createElement('div');box.id='phBars';
      box.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:100000;display:flex;flex-direction:column;box-shadow:0 -2px 10px rgba(0,0,0,.35)';
      document.body.appendChild(box);}
    const b=document.createElement('div');b.id=id;b.setAttribute('role','alert');
    b.style.cssText='background:'+(bg||'#b91c1c')+';color:#fff;font:600 12.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:8px 16px;text-align:center;border-top:1px solid rgba(255,255,255,.18)';
    b.innerHTML=html;box.appendChild(b);
  };
  if(document.body)paint();else document.addEventListener('DOMContentLoaded',paint,{once:true});
}

// ── NEW VERSION BAR (v53.1) ───────────────────────────────────────────────────
/* Oct 2026: fixes went live and laptops kept running the old code for days,
   because nobody refreshes a tab that is open all day — the prep-fee loop kept
   running on them after it was fixed. Every 15 minutes (only while the tab is
   on screen) the page reads the tiny README-DEPLOY.txt from the site — GitHub,
   not the database — and if a newer build is live, a blue bar says refresh. */
const PH_BUILD=(()=>{try{const s=document.querySelector('script[src*="js/core.js"]');const m=s&&/[?&]v=(b\d+)/.exec(s.src);return m?m[1]:'';}catch(e){return '';}})();
let _verAt=0;
async function phCheckVersion(force){
  if(!PH_BUILD||document.hidden||document.getElementById('newVerBar'))return null;
  if(!force&&Date.now()-_verAt<5*60*1000)return null;   // coming back to the tab often is not a reason to ask often
  _verAt=Date.now();
  try{const r=await fetch('README-DEPLOY.txt?ts='+Date.now(),{cache:'no-store'});if(!r.ok)return null;
    const m=/\b(b\d{3,})\b/.exec(await r.text());if(!m)return null;
    if(m[1]!==PH_BUILD&&parseInt(m[1].slice(1))>parseInt(PH_BUILD.slice(1))){
      phBar('newVerBar',`A new version of PrepHub is live (${m[1]} — this tab is running ${PH_BUILD}). <button onclick="location.reload()" style="margin-left:8px;background:#fff;color:#1d4ed8;border:0;border-radius:5px;padding:3px 10px;font:700 12px inherit;cursor:pointer">Refresh now</button>`,'#1d4ed8');
      return m[1];}
  }catch(e){}
  return null;
}
setTimeout(phCheckVersion,60*1000);setInterval(phCheckVersion,15*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)phCheckVersion();});

// ── DATABASE WATCHDOG (v52.9) ────────────────────────────────────────────────
/* Oct 2026: a redraw loop asked the database ~13 times a second from every
   laptop for six weeks, and nobody could see it until Supabase emailed about
   Disk IO. Every database request now passes through phFetch (the Supabase
   client is built with it in sheet-sync.js) and is counted per minute. A quiet
   minute is a handful; a big Sync is ~100. A minute past 400, or three minutes
   in a row past 150, puts up the red bar naming what is being asked for. It
   only ever tells — it never blocks or slows a request. */
const DBW={min:0,n:0,by:{},run:0,tripped:false,paused:false,hist:[]};
function _dbwKey(url){
  try{const u=new URL(url,location.href);
    let k=u.pathname.replace(/^\/(rest|functions|auth|storage)\/v1\//,'');
    const key=u.searchParams.get('key');if(key)k+=' '+key.replace(/^eq\./,'');
    return k;}catch(e){return '?';}
}
function _dbwTick(url){
  if(DBW.paused)return;
  const m=Math.floor(Date.now()/60000);
  if(m!==DBW.min){
    if(DBW.min){
      DBW.run=(m===DBW.min+1&&DBW.n>=150)?DBW.run+1:0;
      DBW.hist.unshift({at:new Date(DBW.min*60000).toISOString().slice(11,16),n:DBW.n});DBW.hist.length=Math.min(DBW.hist.length,15);
    }
    DBW.min=m;DBW.n=0;DBW.by={};
  }
  DBW.n++;const k=_dbwKey(url);DBW.by[k]=(DBW.by[k]||0)+1;
  if(!DBW.tripped&&(DBW.n>=400||(DBW.run>=2&&DBW.n>=150)))dbwTrip();
}
function dbwTrip(){
  DBW.tripped=true;
  const top=Object.entries(DBW.by).sort((a,b)=>b[1]-a[1])[0]||['?',0];
  const e=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  try{console.warn('[PrepHub] database watchdog tripped',JSON.parse(JSON.stringify(DBW)));}catch(_){}
  phBar('dbwBar',`⚠ <b>PrepHub is asking the database far more than normal</b> — ${DBW.n} times this minute, mostly “${e(top[0])}” (${top[1]}×). That is a bug, not you: refresh the page to stop it for now, and send Jack a screenshot of this bar.`);
}
function phFetch(input,init){
  try{_dbwTick(typeof input==='string'?input:((input&&input.url)||String(input)));}catch(e){}
  return window.fetch(input,init);
}
// ── DATA ─────────────────────────────────────────────────────────────────────
const USERS=[
  {id:'jack',name:'Jack Bithell',init:'JB',role:'Owner',col:'#f59e0b'},
  {id:'uk',name:'UK Staff',init:'UK',role:'Prep Team',col:'#60a5fa'},
  {id:'va',name:'VA',init:'VA',role:'Admin',col:'#34d399'},
];
let cu={id:'',name:'-',role:'',init:'?',col:'#888888'}; // neutral until a real login sets identity

/* ── UK TIME, WHATEVER THE LAPTOP SAYS (13 Oct 2026) ──────────────────────
   Sarah works from the Philippines, 7–8 hours ahead. "Today" and "now" were
   read off each laptop's own clock, so after 17:00 UK her laptop was already
   on tomorrow: a chase was saved with tomorrow's date, a promised date came
   back a day early, and her 14:00 was written down as 21:00. Every helper here
   is the UK calendar and the UK clock. Jack: "as long as it says UK time". */
let _ukF=null;
function _ukParts(d){
  d=d==null?new Date():new Date(d);if(isNaN(d))d=new Date();
  try{
    if(!_ukF)_ukF=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',
      day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});
    const o={};_ukF.formatToParts(d).forEach(x=>{o[x.type]=x.value;});
    return{y:+o.year,m:+o.month,d:+o.day,h:o.hour==='24'?0:+o.hour,mi:+o.minute,
      wd:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(o.weekday)};
  }catch(e){return{y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate(),h:d.getHours(),mi:d.getMinutes(),wd:d.getDay()};}
}
const _p2=n=>String(n).padStart(2,'0');
/* the UK calendar day of a moment (default now), as YYYY-MM-DD */
function ukDayISO(d){const p=_ukParts(d);return`${p.y}-${_p2(p.m)}-${_p2(p.d)}`;}
/* minutes the UK is ahead of UTC at that moment: 60 in summer, 0 in winter */
function _ukOffMin(ms){const p=_ukParts(ms);return Math.round((Date.UTC(p.y,p.m-1,p.d,p.h,p.mi)-Math.floor(ms/6e4)*6e4)/6e4);}
/* the moment a UK calendar day starts (00:00 UK), in ms */
const _ukStartC={};
function _ukDayStart(y,m,d){
  const k=y+'-'+m+'-'+d;if(_ukStartC[k]!=null)return _ukStartC[k];
  const g=Date.UTC(y,m-1,d);return(_ukStartC[k]=g-_ukOffMin(g-36e5)*6e4);
}
/* a UK date plus n calendar days, as YYYY-MM-DD */
function ukAddDays(iso,n){const p=String(iso).slice(0,10).split('-').map(Number);
  return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10);}
/* UK day of the week for a YYYY-MM-DD: 0 Sunday … 6 Saturday */
const ukWeekdayOf=iso=>{const p=String(iso).slice(0,10).split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2])).getUTCDay();};
function todayISO(){return ukDayISO();}
function yesterdayISO(){return ukAddDays(ukDayISO(),-1);}
const todayDDMM=()=>{const p=_ukParts();return`${_p2(p.d)}/${_p2(p.m)}`;};
const getNowUK=()=>{const p=_ukParts();return`${_p2(p.d)}/${_p2(p.m)} ${_p2(p.h)}:${_p2(p.mi)}`;};

/* 22 Oct 2026: Jack typed 31/11/2026 — November has 30 days. A date box holding
   an impossible date SHOWS it but hands the app an empty value, so every save
   said "Pick a date first". Say what is actually wrong — on the save, and the
   moment you leave the box. */
function dateBoxMsg(el,fallback){
  return (el&&el.validity&&el.validity.badInput)
    ?'That date doesn\u2019t exist \u2014 check the day and month (31 November, 31 April, 30 February are not real days)'
    :fallback;
}
document.addEventListener('focusout',e=>{
  const el=e.target;if(!el||el.type!=='date')return;
  const bad=!!(el.validity&&el.validity.badInput);
  el.style.outline=bad?'2px solid #ef4444':'';
  if(bad)try{toast(dateBoxMsg(el),'er');}catch(_){}
},true);
// Parse DD/MM date to sortable YYYY/MM/DD using current year
function parseDDMM(s){
  if(!s)return'';
  const p=s.split('/');
  if(p.length<2)return s;
  return`2026/${p[1].padStart(2,'0')}/${p[0].padStart(2,'0')}`;
}

/* Jack, 10 Sep: "Sarah 11/09" on a note written at 18:00 on the 10th — every
   dd/mm stamp used the writer's OWN clock (Sarah is 8 hours ahead). One helper,
   always the UK date, used by every note/audit stamp in the app. */
function _ddUK(d){
  d=d?new Date(d):new Date();if(isNaN(d))d=new Date();
  try{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'2-digit'}).formatToParts(d);
    const g=t=>(p.find(x=>x.type===t)||{}).value||'';return g('day')+'/'+g('month');}
  catch(e){return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');}
}
/* The order date is in the SKU: Amuk_3.2_02096_0_PS_30 → 02096 = 02/09 (day,
   month, last digit of the year). Oct 2026: the Q3 tab's date column is headed
   "find", so 106 rows came in with no date — and a row with no date can never
   be late, so it never reached anyone's list (HIGH5 ×6, ordered 2 Sep, 41 days,
   nobody chasing). The sheet's own date always wins; this only fills a blank,
   in memory, and the Prep Sheet marks it as from the SKU. */
function skuDateDDMM(sku){
  const m=String(sku||'').match(/^[A-Za-z0-9]+_[\d.]+_(\d{2})(\d{2})\d_/);
  if(!m)return '';
  const dd=+m[1],mm=+m[2];
  return(dd>=1&&dd<=31&&mm>=1&&mm<=12)?m[1]+'/'+m[2]:'';
}
// ── SKU PARSER ─────────────────────────────────────────────────────────────────
// Format: Supplier_COGS_MinSellPrice_DateCode_Type_Units
function parseSKU(skuStr){
  if(!skuStr)return{sup:'',cogs:0,minSell:0,dateCode:'',type:'',units:0};
  const parts=skuStr.split('_');
  return{
    sup:parts[0]||'',
    cogs:parseFloat(parts[1])||0,
    minSell:parseFloat(parts[2])||0,
    dateCode:parts[3]||'',
    type:parts[4]||'',
    units:parseInt(parts[5])||0
  };
}

let rows=[];

// Sellable expected units = what actually gets sent to Amazon. For a bundle
// (bun='Yes', N items per bundle) the purchase sheet's physical "Total units"
// column counts individual items, so the number of saleable bundles is qty / N.
// e.g. 98 physical items in bundles of 2 → 49 units sent to Amazon. Non-bundle
// rows (or bundles with no/1 qty) are returned unchanged.
/* Reading the quantity off the sheet.
   This was `parseInt(A || B || C || 0)`, which assumed an unused column would be
   BLANK. Jack's tracker writes "N/A" — a truthy string — so the chain stopped at
   the first column and parseInt("N/A") came out as 0. Every non-bundle row would
   have synced in expecting ZERO units while bundle rows looked fine, so it read
   as half-broken rather than obviously wrong.
   Each column is tried in turn and only a real number is accepted. */
function _sheetQty(row){
  const cols=['Total units **','Quantity Bought','Quanity Bought *','Quanity Bought'];
  for(const c of cols){
    const raw=String(row[c]==null?'':row[c]).trim();
    if(!raw||/^n\/?a$/i.test(raw))continue;
    /* 13 Oct 2026: every digit used to be glued together — "48 (2 cases)" read
       as 482, "12.5" as 125. Now "2x24" is 48, otherwise the first number. */
    const mx=/^\s*(\d+)\s*[x×*]\s*(\d+)\s*$/i.exec(raw);
    if(mx)return parseInt(mx[1],10)*parseInt(mx[2],10);
    const m1=/-?\d+(?:\.\d+)?/.exec(raw.replace(/(\d),(?=\d{3}\b)/g,'$1'));
    const n=m1?Math.round(parseFloat(m1[0])):NaN;
    if(Number.isFinite(n)&&n>=0)return n;
  }
  return 0;
}
function sellableExp(qty,bun,bqty){
  const q=parseInt(qty)||0;
  const n=parseInt(bqty)||0;
  if(String(bun||'').trim()==='Yes'&&n>1){
    const bundles=Math.floor(q/n);
    return bundles>0?bundles:q;
  }
  return q;
}

/* ── PHYSICAL ITEMS vs ASIN UNITS ───────────────────────────────────────────
   Becki, 10 Aug: "98 bottles received does NOT mean 98 Amazon units sent. It
   means 98 physical bottles, which represents 49 Amazon ASIN units for a
   2-pack." She counts bottles off the pallet; Amazon is sent bundles.
   `exp`, `ship` and `rcvd` are all ASIN units — 56 places read `rcvd` and
   several set it straight from `exp`, so changing what it MEANS would quietly
   corrupt every one of them. The number stays in ASIN units; the box she types
   into is what changes, and these convert between the two.
   Pack size is `bqty` — already on the row, already synced from the Purchase
   Sheet. A non-bundle row is a pack of 1, so this is safe on every row. */
/* Typing into the Qty Received box on a bundle row. Converts items → units,
   and never silently swallows a part-pack: 93 bottles of a 2-pack is 46 units
   and one loose bottle, and the loose one is said out loud because it is real
   stock that cannot be sent. */
function setRcvdItems(rid,domId,items){
  const r=rows.find(x=>x.uuid===String(rid)||String(x.id)===String(rid));
  if(!r)return;
  const{units,loose,pack}=unitsFromItems(items,r);
  uf(rid,'rcvd',units);
  updateDiffCell(domId,units,r.exp||0);
  const sub=document.getElementById('rcvSub-'+domId);
  if(sub)sub.innerHTML=`<b>${units}</b> unit${units!==1?'s':''}`
    +(loose?`<br><span style="color:var(--amber)">${loose} loose item${loose!==1?'s':''}</span>`:'');
  if(loose)toast(`${items} items isn't a whole number of ${pack}-packs — booked in ${units} unit${units!==1?'s':''}, `
    +`${loose} loose item${loose!==1?'s':''} left over. Raise it as an issue so it isn't forgotten.`,'er');
  debounce('stats',renderStats);
}
/* One place that decides what counts as an auto refund, so the wording on the
   dropdown can change without quietly turning the behaviour off. */
const _isAutoRefund=t=>/auto\s*refund/i.test(String(t||''));
function packOf(r){
  const n=parseInt(r&&r.bqty)||0;
  return (String((r&&r.bun)||'').trim()==='Yes'&&n>1)?n:1;
}
const isBundle=r=>packOf(r)>1;
/* ASIN units → the number of individual things somebody physically handles */
const itemsOf=(units,r)=>(parseInt(units)||0)*packOf(r);
/* and back. Floors, because half a 2-pack cannot be sent to Amazon — the
   leftover is reported rather than quietly rounded away. */
function unitsFromItems(items,r){
  const n=packOf(r), q=Math.max(0,parseInt(items)||0);
  return{units:Math.floor(q/n),loose:q%n,pack:n};
}

// ── VAT HELPERS ───────────────────────────────────────────────────────────────
// VAT status is stored as '' (unknown), '0', '5' or '20'. Pulled from the
// purchase sheet on sync, or set manually via the row / Lavarion edit modals.
function normVat(raw){
  const s=String(raw==null?'':raw).trim().toLowerCase();
  if(s==='')return '';
  if(s.includes('free')||s.includes('exempt')||s.includes('zero')||s.includes('no vat'))return '0';
  if(s.includes('standard'))return '20';
  const n=parseFloat(s.replace(/[%£\s]/g,''));
  if(isNaN(n))return '';
  if(n===0)return '0';
  if(n>0&&n<1){ // fraction e.g. 0.2 / 0.05
    if(Math.abs(n-0.2)<0.02)return '20';
    if(Math.abs(n-0.05)<0.02)return '5';
    return n>=0.1?'20':'5';
  }
  if(Math.abs(n-20)<1)return '20';
  if(Math.abs(n-5)<1)return '5';
  return n>=10?'20':(n>=3?'5':'0');
}
function vatLabel(v){return v==='0'?'0% VAT-free':v==='5'?'5% VAT':v==='20'?'20% VAT':'';}
// Small inline marker — VAT-FREE is highlighted; 5%/20% shown subtly when present.
function vatBadge(v){
  if(v==='0')return `<span title="VAT-free / 0% VAT" style="font-size:8px;font-weight:800;padding:1px 6px;border-radius:8px;background:rgba(45,212,191,.16);color:#2dd4bf;border:1px solid rgba(45,212,191,.45);margin-left:5px;white-space:nowrap;letter-spacing:.03em;">VAT-FREE</span>`;
  return '';
}
// Always-visible VAT marker — one neutral grey style for every rate. Shows the
// real value (0% / 5% / 20%) pulled from the row / Lavarion detail. Own-account
// SKUs come from purchase-sheet column H on sync; if not pulled yet it shows a
// muted "VAT —" rather than guessing a rate.
function vatTag(v){
  v=(v===0||v==='0')?'0':(v===5||v==='5')?'5':(v===20||v==='20')?'20':'';
  const label=v===''?'VAT —':v+'% VAT';
  const extra=v===''?'border-style:dashed;color:var(--text3);':'color:var(--text2);';
  const tip=v===''?'VAT not set yet — fills from purchase-sheet column H on next sync':v+'% VAT';
  return `<span title="${tip}" style="font-size:8px;font-weight:700;padding:1px 6px;border-radius:8px;background:rgba(148,163,184,.14);border:1px solid var(--border2);${extra}margin-left:6px;white-space:nowrap;vertical-align:middle;">${label}</span>`;
}
function vatSelectOptions(v){
  return ['','20','5','0'].map(o=>`<option value="${o}" ${String(v||'')===o?'selected':''}>${o===''?'— (from sheet / unknown)':o==='20'?'20% (Standard)':o==='5'?'5% (Reduced)':'0% (VAT-free)'}</option>`).join('');
}



// Build a sortable key from a "DD/MM" (or "D/M") arrival date. Pads both parts
// and infers a year so dates line up correctly even when zero-padding is
// inconsistent (e.g. "20/5" vs "20/05") and around year boundaries. Returns a
// "YYYYMMDD" string; blank dates sort last.
function dateSortKey(dmy){
  if(!dmy)return '99999999';
  const parts=String(dmy).trim().split('/');
  if(parts.length<2)return '99999999';
  const d=parseInt(parts[0],10),m=parseInt(parts[1],10);
  if(!(d>=1&&d<=31)||!(m>=1&&m<=12))return '99999999';
  // Year: prefer an explicit 3rd part, else infer. Arrival dates cluster around
  // "now"; if the day/month is more than ~1 month into the future, it's last year.
  let y;
  if(parts[2]){y=parseInt(parts[2],10);if(y<100)y+=2000;}
  else{
    const now=new Date();y=now.getFullYear();
    const cand=new Date(y,m-1,d);
    const monthAhead=new Date();monthAhead.setMonth(monthAhead.getMonth()+1);
    if(cand>monthAhead)y-=1;
  }
  return String(y).padStart(4,'0')+String(m).padStart(2,'0')+String(d).padStart(2,'0');
}
// Sort rows — respects current sortBy field, defaults to date ascending
function sortRows(){
  const field=sortBy.field||'date';
  const asc=sortBy.field?sortBy.asc:true;
  rows.sort((a,b)=>{
    // Sent to Amazon always goes to bottom
    const aSent=a.status==='Sent to Amazon'?1:0;
    const bSent=b.status==='Sent to Amazon'?1:0;
    if(aSent!==bSent)return aSent-bSent;
    let av,bv;
    if(field==='date'){
      av=dateSortKey(a.date);bv=dateSortKey(b.date);
    }else if(field==='supplier'){
      av=(a.sup||'').toLowerCase();bv=(b.sup||'').toLowerCase();
    }else if(field==='account'){
      /* Becki, 25 Aug: she works one buying account at a time, so the sheet
         has to be able to line them up */
      av=(a.acct||'').toLowerCase();bv=(b.acct||'').toLowerCase();
      /* rows with no account go last, not first, in either direction */
      if(!av)av='￿';if(!bv)bv='￿';
    }else if(field==='status'){
      const order=['Issue','Not Arrived','In Warehouse','Delivered','In-Transit','Prepping','Boxed','Returned','Sent to Amazon'];
      av=order.indexOf(a.status);bv=order.indexOf(b.status);
      if(av<0)av=99;if(bv<0)bv=99;
    }else if(field==='received'){
      av=a.rcvd||0;bv=b.rcvd||0;
    }else if(field==='expected'){
      av=a.exp||0;bv=b.exp||0;
    }else{
      av=dateSortKey(a.date);bv=dateSortKey(b.date);
    }
    if(av<bv)return asc?-1:1;
    if(av>bv)return asc?1:-1;
    return 0;
  });
}

let claims=[];
let completed=[];
let editId=null,pendComp=null,pendClaim=null,nid=0;
// Boxes per shipment ID — stored separately as shipments are derived
let shipBoxes={};
let lavAsins=[]; // Lavarion ASIN permanent stock list
let lavShipments=[]; // Lavarion units added to shipments {shipId, asin, sku, prod, units, cost, date}
let lavEditId=null;
let _lavShipId=null; // current shipment being added to // {shipmentId: numberOfBoxes}

// ── KEYBOARD NAV ─────────────────────────────────────────────────────────────
let focusRow=-1,focusCol=-1;
const TOTAL_COLS=22;
function getVisibleCols(){
  const tbl=document.getElementById('prepTable');
  return tbl&&tbl.classList.contains('bundle-hidden')?TOTAL_COLS-2:TOTAL_COLS;
}
// Track previous focused elements directly — no loops on nav
let _prevFocusTr=null,_prevFocusTd=null;

function getRowEls(){return Array.from(document.querySelectorAll('#prepBody tr'));}

// Get only visible tds — uses getComputedStyle so CSS-cascade hidden cols are caught
function getVisibleTds(tr){
  if(!tr)return [];
  return Array.from(tr.querySelectorAll('td')).filter(td=>getComputedStyle(td).display!=='none');
}

function setFocus(r,c){
  if(_prevFocusTr){_prevFocusTr.classList.remove('row-focus');}
  if(_prevFocusTd){_prevFocusTd.classList.remove('cell-focused');}

  const trs=getRowEls();
  const tr=trs[r];if(!tr)return;
  const visibleTds=getVisibleTds(tr);
  const td=visibleTds[c];

  tr.classList.add('row-focus');
  if(td)td.classList.add('cell-focused');

  _prevFocusTr=tr;
  _prevFocusTd=td||null;
  focusRow=r;focusCol=c;
  (td||tr).scrollIntoView({block:'nearest',inline:'nearest'});
  // Clear navigating flag here — after focus is set, not before
  _navigating=false;
}

function getVisibleCols(){
  // Count from actual DOM — always accurate regardless of bundle state
  const trs=getRowEls();
  if(!trs.length){
    const tbl=document.getElementById('prepTable');
    return tbl&&tbl.classList.contains('bundle-hidden')?TOTAL_COLS-2:TOTAL_COLS;
  }
  return getVisibleTds(trs[0]).length;
}

function getFocusedInput(){
  const trs=getRowEls();
  if(focusRow<0||!trs[focusRow])return null;
  const td=getVisibleTds(trs[focusRow])[focusCol];
  return td?td.querySelector('input,select,textarea'):null;
}

let _navigating=false;

// ── SELECT AUTO-BLUR ──────────────────────────────────────────────────────────
// Blur ci-sel after mouse-driven change (keyboard Enter handled separately)
document.addEventListener('change',e=>{
  if(e.target&&e.target.classList.contains('ci-sel')){
    // Only blur if the change came from a mouse interaction (isTrusted + not keyboard)
    // Keyboard Enter on select fires change synchronously — Enter handler blurs it
    if(!_navigating){
      e.target.blur();
    }
  }
});

document.addEventListener('keydown',e=>{
  if(document.querySelector('.overlay.open'))return;
  if(!document.getElementById('page-prep').classList.contains('active'))return;
  const active=document.activeElement;
  // Bail immediately if the user is typing in ANY text input/textarea (search box,
  // bulk ship-id field, etc.) — the table keyboard-nav must never intercept those
  // keystrokes, or it blocks the character from appearing. Only cell editors (.ci)
  // and cell selects (.ci-sel) participate in navigation below.
  if(active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA')&&!active.classList.contains('ci')){return;}
  const inInput=active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA')&&active.classList.contains('ci');
  const inSelect=active&&active.tagName==='SELECT'&&active.classList.contains('ci-sel');
  const trs=getRowEls();if(!trs.length)return;

  /* 21 Oct 2026 (Jack: yes). Digits typed with a row selected used to EDIT it:
     "0" on Expected Qty saved 0 and the row dropped off the sheet, 1–8 on
     Status changed it (5 = Sent to Amazon). Becki types and scans barcodes, so
     a number typed anywhere on the Prep Sheet goes into the search box. A cell
     is still edited by clicking it, or Enter. */
  if(!inInput&&!inSelect&&/^[0-9]$/.test(e.key)&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
    const sb_=document.getElementById('prepSrch');
    if(sb_){e.preventDefault();sb_.focus();sb_.value=(sb_.value||'')+e.key;
      sb_.dispatchEvent(new Event('input',{bubbles:true}));return;}
  }

  // Space opens dropdown on focused cell
  if(e.key===' '&&!inInput&&!inSelect&&focusRow>=0){
    const td=getVisibleTds(trs[focusRow])[focusCol];
    const sel=td&&td.querySelector('select.ci-sel');
    if(sel){
      e.preventDefault();
      sel.focus();
      if(sel.showPicker){try{sel.showPicker();}catch(err){sel.click();}}
      else{sel.dispatchEvent(new MouseEvent('mousedown'));sel.click();}
      return;
    }
  }

  if(e.key==='ArrowDown'&&!inSelect){
    e.preventDefault();if(inInput)active.blur();
    if(focusRow<0){setFocus(0,0);return;}
    _navigating=true;
    setFocus(Math.min(focusRow+1,trs.length-1),focusCol<0?0:focusCol);
  }else if(e.key==='ArrowUp'&&!inSelect){
    e.preventDefault();if(inInput)active.blur();
    if(focusRow<0){setFocus(0,0);return;}
    _navigating=true;
    setFocus(Math.max(focusRow-1,0),focusCol<0?0:focusCol);
  }else if(e.key==='ArrowRight'&&!inInput&&!inSelect){
    e.preventDefault();
    if(focusRow<0){setFocus(0,0);return;}
    _navigating=true;
    setFocus(focusRow,Math.min(focusCol+1,getVisibleCols()-1));
  }else if(e.key==='ArrowLeft'&&!inInput&&!inSelect){
    e.preventDefault();
    if(focusRow<0){setFocus(0,0);return;}
    _navigating=true;
    setFocus(focusRow,Math.max(focusCol-1,0));
  }else if(e.key==='Tab'){
    e.preventDefault();if(inInput)active.blur();
    _navigating=true;
    let nc=(focusCol<0?0:focusCol)+(e.shiftKey?-1:1);
    let nr=focusRow<0?0:focusRow;
    if(nc>=getVisibleCols()){nc=0;nr=Math.min(nr+1,trs.length-1);}
    if(nc<0){nc=getVisibleCols()-1;nr=Math.max(nr-1,0);}
    setFocus(nr,nc);
  }else if(e.key==='Enter'){
    e.preventDefault();
    if(focusRow<0){setFocus(0,0);return;}
    const trs=getRowEls();
    const td=getVisibleTds(trs[focusRow])[focusCol];
    if(!td)return;
    const sel=td.querySelector('select.ci-sel');
    const inp=td.querySelector('input.ci,input.ci-num,input.ci-note');
    const chk=td.querySelector('input[type="checkbox"]');
    const sas=td.querySelector('.sas-btn');
    const btn=td.querySelector('button');
    if(inInput){
      active.blur();
      _navigating=true;
      setFocus(Math.min(focusRow+1,trs.length-1),focusCol);
    }else if(inSelect){
      active.blur();
      _navigating=true;
      setFocus(Math.min(focusRow+1,trs.length-1),focusCol);
    }else if(chk){
      // Toggle checkbox and update _selectedIds (keyed by uuid via data-rk)
      chk.checked=!chk.checked;
      const rk=chk.getAttribute('data-rk')||String(parseInt(trs[focusRow].dataset.id));
      if(chk.checked)_selectedIds.add(rk);else _selectedIds.delete(rk);
      updateBulkUI();
    }else if(sel){
      // Always open select first — even if cell also has a number input
      sel.focus();
      if(sel.showPicker){try{sel.showPicker();}catch(err){sel.click();}}
      else{sel.dispatchEvent(new MouseEvent('mousedown'));sel.click();}
    }else if(inp){
      inp.focus();
      if(inp.select)inp.select();
    }else if(sas){
      sas.click();
    }else if(btn){
      btn.click();
    }
  }else if(e.key==='Escape'){
    if(inInput)active.blur();
    else{
      if(_prevFocusTr)_prevFocusTr.classList.remove('row-focus');
      if(_prevFocusTd)_prevFocusTd.classList.remove('cell-focused');
      _prevFocusTr=null;_prevFocusTd=null;
      focusRow=-1;focusCol=-1;
    }
  }else if((e.key==='c'||e.key==='C')&&!e.ctrlKey&&!e.metaKey&&!inInput){
    const inp=getFocusedInput();
    if(inp&&inp.value)navigator.clipboard.writeText(inp.value).then(()=>toast('Copied: '+inp.value.slice(0,28)));
  }
});

document.addEventListener('click',e=>{
  // Block when clicking inside a native select — keyboard Enter fires a synthetic
  // click with target=SELECT, mouse clicks fire with target=OPTION or SELECT
  if(e.target.tagName==='SELECT'||e.target.tagName==='OPTION')return;
  const td=e.target.closest('td');
  const tr=e.target.closest('#prepBody tr');
  if(tr&&td){
    const trs=getRowEls();
    const ri=trs.indexOf(tr);
    const ci=getVisibleTds(tr).indexOf(td);
    if(ri>=0&&ci>=0)setFocus(ri,ci);
  }
});

// ── NAV / USER ────────────────────────────────────────────────────────────────
function toggleSb(){document.getElementById('sb').classList.toggle('open');}
function setSettingsTab(k,btn){
  const c=document.getElementById('settingsCols');if(!c)return;
  c.setAttribute('data-tab',k);
  document.querySelectorAll('#setTabs .setTabBtn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  if(k==='data'){try{setTimeout(pnFixPaint,50);setTimeout(psFixPaint,50);}catch(e){}}
}
function goPage(n,btn){
  try{paintJackBadge();}catch(e){}
  try{hideRowTip();}catch(e){}   /* a hover tip from the last page never follows you */
  document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('on'));
  /* Issues no longer has a sidebar button of its own, so it is now reachable
     from a link with no button to highlight. */
  if(btn&&btn.classList)btn.classList.add('on');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+n).classList.add('active');
  const t={dashboard:'Dashboard',prep:'Prep Sheet',shipments:'Shipments',lavarion:'PLUB ASINs',returns:'Returns',admin:"Sarah's Admin",jack:"Jack's Admin",claims:'Issues (old view)',insights:'Insights',audit:'Audit Log',lookup:'History Lookup',recovery:'Recovery Stock',settings:'Settings'};
  document.getElementById('pageTitle').textContent=t[n]||n;
  /* a page skipped while it was off-screen owes itself one repaint */
  if(n==='prep'&&_dirtyR.prep)renderPrep();
  if(n==='jack'){window._jkFreshVisit=true;renderJack();}
  if(n==='recovery'){_recSel.clear();renderRecovery();}
  if(n==='settings'){try{renderSyncIssues();}catch(e){}}
  if(n==='dashboard')renderDashboard();
  if(n==='insights')renderInsights();
  if(n==='audit'){buildAuditSeatFilter();loadAuditPage(true);}
  if(n==='claims')renderClaims();
  if(n==='admin')renderAdmin();
  if(n==='shipments'){setShipDateFilter(_shipDateFilter);}
  if(n==='lavarion')renderLavarion();
  if(n==='settings'){
    try{paintTimings();}catch(e){}
    try{acPaintCard();}catch(e){}
    paintWebhookInputs();
    ['tier1p','tier2p','tier3p','tier4p','boxCost','dgExtraPerBox','osCostPerUnit','bundleCostPerUnit','expectedMonthlyUnits'].forEach(k=>{
      const el=document.getElementById('pf-'+k);
      if(el)el.value=prepFees[k]||0;
    });
    loadSheetSyncUI();
    Promise.all([loadSyncSources(),loadSyncHistory(),loadSyncIssues()]).then(()=>{updateSyncHealthUI();try{renderSyncIssues();}catch(e){}});
  }
  if(n==='returns')renderReturns();
}
// ── GLOBAL SEARCH ─────────────────────────────────────────────────────────────
// Find a SKU or ASIN anywhere in the app and jump to where it lives.
/* Settings inputs are plain HTML, so they need filling from the saved config
   whenever that page is opened. */
/* Jump to Sarah's Admin and land on the section that needs doing. */
function goAdminSection(id){
  const btn=document.querySelector('.sb-item[onclick*="admin"]');
  goPage('admin',btn);
  setTimeout(()=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.style.transition='box-shadow .3s';
    el.style.boxShadow='0 0 0 3px var(--accent)';
    setTimeout(()=>{el.style.boxShadow='';},1600);
  },260);
}
function paintWebhookInputs(){
  try{renderResTypes();renderFollowUps();
    const js=document.getElementById('jackSups');if(js)js.value=JACK_SUPPLIERS.join(', ');}catch(e){}
  const u=document.getElementById('whUrl'),o=document.getElementById('whOn'),h=document.getElementById('whHours');
  if(u)u.value=WEBHOOK_CFG.url||'';
  if(o)o.checked=!!WEBHOOK_CFG.on;
  if(h)h.value=WEBHOOK_CFG.checkHours||48;
  try{renderWebhookCard();}catch(e){}
}
function navToPage(page){
  const btn=document.querySelector(`.sb-item[onclick*="goPage('${page}'"]`);
  if(btn)goPage(page,btn);
}
function closeGlobalSearch(){
  const box=document.getElementById('globalSrchResults');
  if(box){box.style.display='none';box.innerHTML='';}
}
document.addEventListener('click',e=>{
  const wrap=document.getElementById('globalSrch');
  const box=document.getElementById('globalSrchResults');
  if(!wrap||!box)return;
  if(e.target!==wrap&&!box.contains(e.target))closeGlobalSearch();
});
function gsJump(page,term){
  navToPage(page);
  const map={prep:'prepSrch',shipments:'shipSrch',returns:'returnSrch',lavarion:'lavSrch',claims:'claimSrch'};
  const inputId=map[page];
  setTimeout(()=>{
    const inp=document.getElementById(inputId);
    if(inp){inp.value=term;inp.dispatchEvent(new Event('input'));}
  },60);
  closeGlobalSearch();
  const g=document.getElementById('globalSrch');if(g)g.value='';
}
function runGlobalSearch(qRaw){
  _runGlobalSearchCore(qRaw);
  if(!_historyReady){
    const box=document.getElementById('globalSrchResults');
    if(box&&box.style.display!=='none')box.insertAdjacentHTML('beforeend',
      '<div style="padding:6px 12px;font-size:11px;color:var(--text3);border-top:1px solid var(--line,#333)">Older history still loading\u2026 results may be incomplete</div>');
  }
}
function _runGlobalSearchCore(qRaw){
  const q=(qRaw||'').trim().toLowerCase();
  const box=document.getElementById('globalSrchResults');
  if(!box)return;
  if(q.length<2){box.style.display='none';box.innerHTML='';return;}
  const hits=[];
  const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const match=r=>((r.sku||'')+' '+(r.asin||'')+' '+(r.ean||'')+' '+(r.prod||'')).toLowerCase().includes(q);
  // Prep rows + their shipment segments.
  rows.forEach(r=>{
    if(!match(r))return;
    const term=r.sku||r.asin;
    const segs=(typeof normaliseSegments==='function')?normaliseSegments(r):[];
    if(segs.length){
      segs.forEach(sg=>hits.push({page:'shipments',term,where:`Shipment ${sg.shipId}`,detail:`${sg.units} unit${sg.units!==1?'s':''} · ${r.sku}`,kind:'ship'}));
      if(r.status!=='Sent to Amazon'||r.archived)hits.push({page:'prep',term,where:r.archived?'Prep Sheet (Archived)':'Prep Sheet',detail:`${r.status} · ${r.prod||r.sku}`,kind:'prep'});
    }else{
      hits.push({page:'prep',term,where:r.archived?'Prep Sheet (Archived)':'Prep Sheet',detail:`${r.status} · ${r.prod||r.sku}`,kind:'prep'});
    }
  });
  (returnSkus||[]).forEach(r=>{if(match(r))hits.push({page:'returns',term:r.sku||r.asin,where:'Returns',detail:`${r.units||1} unit${(r.units||1)!==1?'s':''} · ${r.prod||r.sku}`,kind:'return'});});
  (returnShipments||[]).forEach(rs=>{if(match(rs))hits.push({page:'shipments',term:rs.sku,where:`Shipment ${rs.shipId}`,detail:`Return · ${rs.units||0} unit${(rs.units||0)!==1?'s':''}`,kind:'ship'});});
  (lavAsins||[]).forEach(l=>{if(match(l))hits.push({page:'lavarion',term:l.sku||l.asin,where:'PLUB',detail:`${l.prod||l.sku||l.asin}`,kind:'lav'});});
  (lavShipments||[]).forEach(ls=>{if(match(ls))hits.push({page:'shipments',term:ls.sku||ls.asin,where:`Shipment ${ls.shipId}`,detail:`PLUB · ${ls.units||0} unit${(ls.units||0)!==1?'s':''}`,kind:'ship'});});
  (claims||[]).forEach(c=>{if(match(c))hits.push({page:'claims',term:c.sku||c.asin,where:'Actions',detail:`${c.status||''} · ${c.prod||c.sku}`,kind:'claim'});});
  if(!hits.length){
    box.style.display='block';
    box.innerHTML=`<div style="padding:14px;text-align:center;color:var(--text3);font-size:11px;">No matches for "${esc(qRaw)}"</div>`;
    return;
  }
  const seen=new Set();const uniq=hits.filter(h=>{const k=h.page+'|'+h.where+'|'+h.detail;if(seen.has(k))return false;seen.add(k);return true;});
  const colors={ship:'var(--amber)',prep:'var(--green)',return:'var(--blue)',lav:'#c084fc',claim:'var(--red)'};
  box.style.display='block';
  box.innerHTML=`<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;padding:4px 8px 6px;">${uniq.length} result${uniq.length!==1?'s':''}</div>`+
    uniq.slice(0,40).map(h=>`
      <div onclick="gsJump('${h.page}','${esc(h.term).replace(/'/g,"\\'")}')" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;cursor:pointer;" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
        <span style="width:7px;height:7px;border-radius:50%;background:${colors[h.kind]||'var(--text3)'};flex-shrink:0;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(h.where)}</div>
          <div style="font-size:9.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(h.detail)}</div>
        </div>
        <span style="font-size:13px;color:var(--text3);flex-shrink:0;">→</span>
      </div>`).join('');
}
function cycleUser(){ /* disabled — identity now comes only from the signed-in Supabase account */ }

// ── COPY ─────────────────────────────────────────────────────────────────────
function copyVal(text,el){
  if(!text||text==='—')return;
  navigator.clipboard.writeText(text).then(()=>{
    /* Jack, 4 Sep: "copied it but still want to see the order id." It replaced
       the value with the word "copied" — so the thing he had just copied, and
       usually still needs to read while pasting it somewhere, vanished for a
       second. Same treatment copyShipId already used: keep the value, flash it
       green, and hang a tick off the end. */
    if(el.dataset.copying)return;
    el.dataset.copying='1';
    const oc=el.style.color||'';const obg=el.style.background||'';
    el.style.color='#22c55e';el.style.background='rgba(34,197,94,.14)';
    const tick=document.createElement('span');
    tick.className='copyTick';tick.textContent=' ✓';
    el.insertAdjacentElement('afterend',tick);
    setTimeout(()=>{el.style.color=oc;el.style.background=obg;tick.remove();delete el.dataset.copying;},1100);
  }).catch(()=>{});
}
// Copy a shipment ID. Keeps the ID text in place (so the row doesn't reflow) and
// flashes a small green tick after it, instead of replacing the whole title.
function copyShipId(id,el){
  if(!id)return;
  navigator.clipboard.writeText(id).then(()=>{
    const oc=el.style.color||'';const obg=el.style.background||'';
    el.style.color='#22c55e';el.style.background='rgba(34,197,94,.15)';
    const tick=document.createElement('span');
    tick.textContent=' ✓';tick.style.cssText='color:#22c55e;font-size:10px;';
    el.insertAdjacentElement('afterend',tick);
    setTimeout(()=>{el.style.color=oc;el.style.background=obg;tick.remove();},1100);
  }).catch(()=>{});
}
function cpIco(){return`<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" class="copy-ico"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M3 3V2a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H8"/></svg>`;}
// ── ORDER NUMBERS ────────────────────────────────────────────────────────────
/* Jack, 30 Sep: order numbers are click-to-copy everywhere, the way they
   already were on his Admin and the Prep Sheet (no links out). */
function oidHtml(oid){
  const o=String(oid||'').trim();if(!o||o==='—')return '';
  const e=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const q=e(o.replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
  return `<span class="oidCopy" title="Click to copy" onclick="event.stopPropagation();copyVal('${q}',this)">${e(o)}</span>`;
}
function copyMigrationSql(btn){
  const sql=(document.getElementById('migrationSql')||{}).textContent||'';
  navigator.clipboard.writeText(sql.trim()).then(()=>{
    const orig=btn.textContent;btn.textContent='✓ Copied';
    setTimeout(()=>{btn.textContent=orig;},1400);
  }).catch(()=>{toast('Copy failed — select the text manually','er');});
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
/* Which week the dashboard is looking at. 0 = this week, 1 = last week, and so
   on — the weekly panel can step back without moving anything else. */
let WEEK_OFFSET=0;
function shiftWeek(by,ev){
  const next=WEEK_OFFSET+by;
  if(next<0||next>25)return;                 // no future, and half a year back is plenty
  WEEK_OFFSET=next;
  if(ev)ev.__wkHandled=1;
  redrawWeek();
}
function thisWeekNow(ev){WEEK_OFFSET=0;if(ev)ev.__wkHandled=1;redrawWeek();}
function weekPick(v){
  const k=Math.max(0,Math.min(25,parseInt(v)||0));
  if(k===WEEK_OFFSET)return;
  WEEK_OFFSET=k;redrawWeek();
}
/* POINTERDOWN, not click. This is the actual bug, and it is why every previous
   attempt at this failed.
   A `click` only exists if the mousedown AND the mouseup happen on the SAME
   element. renderDashboard() rebuilds dashboardWrap.innerHTML wholesale, and it
   is called by the realtime subscription on every prep_rows change — so with
   three people working, the button under the cursor is routinely destroyed and
   replaced between the press and the release. The mouseup then lands on a
   brand-new element, no click event is ever generated, and the arrow looks
   completely dead. Nothing about the button was ever wrong: it was being pulled
   out from under the pointer.
   Acting on pointerdown means the press has already done its job before any
   redraw can intervene. Bound to the document so it survives those redraws. */
document.addEventListener('pointerdown',function(e){
  if(e.button&&e.button!==0)return;                 // left button only
  const b=e.target&&e.target.closest?e.target.closest('[data-week]'):null;
  if(!b||b.disabled)return;
  const by=parseInt(b.getAttribute('data-week'));
  if(isNaN(by))return;
  e.preventDefault();
  if(by===0)thisWeekNow(e); else shiftWeek(by,e);
});
/* A button with no onclick still has to work from the keyboard. */
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  const b=e.target&&e.target.closest?e.target.closest('[data-week]'):null;
  if(!b||b.disabled)return;
  const by=parseInt(b.getAttribute('data-week'));
  if(isNaN(by))return;
  e.preventDefault();
  if(by===0)thisWeekNow(e); else shiftWeek(by,e);
});
/* Weekly Activity is drawn by renderDashboard, not renderStats — calling the
   wrong one is why the arrows appeared to do nothing at all. */
function redrawWeek(){
  /* This used to swallow a failure into a console.warn, so if the redraw threw,
     the arrow looked dead and there was nothing on screen to say why. A control
     that silently does nothing is the worst kind of broken — if it fails now it
     says so, and names the reason. */
  let failed=null;
  try{if(typeof renderDashboard==='function')renderDashboard();}
  catch(e){failed=e;console.warn('week redraw',e);}
  try{if(typeof renderStats==='function')renderStats();}catch(e){console.warn('week stats',e);}
  if(failed){
    try{toast('Couldn\'t redraw the week — '+((failed&&failed.message)||'unknown error'),'er');}catch(e){}
    return;
  }
  /* Confirm the move out loud. Most weeks before this one are empty, and an
     empty week looks a lot like a button that did nothing — which is exactly
     what it was reported as. */
  try{
    const{s,e}=getWeekRange();
    const f=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    toast(WEEK_OFFSET===0?`Back to this week · ${f(s)} – ${f(e)}`
      :`${WEEK_OFFSET===1?'Last week':WEEK_OFFSET+' weeks ago'} · ${f(s)} – ${f(e)}`,'ok');
  }catch(e){}
}
function getWeekRange(off){
  const back=(off===undefined?WEEK_OFFSET:off)*7;
  const n=new Date();const d=n.getDay()||7;
  const mon=new Date(n);mon.setDate(n.getDate()-d+1-back);mon.setHours(0,0,0,0);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);sun.setHours(23,59,59,999);
  return{s:mon,e:sun};
}
function getMonthRange(){
  const n=new Date();
  return{s:new Date(n.getFullYear(),n.getMonth(),1),e:new Date(n.getFullYear(),n.getMonth()+1,0,23,59,59,999)};
}
function allSentRows(){
  const out=[];
  // Expand each sent / part-sent row into its shipment segments so units land
  // on the date each shipment actually went out (an 8u shipment yesterday and a
  // 2u shipment today are counted on their own days, not lumped on the latest).
  // Every entry carries a unified `cogValue` and `kind` so the prep sheet,
  // dashboard and shipments page all compute the same totals.
  // Include ALL rows (active + archived) so sent-today counts don't drop to 0
  // after archiving.
  rows.filter(r=>(r.sent==='Yes'||r.status==='Part Sent'||r.status==='Sent to Amazon')).forEach(r=>{
    const cogs=parseSKU(r.sku).cogs;
    const segs=normaliseSegments(r);
    if(segs.length){
      segs.forEach(seg=>out.push({...r,isoDate:seg.date||r.sentDate||'',units:seg.units||0,shipId:seg.shipId,_segUnits:seg.units||0,cogValue:cogs*(seg.units||0),kind:'oa',_dAuth:!!seg.date}));
    }else if(r.sentDate){
      /* No segments: this row's date is its own `sentDate`, which is the date
         of its FIRST send and is never updated when the row goes out again on
         a later shipment. It is a fine date for the row, and a terrible one for
         the shipment — so it is marked as not allowed to date a shipment.
         _dAuth:false is what stopped one 11 Aug row dragging the whole of
         FBA15M5XGGHC (10 units, 8 SKU lines) off "Sent today" while the
         Shipments page listed it under 18 Aug. */
      out.push({...r,isoDate:r.sentDate,units:r.ship||0,cogValue:cogs*(r.ship||0),kind:'oa',_dAuth:false});
    }
  });
  /* `_dAuth` says whether a line may DATE a shipment (it always still carries
     its units). The rule is copied from the Shipments page so the two cannot
     drift apart again: only OA segments and Lavarion set a shipment's date
     there — look at renderShipments, the returns loop deliberately has no
     "earlier date wins" line, while the Lavarion loop does.
     This is what was wrong: three RETURNS dated 11 Aug were logged against
     FBA15M5XGGHC. On the Shipments page they added units and left the date at
     18 Aug. Here they were allowed to vote, the earliest date won, and the
     whole shipment — 10 units, 8 SKU lines — dropped out of "Sent today".
     Four shipments on one page, three on the other. */
  completed.forEach(r=>out.push({...r,isoDate:r.dsISO,units:r.shi||0,cogValue:parseSKU(r.sku).cogs*(r.shi||0),kind:'completed',_dAuth:false}));
  lavShipments.filter(s=>s.date).forEach(s=>out.push({isoDate:s.date,units:s.units||0,sku:s.sku||'',asin:s.asin||'',shipId:s.shipId||'',cogValue:(s.cost||0)*(s.units||0),kind:'lav'}));
  returnShipments.filter(s=>s.date).forEach(s=>out.push({isoDate:s.date,units:s.units||0,sku:s.sku||'',asin:s.asin||'',shipId:s.shipId||'',cogValue:0,kind:'return',_dAuth:false}));
  /* Units stay on the date of the line that carries them. An earlier attempt
     re-dated every line to its shipment's earliest date so the month tile would
     agree with the shipments page — but this function pools OA rows, completed
     rows, Lavarion and returns, and the shipments page derives its date from a
     narrower set. When the two disagreed a whole shipment moved off today and
     "Sent today" read 8 units against 40 on the shipments page. Correct daily
     numbers matter more than the month tile matching to the unit, so the remap
     is gone until both can be driven from one shared shipment-date map. */
  return out;
}
function unitsSentInRange(s,e){
  return allSentRows().filter(r=>{const d=r.isoDate?new Date(r.isoDate):null;return d&&d>=s&&d<=e;}).reduce((a,r)=>a+(r.units||0),0);
}
/* Which date a shipment WENT on: its earliest authoritative line (OA segment with a
   date, PLUB); a bare row date or a return only when it has nothing better. Pulled
   out of sentRollup (b628) so the prep cost engine dates lines by the same rule. */
function _shipFirstDates(all){
  const firstSent={},_fallback={};
  all.forEach(r=>{if(!r.shipId||!r.isoDate)return;
    const auth=r._dAuth!==false;
    const bag=auth?firstSent:_fallback;
    if(!bag[r.shipId]||r.isoDate<bag[r.shipId])bag[r.shipId]=r.isoDate;});
  Object.keys(_fallback).forEach(id=>{if(!firstSent[id])firstSent[id]=_fallback[id];});
  return firstSent;
}
// Canonical "what was sent" rollup for a date range (inclusive). Includes OA
// stock, completed rows, Lavarion AND Returns added via the Shipments page, so
// the prep sheet, dashboard and shipments page all agree. Accepts Date objects
// or YYYY-MM-DD strings.
function sentRollup(start,end){
  const toD=v=>typeof v==='string'?new Date(v+'T00:00:00.000Z'):v; // UTC midnight avoids BST offset issues
  const s=toD(start),e=toD(end);
  const all=allSentRows();
  /* A shipment belongs to the period it WENT — the date of its earliest line,
     which is the date the Shipments page puts on it.

     That rule used to be applied to HALF the result. Units, SKU lines and ASINs
     came from rows whose OWN date landed in the window, while the shipment
     count came from the earliest line. So a single line dated outside its
     shipment's period moved the units without moving the shipment: "this week"
     and "this month" could report the same 7 shipments but 30 different units,
     and neither matched the 8 shipments the Shipments page listed.

     One rule for the whole rollup now: if the shipment is in the window, every
     one of its lines is in with it. A line added later cannot drag units into a
     period the shipment did not go in, nor leave its own shipment behind. Loose
     rows with no shipment id still fall back to their own date. */
  /* Which lines get to say when a shipment went.
     The Shipments page builds its date from SEGMENTS only — it skips any row
     without them (see renderShipments). This did not, so a row carrying a
     shipment id but no segments voted with its stale `sentDate` and, because
     the earliest date wins, a single week-old line moved an entire shipment out
     of today. Four shipments on the Shipments page, three on the prep sheet and
     in Weekly Activity, 10 units and 8 SKU lines missing.
     Segment dates, Lavarion and Returns are authoritative; a bare `sentDate`
     is only used when a shipment has nothing better. Same inputs as the
     Shipments page, so the two now answer the question the same way. */
  const firstSent=_shipFirstDates(all);
  const inWindow=iso=>{const d=iso?new Date(iso+'T00:00:00.000Z'):null;return d&&d>=s&&d<=e;};
  const inRange=all.filter(r=>(r.shipId&&firstSent[r.shipId])
    ? inWindow(firstSent[r.shipId])          // follows its shipment
    : inWindow(r.isoDate));                  // no shipment — its own date
  const shipIds=new Set(inRange.map(r=>r.shipId).filter(Boolean));
  return{
    units:inRange.reduce((a,r)=>a+(r.units||0),0),
    value:inRange.reduce((a,r)=>a+(r.cogValue||0),0),
    skus:inRange.length,                                   // SKU lines (incl. lav + returns)
    asins:new Set(inRange.map(r=>r.asin).filter(Boolean)).size,
    shipments:shipIds.size,
    shipIds,
    rows:inRange,
  };
}

// ── STATS ─────────────────────────────────────────────────────────────────────
/* 23 Oct 2026, the UK team: "we booked 20 of 100 in and all 100 vanished from In Transit".
   The tile counted rows whose STATUS was In-Transit and added the whole order — so a part
   delivery counted in (status → In Warehouse, 691 times in 60 days) dropped every unit,
   and one booked another way still counted all of it. In transit is a number of units:
   ordered − booked in − cancelled / accounted for, on every live row whatever its status.
   Units on an open claim stay in until they are refunded, cancelled or written off. */
function _toArrive(r){return (!r||r.archived)?0:_owedUnits(r);}
function _transitTotals(){
  const live=rows.filter(r=>!r.archived&&_toArrive(r)>0);
  let units=0,value=0,overdue=0,claimed=0;
  live.forEach(r=>{const n=_toArrive(r);units+=n;value+=(parseSKU(r.sku).cogs||0)*n;
    if((typeof _prepRowLate==='function'&&_prepRowLate(r))||(typeof _partOverdue==='function'&&_partOverdue(r)))overdue+=n;
    const q=r.resolution||{};
    if((typeof _openClaims==='function'&&_openClaims(r).length)||['amz-missing','amz-claim'].includes(q.what))claimed+=n;});
  return{rows:live,units,value,overdue,claimed,skus:live.length,asins:new Set(live.map(r=>r.asin)).size};
}
/* 23 Oct 2026, Dashboard Pipeline: the bars added up the whole order by STATUS, so a part
   delivery sat in In Warehouse at its full 100 while its missing 88 were also In Transit,
   and Part Sent counted units already at Amazon. Each unit is now counted once, by where
   it is. On the shelf = booked in, not on a shipment yet. sendableQty already leaves out
   damaged/eBay units held back and units that went out under another SKU; with nothing
   booked in it plans from the order, so that case is 0 here. Rows Jack took off the lists
   (_offPrepSheet) are not on the shelf to send. */
function _onShelf(r){
  if(!r||r.archived||!(parseInt(r.rcvd)>0))return 0;
  if(typeof _offPrepSheet==='function'&&_offPrepSheet(r))return 0;
  return Math.max(0,sendableQty(r)-_sentOut(r));
}
/* units with an issue flag that somebody is still working on — a finished row's old flag is history */
function _issueOpen(r){
  if(!r||r.archived||!r.issueType||!(parseInt(r.issueQty)>0))return 0;
  if(typeof _offPrepSheet==='function'&&_offPrepSheet(r))return 0;
  const o=typeof _rowOwner==='function'?_rowOwner(r):null;
  return (o&&o.finished)?0:parseInt(r.issueQty);
}
function _unitTotals(f){
  let units=0,value=0;const rr=[];
  rows.forEach(r=>{const n=f(r);if(n>0){units+=n;value+=(parseSKU(r.sku).cogs||0)*n;rr.push(r);}});
  return{rows:rr,units,value,skus:rr.length,asins:new Set(rr.map(r=>r.asin)).size};
}
/* the Prep Sheet's status filter, plus three "any status" views that count units, not rows */
function _stMatches(r,st){
  if(st==='__toArrive')return _toArrive(r)>0;
  if(st==='__onShelf')return _onShelf(r)>0;
  if(st==='__issue')return _issueOpen(r)>0;
  return r.status===st;
}
function renderStats(){
  {const _stEl=document.getElementById('prepStats');
   if(_histStreaming&&_stEl&&_stEl.children.length)return;}
  const _T=_transitTotals();
  const inTransitUnits=_T.units;
  const inTransitValue=_T.value;
  
  const todayStr=todayISO();
  // Canonical rollup — includes OA, Lavarion and Returns so it matches the
  // dashboard and shipments page exactly.
  const todayRoll=sentRollup(todayStr,todayStr);
  const sentToday=todayRoll.units;
  const valueToday=todayRoll.value;

  const{s:ws,e:we}=getWeekRange();
  const{s:ms,e:me}=getMonthRange();
  const weekRoll=sentRollup(ws,we);
  const sentWeek=weekRoll.units;
  /* the month used a different function to the week, so the two tiles could not
     be checked against each other — both go through sentRollup now */
  const monthRoll=sentRollup(ms,me);
  const sentMonth=monthRoll.units;
  const totalSent=allSentRows().reduce((a,r)=>a+(r.units||0),0);
  
  const inTransitSkus=_T.skus;
  const inTransitAsins=_T.asins;
  const _tExtra=(_T.overdue?` · <b style="color:#f87171">${fmt(_T.overdue)} units overdue</b>`:'')+(_T.claimed?` · ${fmt(_T.claimed)} units being claimed`:'');
  const sentWeekUnits=weekRoll.units;
  const sentWeekSkus=weekRoll.skus;
  const sentWeekAsins=weekRoll.asins;
  const sentTodayUnits=todayRoll.units;
  const sentTodaySkus=todayRoll.skus;

  /* `go` turns a tile into a link to the shipments it is counting. "How have I
     sent 199 units this week?" is answerable in one click instead of an
     argument with the number. */
  const mk=(label,val,sub,col,go)=>`<div class="stat${go?' stat-go':''}" style="border-top:3px solid ${col};"${
      go?(String(go).startsWith('filter:')
          ? ` onclick="statFilter('${String(go).slice(7)}')" title="Show only these rows on the prep sheet"`
          : ` onclick="jumpToShipments('${go}')" title="Show these shipments"`):''}>
    <div style="font-size:10px;font-weight:800;color:${col};text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;line-height:1.15;">${label}</div>
    <div style="font-size:26px;font-weight:900;font-family:var(--num);font-variant-numeric:tabular-nums;color:${col};line-height:1;">${val}</div>
    <div style="font-size:11px;color:var(--text2);margin-top:2px;letter-spacing:.005em;line-height:1.3;">${sub}</div>
  </div>`;
  const shipWord=n=>`${fmt(n)} shipment${n===1?'':'s'}`;

  const lavWeekUnits=lavShipments.filter(s=>s.date&&new Date(s.date)>=ws&&new Date(s.date)<=we).reduce((a,s)=>a+(s.units||0),0);
  const lavMonthUnits=lavShipments.filter(s=>s.date&&new Date(s.date)>=ms&&new Date(s.date)<=me).reduce((a,s)=>a+(s.units||0),0);
  const totalSentWeek=sentWeekUnits;   // allSentRows already includes Lavarion
  const totalSentMonth=sentMonth;      // sentMonth (unitsSentInRange) already includes Lavarion

  document.getElementById('prepStats').innerHTML=
    /* 2255 read as a part number. Every figure on this strip is money or
       volume, so every one of them gets separated — and the two tiles that
       were missing their COG now carry it, because "876 units" without a
       value is half the sentence the other tiles are speaking. */
    mk('In Transit',fmt(inTransitUnits)+' units',`${fmt(inTransitSkus)} SKUs · ${fmt(inTransitAsins)} ASINs · ${fmtGBP2(inTransitValue)} COG${_tExtra}`,'#38bdf8','filter:__toArrive')+
    /* Jack, 26 Oct: the two small tiles ("On the shelf, not sent" / "Booked in today") — "go back".
       The stock on the shelf still shows on the Dashboard's Active Inventory. */
    mk('COG In Transit',fmtGBP2(inTransitValue),`stock value locked in transit`,'#fbbf24','filter:__toArrive')+
    mk('Sent Today',fmt(sentTodayUnits)+' units',`${shipWord(todayRoll.shipments)} · ${fmt(sentTodaySkus)} SKU lines · ${fmtGBP2(valueToday)} COG`,'#4ade80','today')+
    mk('Sent This Week',fmt(sentWeekUnits)+' units',`${shipWord(weekRoll.shipments)} · ${fmt(sentWeekSkus)} SKU lines · ${fmt(sentWeekAsins)} ASINs · ${fmtGBP2(weekRoll.value)} COG`,'#a78bfa','week')+
    mk('Sent This Month',fmt(totalSentMonth)+' units',`${shipWord(monthRoll.shipments)} · ${fmt(monthRoll.skus)} SKU lines · ${fmt(monthRoll.asins)} ASINs · ${fmtGBP2(monthRoll.value)} COG`,'#34d399','mtd');
  renderNoBoxBanner();
  try{renderAmzBanner();}catch(e){}
}

/* A shipment with no box count can't be costed — every box carries a charge, so
   the prep bill for that shipment is understated until someone types the number.
   The shipments page already flags it, but only if you happen to be looking at
   the right period. This sits on the prep sheet where the day starts. */
function renderNoBoxBanner(){
  const el=document.getElementById('noBoxBanner');
  if(!el)return;
  const day={};
  allSentRows().forEach(r=>{if(!r.shipId||!r.isoDate)return;
    if(!day[r.shipId]||r.isoDate<day[r.shipId])day[r.shipId]=r.isoDate;});
  const missing=Object.keys(day).filter(sid=>!(shipBoxes[sid]>0))
    .sort((a,b)=>String(day[b]).localeCompare(String(day[a])));
  if(!missing.length){el.innerHTML='';return;}
  const dshort=iso=>{const p=String(iso).split('-');return p.length===3?`${p[2]}/${p[1]}`:iso;};
  const show=missing.slice(0,8);
  const more=missing.length-show.length;
  el.innerHTML=`<div class="nbBanner">
    <div class="nbTop">
      <span class="nbDot">⚠</span>
      <b>${missing.length} shipment${missing.length===1?'':'s'} ${missing.length===1?'has':'have'} no box count</b>
      <span class="nbSub">prep cost is understated until the boxes are entered</span>
      <button class="nbGo" onclick="jumpToShipments('all')">Open shipments</button>
    </div>
    <div class="nbChips">
      ${show.map(sid=>`<button class="nbChip" onclick="openShipment('${String(sid).replace(/'/g,"\\'")}')" title="Go to this shipment">
        <span class="nbId">${sid}</span><span class="nbDate">${dshort(day[sid])}</span></button>`).join('')}
      ${more>0?`<span class="nbMore">+${more} older</span>`:''}
    </div>
  </div>`;
}
/* Jump straight to one shipment and make it obvious which one — the period
   filter is widened to All first, or the row you were sent to might not be in
   the list you land on. */
function openShipment(sid){
  jumpToShipments('all');
  setTimeout(()=>{
    const el=document.getElementById('ship-'+String(sid).replace(/[^a-z0-9]/gi,'_'));
    if(!el)return;
    el.classList.add('open');
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.classList.add('nbFlash');
    setTimeout(()=>el.classList.remove('nbFlash'),1800);
  },140);
}

// ── BUNDLE COLUMN VISIBILITY ──────────────────────────────────────────────────
function updateBundleCols(data){
  const hasBundles=data.some(r=>r.bun==='Yes');
  const tbl=document.getElementById('prepTable');
  if(tbl){tbl.classList.toggle('bundle-hidden',!hasBundles);}
}

function updateBun(id,val){
  const r=rows.find(x=>x.uuid===String(id)||String(x.id)===String(id));if(!r)return;
  const tr=document.getElementById('row-'+id);if(!tr)return;
  const tds=tr.querySelectorAll('td.col-bundle');
  if(val==='Yes'){
    tds[0].innerHTML=`<input class="ci ci-num" type="text" value="${r.bqty||''}" placeholder="—" onchange="uf(${id},'bqty',this.value);" tabindex="-1">`;
  }else{
    tds[0].innerHTML='<span style="color:var(--text3);">—</span>';
  }
  const hasBundles=rows.some(x=>x.bun==='Yes');
  const tbl=document.getElementById('prepTable');
  if(tbl)tbl.classList.toggle('bundle-hidden',!hasBundles);
}

// ── STATUS CLASS ──────────────────────────────────────────────────────────────
const SC={'In-Transit':'','In Warehouse':'st-warehouse','Delivered':'st-delivered','Sent to Amazon':'st-sent','Issue':'st-issue','Returned':'st-returned'};
