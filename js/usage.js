/* BDL PrepHub — js/usage.js — what actually gets clicked.
   Jack, 23 Oct 2026: "can we not add something in the code where we can actually
   read and see what's being clicked and what's being used".
   The audit log only sees saves. Filters, tabs, popups opened and shut, and buttons
   that change nothing leave no trace there, so nobody could say what is used.
   This counts every click per person per day in memory and sends ONE audit_log line
   (action 'Usage', detail = the counts as JSON) at most every 30 minutes — a few
   small writes an hour for the whole team. Nothing typed is recorded, only which
   control was used. Test mode counts but never sends.
   Jack reads it on the Audit page → What gets used (usageOpen). */
const USAGE_KEY='phUsagePending';
const USAGE_EVERY=30*60*1000;
let _usage=null;          // {d:'2026-10-23', w:'Becki', c:{'Prep Sheet › + issue':3}}
let _usageLast=Date.now();// last send
let _usageN=0;            // clicks since the last copy to browser storage

function _usageWho(){return (typeof cu!=='undefined'&&cu&&cu.id&&cu.name)||'';}   /* nobody signed in yet = not counted */
function _usageDay(){return typeof ukDayISO==='function'?ukDayISO():new Date().toISOString().slice(0,10);}
/* Numbers, money and dates are what make one row's button differ from the next.
   Squash them, or every "Send 12 more" becomes its own line. */
function _usageTidy(s){
  return String(s||'').replace(/\s+/g,' ').replace(/[£$€]?\d[\d,.:/]*%?/g,'N')
    .replace(/(N[ ×x·]*)+N/g,'N').trim().slice(0,52);
}
function _usagePlace(el){
  if(el.closest('#sb'))return 'Menu';   /* the sidebar, not the page being left */
  const ov=el.closest('.overlay');
  /* popup titles carry the row ("Raise Issue — Amuk_3.2_…"); keep the part that names the popup */
  if(ov){const t=ov.querySelector('.mh-title,.mh h3,h2,h3');
    return 'Popup: '+(_usageTidy(String(t&&t.textContent||'').split(/ [—·–] /)[0])||ov.id||'?');}
  const pg=document.querySelector('.page.active');
  const names={prep:'Prep Sheet',admin:'Sarah’s Admin',jack:'Jack’s Admin',lavarion:'PLUB',shipments:'Shipments',
    returns:'Returns',recovery:'Recovery Stock',dashboard:'Dashboard',insights:'Insights',settings:'Settings',
    audit:'Audit',lookup:'Lookup',claims:'Claims'};
  let where=pg?(names[pg.id.slice(5)]||pg.id.slice(5)):'?';
  if(pg&&pg.id==='page-lavarion'){
    const tab=document.querySelector('#lav3Tabs button.on');
    if(tab){const c=tab.querySelector('.cnt');where+=' · '+_usageTidy(tab.textContent.replace(c?c.textContent:'',''));}
  }
  return where;
}
function _usageName(el){
  const fn=((el.getAttribute('onclick')||el.getAttribute('onchange')||'').match(/([A-Za-z_$][\w$.]*)\s*\(/)||[])[1]||'';
  let t=el.getAttribute('data-u')||el.getAttribute('aria-label')||'';
  /* A whole card or table row can be the clickable thing; its text is a product
     name, not the name of a control. Use the action behind it instead. */
  if(!t){
    /* counts on tabs and buttons ("Products 12") are not part of the name */
    const cl=el.cloneNode(true);cl.querySelectorAll('.cnt,.badge,.count').forEach(x=>x.remove());
    const txt=(cl.textContent||'').replace(/\s+/g,' ').trim();
    /* a KPI tile: its label is the first line ("IN TRANSIT") */
    if(/(^| )(stat|acKpi|kpi)/.test(el.className||'')){const l=(el.innerText||'').split('\n')[0].trim();if(l&&l.length<=30)t=l+' (tile)';}
    if(!t)t=(txt&&txt.length<=40&&el.querySelectorAll('*').length<=6)?txt:'';}
  if(!t)t=el.getAttribute('title')||'';
  if(!t||t.length>52)t=fn?('['+fn.replace(/^LV3\./,'')+']'):(t||el.tagName.toLowerCase());
  return _usageTidy(t);
}
function usageCount(key){
  const who=_usageWho();if(!who||!key)return;
  const d=_usageDay();
  if(_usage&&(_usage.d!==d||_usage.w!==who))usageFlush(true);
  if(!_usage||_usage.d!==d||_usage.w!==who)_usage={d,w:who,c:{}};
  _usage.c[key]=(_usage.c[key]||0)+1;
  if(++_usageN>=10)_usageKeep();
}
function _usageKeep(){_usageN=0;try{lsSet(USAGE_KEY,JSON.stringify(_usage));}catch(e){}}

document.addEventListener('click',e=>{
  try{
    const el=e.target.closest&&e.target.closest('button,a,[onclick],input[type=checkbox],input[type=radio],summary,label');
    if(!el||el.closest('#usageModal'))return;
    if(el.tagName==='SELECT'||el.tagName==='OPTION')return;   /* counted on change */
    usageCount(_usagePlace(el)+' › '+_usageName(el));
  }catch(err){}
},true);
document.addEventListener('change',e=>{
  try{
    const el=e.target;if(!el||!el.tagName||el.closest('#usageModal'))return;
    const fn=((el.getAttribute('onchange')||'').match(/([A-Za-z_$][\w$.]*)\s*\(/)||[])[1]||'';
    /* row controls carry the row's id — the id says which row, not which control */
    const id=/\d/.test(el.id||'')?'':(el.id||'');
    /* name it the way Jack reads the screen: a table cell by its column heading,
       a filter by its "All …" option, then the label, then the code name */
    /* b630: a control can name itself (data-u). Sarah's triage dropdown sits in a card that spans the whole table, so
       its "column heading" was the sort bar: "Sort#▲ProductSupplier / orderUnitsWhat's wrong column = No". A heading
       spanning several columns names no column. */
    let what=_usageTidy(el.getAttribute('data-u')||'');
    const td=what?null:el.closest('td'),th=td&&td.closest('table')&&td.closest('table').querySelectorAll('thead th')[td.cellIndex];
    if(th&&!(th.colSpan>1))what=_usageTidy(th.textContent)+' column';
    const o0=el.tagName==='SELECT'&&el.options[0]?el.options[0].text.trim():'';
    if(!what&&/^All /i.test(o0))what=o0.replace(/^All /i,'')+' filter';
    if(!what&&/^Sort/i.test(o0))what='Sort';
    if(!what)what=_usageTidy(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('title'))
      ||id||(fn?'['+fn.replace(/^LV3\./,'')+']':'')||el.tagName.toLowerCase();
    if(el.tagName==='SELECT'){
      const o=el.options[el.selectedIndex];
      usageCount(_usagePlace(el)+' › '+what+' = '+_usageTidy(o?o.text:el.value));
    }else if(/^(text|number|search|date|)$/.test(el.type||'')||el.tagName==='TEXTAREA'){
      usageCount(_usagePlace(el)+' › typed in '+what);
    }
  }catch(err){}
},true);

async function usageFlush(force){
  if(!_usage||!Object.keys(_usage.c).length)return;
  if(!force&&Date.now()-_usageLast<USAGE_EVERY)return;
  if(window.__TESTMODE__||typeof sb==='undefined'||typeof cu==='undefined'||!cu||!cu.id)return;
  const send=_usage;
  _usage={d:send.d,w:send.w,c:{}};_usageLast=Date.now();_usageKeep();
  try{
    const {error}=await sb.from('audit_log').insert({user_id:cu.id,user_name:cu.name,user_role:cu.role,
      user_init:cu.init,user_col:cu.col,action:'Usage',detail:JSON.stringify({d:send.d,c:send.c}),
      created_at:new Date().toISOString()});
    if(error)throw error;
  }catch(e){
    /* put the counts back so the next try carries them */
    if(_usage.d===send.d&&_usage.w===send.w)Object.entries(send.c).forEach(([k,n])=>{_usage.c[k]=(_usage.c[k]||0)+n;});
    _usageKeep();
  }
}
/* What a closed laptop left unsent comes back on the next open. */
try{const p=JSON.parse(lsGet(USAGE_KEY)||'null');if(p&&p.c&&Object.keys(p.c).length){_usage=p;_usageLast=0;}}catch(e){}
setInterval(()=>usageFlush(false),5*60*1000);
/* Leaving the tab: keep the counts, and send them if the last send was 10+ minutes ago.
   Switching tabs all day must not mean a write every time. */
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden||!_usage)return;
  _usageKeep();
  if(Date.now()-_usageLast>10*60*1000)usageFlush(true);
});
window.addEventListener('pagehide',()=>{if(_usage)_usageKeep();});

/* ── Jack's view: Audit → What gets used ───────────────────────────────── */
let _uRows=null,_uWho='all',_uDays=30;
async function usageOpen(){
  om('usageModal');
  document.getElementById('usageBody').innerHTML='<div class="audit-empty">Loading…</div>';
  _uRows=[];
  try{
    const since=new Date(Date.now()-30*864e5).toISOString();
    for(let off=0;off<20000;off+=1000){
      const {data,error}=await sb.from('audit_log').select('user_name,detail,created_at')
        .eq('action','Usage').gte('created_at',since).order('created_at',{ascending:false}).range(off,off+999);
      if(error)throw error;
      (data||[]).forEach(r=>{try{const j=JSON.parse(r.detail);_uRows.push({w:r.user_name||'?',d:j.d||r.created_at.slice(0,10),c:j.c||{}});}catch(e){}});
      if(!data||data.length<1000)break;
    }
  }catch(e){console.warn('usage load:',e.message);}
  /* this laptop's counts that have not gone up yet */
  if(_usage&&Object.keys(_usage.c).length)_uRows.push({w:_usage.w,d:_usage.d,c:_usage.c});
  usageDraw();
}
function usageSet(k,v){if(k==='who')_uWho=v;else _uDays=+v;usageDraw();}
function usageDraw(){
  const host=document.getElementById('usageBody');if(!host||!_uRows)return;
  const from=typeof ukAddDays==='function'?ukAddDays(_usageDay(),-(_uDays-1)):'';
  const people=[...new Set(_uRows.map(r=>r.w))].sort();
  const rows=_uRows.filter(r=>r.d>=from&&(_uWho==='all'||r.w===_uWho));
  const agg={};let total=0;const days=new Set();
  rows.forEach(r=>{days.add(r.d);Object.entries(r.c).forEach(([k,n])=>{
    const a=agg[k]||(agg[k]={n:0,days:new Set(),last:'',who:new Set()});
    a.n+=n;a.days.add(r.d);a.who.add(r.w);if(r.d>a.last)a.last=r.d;total+=n;});});
  const byPlace={};
  Object.entries(agg).forEach(([k,a])=>{const i=k.indexOf(' › ');const p=i>0?k.slice(0,i):'?';
    (byPlace[p]=byPlace[p]||{n:0,items:[]}).items.push([i>0?k.slice(i+3):k,a]);byPlace[p].n+=a.n;});
  const chip=(k,v,l,on)=>`<button class="uChip ${on?'on':''}" onclick="usageSet('${k}','${esc(v)}')">${esc(l)}</button>`;
  const dd=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'}):'';
  const first=[..._uRows.map(r=>r.d)].sort()[0];
  host.innerHTML=`
    <div class="uBar">
      <div class="uChips">${chip('who','all','Everyone',_uWho==='all')}${people.map(p=>chip('who',p,p,_uWho===p)).join('')}</div>
      <div class="uChips">${[[1,'Today'],[7,'7 days'],[30,'30 days']].map(([v,l])=>chip('days',v,l,_uDays===v)).join('')}</div>
    </div>
    <div class="uKpis">
      <div><b>${fmt(total)}</b><span>clicks</span></div>
      <div><b>${fmt(Object.keys(agg).length)}</b><span>different controls</span></div>
      <div><b>${fmt(days.size)}</b><span>day${days.size===1?'':'s'} with use</span></div>
      <div><b>${Object.keys(byPlace).length}</b><span>pages and popups</span></div>
    </div>
    ${!total?`<div class="audit-empty">Nothing counted yet${first?'':' — counting started with this version. Give it a few days of normal use'}.</div>`:''}
    ${Object.entries(byPlace).sort((a,b)=>b[1].n-a[1].n).map(([p,g])=>`
      <div class="uPlace">
        <div class="uPh"><span>${esc(p)}</span><b>${fmt(g.n)}</b></div>
        <div class="uRow uHd"><div>Control</div><div class="r">Clicks</div><div class="r">Days used</div><div>Last used</div>${_uWho==='all'?'<div>Who</div>':''}</div>
        ${g.items.sort((a,b)=>b[1].n-a[1].n).map(([k,a])=>`<div class="uRow">
          <div class="uK">${esc(k)}</div><div class="r">${fmt(a.n)}</div><div class="r">${fmt(a.days.size)}</div>
          <div class="uL">${dd(a.last)}</div>${_uWho==='all'?`<div class="uW">${esc([...a.who].join(', '))}</div>`:''}</div>`).join('')}
      </div>`).join('')}
    <div class="uNote">Counting started ${first?dd(first):'with this version'}. A button that never appears here has not been clicked in the period picked. Nothing typed is recorded — only which box or button was used.</div>`;
}
window.usageOpen=usageOpen;window.usageSet=usageSet;window.usageFlush=usageFlush;window.usageCount=usageCount;
