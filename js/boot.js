/* BDL PrepHub — js/boot.js — midnight refresh, init (auth-gated), boot loader, clock.
   Cut from the single app.js on 2026-09-10 (b560). Classic script: shared global scope, load order matters. */
// ── AUTO MIDNIGHT REFRESH ─────────────────────────────────────────────────────
let _lastDay=new Date().getDate();
setInterval(()=>{
  const d=new Date().getDate();
  if(d!==_lastDay){_lastDay=d;renderDashboard();renderPrep();renderShipments();toast('Day changed — dashboard updated');}
},300000); // day-change check — 5 min is plenty, saves 48 wake-ups/hour

// ── INIT (auth-gated) ──────────────────────────────────────────────────────────
// The data layer (dbLoad → realtime → sheet sync) only starts AFTER a confirmed
// Supabase session. Until then the login wall (#authGate) is shown.


/* ── boot loader: something to look at while the data comes down ── */
const BootLoad={
  _t:null,
  show(){const e=document.getElementById('bootLoad');if(!e)return;
    e.classList.remove('out');e.classList.add('on');this.set(8,'Connecting');},
  set(pct,txt){
    const f=document.getElementById('blFill'),s=document.getElementById('blStep');
    if(f)f.style.width=Math.min(100,pct)+'%';
    if(s&&txt)s.textContent=txt;
  },
  done(){
    const e=document.getElementById('bootLoad');if(!e)return;
    this.set(100,'Ready');
    clearTimeout(this._t);
    setTimeout(()=>{e.classList.add('out');setTimeout(()=>e.classList.remove('on','out'),400);},260);
  },
  fail(msg){this.set(100,msg||'Couldn\'t load — check your connection');
    setTimeout(()=>this.done(),1800);}
};

let _appBooted=false;
function bootApp(){
  if(_appBooted)return;            // guard against double-boot on token refresh
  _appBooted=true;
  document.body.classList.add('authed');
  setSyncStatus('syncing');
  BootLoad.show();
  const sub=document.getElementById('blSub');if(sub)sub.textContent='Getting your data';
  BootLoad.set(28,'Loading shipments and prep rows');
  /* never leave someone staring at a loader — bail out after 12s regardless */
  BootLoad._t=setTimeout(()=>BootLoad.fail('Still loading — carrying on'),12000);
  loadVaState();                     // check-in, alerts and the action centre
  dbLoad().then(()=>{
    BootLoad.set(72,'Setting up live updates');
    setupRealtime();
    watchForSleep();
    BootLoad.set(88,'Opening your prep sheet');
    const prepBtn=document.querySelector('.sb-item.on');
    if(prepBtn)goPage('prep',prepBtn);
    BootLoad.done();
    try{acStart();}catch(e){console.warn('[autoclear] start',e);}
  }).catch(e=>{console.warn('boot',e);BootLoad.fail();});
}

// Map the signed-in email to one of the three known operators so the user-chip
// and audit log show who actually did something (instead of a clickable guess).
// Stable avatar colour derived from the seat key, so every seat looks distinct
// even if no colour was set in Supabase.
function _seatColor(key){
  const palette=['#f59e0b','#60a5fa','#34d399','#cc99ff','#ff6b9d','#5eead4','#fbbf24','#a78bfa','#4ade80','#fb7185'];
  let h=0;for(let i=0;i<(key||'').length;i++)h=(h*31+key.charCodeAt(i))>>>0;
  return palette[h%palette.length];
}

// Build the current identity ENTIRELY from the Supabase account.
// Identity comes from the user's metadata (set in the dashboard). If a field is
// missing we fall back to the email — NEVER to a hard-coded person like Jack.
function applyIdentity(user){
  if(!user)return;
  const m=user.user_metadata||{};
  const email=(user.email||'').toLowerCase();
  const localPart=email.split('@')[0]||'user';
  // Turn the email name into a tidy display name automatically: jack -> Jack,
  // tom.smith -> Tom Smith. So first-name emails just work with nothing to set up.
  const prettyLocal=localPart.split(/[._-]+/).filter(Boolean)
    .map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  const name=(m.name||m.full_name||prettyLocal||localPart).toString();
  const role=(m.role||'').toString();
  const seat=(m.seat||email||localPart).toString();
  const init=(m.init
    ||name.split(/[\s._-]+/).filter(Boolean).map(w=>w[0]).join('').slice(0,2)
    ||localPart.slice(0,2)).toUpperCase();
  const col=m.color||m.col||_seatColor(seat);
  cu={id:seat,name,role,init,col};
  /* Jack, 3 Sep: his Clear button never appeared even signed in as Jack. Cause:
     the header name comes from `cu`, but everything that asks WHO reads
     `window.currentUserName` — which nothing ever set. So `_who()` fell back to
     'Sarah' for everyone: her name went on Jack's notes, resolutions, chase
     logs and audit entries, the "only Sarah's look counts" rule never skipped
     Jack or Becki (so their opens inflated her not-opened figures), and every
     Jack-only control stayed hidden. One assignment fixes all of it — and it
     had to be right before 20 days of tracking who does what. */
  window.currentUserName=name;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('sbAv',cu.init);set('sbName',cu.name);set('sbRole',cu.role||'');
  set('topAv',cu.init);set('topName',cu.name);
}

async function agSignIn(){
  const btn=document.getElementById('agBtn');
  const err=document.getElementById('agErr');
  const email=document.getElementById('agEmail').value.trim();
  const pass=document.getElementById('agPass').value;
  if(!email||!pass){err.textContent='Enter your email and password.';return;}
  btn.disabled=true;btn.textContent='Signing in…';err.textContent='';
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error)throw error;
    applyIdentity(data.user);
    bootApp();
  }catch(ex){
    err.textContent=ex.message||'Sign-in failed. Check your details.';
    btn.disabled=false;btn.textContent='Sign in';
  }
}

async function agSignOut(){
  try{await sb.auth.signOut();}catch(e){}
  // Hard reload is the safest way to fully reset in-memory app state.
  location.reload();
}

// On load: if a valid session already exists on this laptop, go straight in.
sb.auth.getSession().then(({data})=>{
  if(data.session){
    applyIdentity(data.session.user);
    bootApp();
  }else{
    document.getElementById('agEmail')?.focus();
  }
});

// If the session is lost (token expired, signed out elsewhere) force re-login.
sb.auth.onAuthStateChange((event)=>{
  if(event==='SIGNED_OUT'){document.body.classList.remove('authed');}
});


// UK date/time clock
function updateClock(){
  const now=new Date();
  const dd=String(now.getDate()).padStart(2,'0');
  const mm=String(now.getMonth()+1).padStart(2,'0');
  const hh=String(now.getHours()).padStart(2,'0');
  const min=String(now.getMinutes()).padStart(2,'0');
  const el=document.getElementById('ukClock');
  if(el)el.textContent=`${dd}.${mm} ${hh}:${min}`;
}
updateClock();
setInterval(()=>{updateClock();paintSyncAge();},60000);
