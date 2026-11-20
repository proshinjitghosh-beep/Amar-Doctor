const $=s=>document.querySelector(s),LS={g:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},s:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const DOCS=[
['ডা. সাবরিনা রহমান','Gynecologist','গাইনি',12,600,4.9],['ডা. আরিফুল ইসলাম','Cardiologist','হৃদরোগ',15,1000,4.8],['ডা. নুসরাত জাহান','Pediatrician','শিশু',9,500,4.9],
['ডা. তানভীর আহমেদ','General','মেডিসিন',7,400,4.7],['ডা. ফারহানা ইয়াসমিন','Dermatologist','চর্ম',10,700,4.8],['ডা. মাহমুদ হাসান','Neurologist','স্নায়ু',14,1200,4.9],
['ডা. রিমা সুলতানা','Psychiatrist','মানসিক',8,800,4.8],['ডা. কামরুল হাসান','Orthopedic','হাড়-জোড়া',11,900,4.7]].map((d,i)=>({id:i,n:d[0],sp:d[1],bn:d[2],ex:d[3],fee:d[4],rt:d[5]}));
const NAV=[['index.html','হোম','🏠'],['consult.html','AI ডাক্তার','💬'],['doctors.html','ডাক্তার','🩺'],['emergency.html','জরুরি','🚨'],
['reports.html','রিপোর্ট','📄'],['medications.html','ওষুধ','💊'],['doctor-prep.html','ভিজিট প্রস্তুতি','🗒️'],['dashboard.html','ড্যাশবোর্ড','📋'],
['profile.html','প্রোফাইল','👤'],['records.html','রেকর্ড','🗂️'],['doctor.html','ডাক্তার প্যানেল','🧑‍⚕️'],['pitch.html','বিজনেস','🚀']];
const TABS=NAV.slice(0,4);
const U0=LS.g('user',null);
const pg=location.pathname.split('/').pop()||'index.html';
document.body.insertAdjacentHTML('afterbegin',`<nav><div class="w"><a class="lg" href="index.html"><i>✚</i>আমার ডাক্তার</a><div class="links">${NAV.map(n=>`<a class="l ${n[0]==pg?'on':''}" href="${n[0]}">${n[1]}</a>`).join('')}</div><a class="btn" id="acct" href="${U0?'profile.html':'login.html'}">${U0?(U0.name||'👤').slice(0,8):'লগইন'}</a></div></nav>`);
document.body.insertAdjacentHTML('beforeend',`<div class="tab">${TABS.map(n=>`<a class="${n[0]==pg?'on':''}" href="${n[0]}">${n[2]}<br>${n[1]}</a>`).join('')}<a class="more" id="morebtn" role="button" aria-label="আরও">⋯</a></div>
<div class="sheetwrap" id="morewrap"><div class="scrim" data-close></div><div class="sheet">${NAV.slice(TABS.length).map(n=>`<a href="${n[0]}">${n[1]}<small>${n[0]}</small></a>`).join('')}</div></div>`);

/* The overflow menu on small screens. */
(function(){
  const wrap=$('#morewrap'),btn=$('#morebtn');
  if(!wrap||!btn)return;
  const close=()=>wrap.classList.remove('on');
  btn.addEventListener('click',e=>{e.preventDefault();wrap.classList.toggle('on')});
  wrap.addEventListener('click',e=>{if(e.target.dataset.close!==undefined)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();

/* The account button prefers a real session; it falls back to the demo user. */
(function(){
  const btn=$('#acct');
  if(!btn)return;
  fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(d=>{
    if(!d||!d.user)return;
    btn.textContent=(d.user.fullName||'অ্যাকাউন্ট').slice(0,8);
    btn.href='profile.html';
    btn.title='অ্যাকাউন্ট থেকে লগআউট';
  }).catch(()=>{});
})();

function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),2600)}
/*
 * AI triage.
 *
 * The emergency red-flag check runs FIRST, before any network request, so a
 * possible emergency is escalated to 999 without waiting on the provider.
 * That ordering is a safety requirement - do not move it.
 */
const RED=/chest pain|can'?t breathe|breathless|unconscious|seizure|stroke|suicid|self[- ]harm|hurt myself|want to die|bleeding|বুকে ব্যথা|শ্বাসকষ্ট|অজ্ঞান|খিঁচুনি|আত্মহত্যা|রক্তক্ষরণ|নিজেকে ক্ষতি/i;
const MAP=[[/heart|palbeit|blood pressure|হার্ট|প্রেশার/i,'Cardiologist'],[/skin|rash|acne|itch|চুল|ত্বক|চর্ম|র‍্যাশ/i,'Dermatologist'],[/child|baby|infant|শিশু|বাচ্চা/i,'Pediatrician'],[/period|pregnan|গর্ভ|মাসিক/i,'Gynecologist'],[/headache|migraine|dizz|numb|মাথা|ঝিমঝিম/i,'Neurologist'],[/anxi|stress|depress|sleep|ঘুম|মানসিক|দুশ্চিন্তা/i,'Psychiatrist'],[/bone|joint|back pain|knee|কোমর|হাঁটু|হাড়|জোড়া/i,'Orthopedic']];

/* The canned emergency reply. Shared by the pre-network check and the fallback. */
const EM_REPLY='⚠️ এটি জরুরি লক্ষণ হতে পারে। এখনই ৯৯৯ এ কল করুন বা নিকটস্থ হাসপাতালের ইমার্জেন্সিতে যান। অপেক্ষা করবেন না।';

/* The local keyword heuristic. Used only when the AI cannot be reached. */
function localAdvice(text){
 const m=MAP.find(x=>x[0].test(text)),sp=m?m[1]:'General';
 return{sp,reply:`আপনার বিবরণ অনুযায়ী সম্ভাব্য সমস্যা সাধারণ কিছু হতে পারে, তবে নিশ্চিত হতে ${sp} বিশেষজ্ঞ দেখানো ভালো।\n\n• এখন: বিশ্রাম, পর্যাপ্ত পানি, লক্ষণ লিখে রাখুন\n• সতর্ক সংকেত: তীব্র ব্যথা, জ্বর ৩ দিনের বেশি, শ্বাসকষ্ট\n• এটি সাধারণ পরামর্শ, রোগ নির্ণয় নয়।`}}

async function triage(text,hist){
 /* Emergency first - this never touches the network. */
 if(RED.test(text))return{em:true,reply:EM_REPLY};

 if (location.protocol.startsWith('http')) {
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          ...(hist || []),
          { role: 'user', content: text }
        ]
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data.error || `API Error: ${r.status}`);
    }

    if (!data.reply) {
      throw new Error('AI returned an empty response');
    }

    return data;

  } catch (e) {
    console.error('AI API Error:', e);

    /*
     * The AI is unavailable. The local keyword heuristic still gives the
     * patient something, but it is NOT an AI recommendation - so no
     * specialist is claimed and no booking button is offered on the strength
     * of it. `offline` tells the interface to say so plainly.
     */
    const local=localAdvice(text);
    return {
      offline:true,
      sp:null,
      localSp:local.sp,
      reply:'দুঃখিত, AI সার্ভিসটি এখন উপলব্ধ নেই। নিচের পরামর্শটি শুধু লক্ষণ-ভিত্তিক একটি সাধারণ নিয়ম থেকে দেওয়া — AI-চালিত রোগ নির্ণয় নয়।\n\n'+local.reply
    };
  }
 }

 await new Promise(r=>setTimeout(r,900));
 if(RED.test(text))return{em:true,reply:EM_REPLY};
 const local=localAdvice(text);
 return{sp:local.sp,reply:local.reply}
}

/* Bangla numerals to ASCII, so a slot label can become a real time. */
function toAsciiDigits(value){return String(value).replace(/[০-৯]/g,d=>'০১২৩৪৫৬৭৮৯'.indexOf(d))}

/**
 * Turn a booking slot label such as 'কাল ১০:০০ AM' into a real date.
 * Returns null when the label cannot be understood, so the caller never
 * invents a time.
 */
function slotToDate(slot){
  const text=toAsciiDigits(slot||'').trim();
  if(!text)return null;
  const dayOffset=/কাল/.test(text)?1:/আজ/.test(text)?0:null;
  const match=text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if(dayOffset===null||!match)return null;
  let hour=Number(match[1])%12;
  if(/pm/i.test(match[3]))hour+=12;
  const date=new Date();
  date.setDate(date.getDate()+dayOffset);
  date.setHours(hour,Number(match[2]),0,0);
  if(dayOffset===0&&date.getTime()<Date.now())date.setDate(date.getDate()+1);
  return date;
}

/**
 * Record a booking.
 *
 * The browser keeps its local copy exactly as before. When the visitor also
 * has an account, the booking is additionally written to the database so the
 * visit-preparation module has real appointments to work from.
 *
 * The mirror is not fire-and-forget: if it fails - which it does for a
 * signed-out visitor, because the endpoint requires a session - the local
 * booking is marked as not saved on the server, so the interface can offer a
 * retry instead of the booking quietly disappearing.
 */
function book(d,slot){
 const a=LS.g('appts',[]);const id=Date.now();
 a.push({doc:d.n,sp:d.sp,slot,fee:d.fee,id,paid:0,synced:false});
 LS.s('appts',a);
 try{
  const when=slotToDate(slot);
  fetch('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
   body:JSON.stringify({doctorName:d.n,scheduledAt:(when||new Date()).toISOString(),slotLabel:slot})})
   .then(r=>{
    if(!r.ok)return;
    const list=LS.g('appts',[]);
    const row=list.find(x=>x.id===id);
    if(row){row.synced=true;LS.s('appts',list);}
   })
   .catch(()=>{});
 }catch(e){}
 return id}

/**
 * Retry saving a booking that could not be mirrored to the server.
 *
 * Used by the visit-preparation page once the patient has signed in. Returns
 * the server appointment, or null when it still could not be saved.
 */
async function syncBooking(localId){
 const list=LS.g('appts',[]);
 const row=list.find(x=>x.id===localId);
 if(!row)return null;
 const when=slotToDate(row.slot);
 try{
  const r=await fetch('/api/appointments',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
   body:JSON.stringify({doctorName:row.doc,scheduledAt:(when||new Date()).toISOString(),slotLabel:row.slot})});
  if(!r.ok)return null;
  const data=await r.json().catch(()=>({}));
  row.synced=true;
  LS.s('appts',list);
  return data.appointment||null;
 }catch(e){return null}
}
