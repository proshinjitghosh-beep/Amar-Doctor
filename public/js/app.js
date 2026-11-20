const $=s=>document.querySelector(s),LS={g:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},s:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const DOCS=[
['ডা. সাবরিনা রহমান','Gynecologist','গাইনি',12,600,4.9],['ডা. আরিফুল ইসলাম','Cardiologist','হৃদরোগ',15,1000,4.8],['ডা. নুসরাত জাহান','Pediatrician','শিশু',9,500,4.9],
['ডা. তানভীর আহমেদ','General','মেডিসিন',7,400,4.7],['ডা. ফারহানা ইয়াসমিন','Dermatologist','চর্ম',10,700,4.8],['ডা. মাহমুদ হাসান','Neurologist','স্নায়ু',14,1200,4.9],
['ডা. রিমা সুলতানা','Psychiatrist','মানসিক',8,800,4.8],['ডা. কামরুল হাসান','Orthopedic','হাড়-জোড়া',11,900,4.7]].map((d,i)=>({id:i,n:d[0],sp:d[1],bn:d[2],ex:d[3],fee:d[4],rt:d[5]}));
const NAV=[['index.html','হোম','🏠'],['consult.html','AI ডাক্তার','💬'],['doctors.html','ডাক্তার','🩺'],['dashboard.html','ড্যাশবোর্ড','📋'],['profile.html','প্রোফাইল','👤'],['records.html','রেকর্ড','🗂️'],['doctor.html','ডাক্তার প্যানেল','🧑‍⚕️'],['pitch.html','বিজনেস','🚀']];
const U0=LS.g('user',null);
const pg=location.pathname.split('/').pop()||'index.html';
document.body.insertAdjacentHTML('afterbegin',`<nav><div class="w"><a class="lg" href="index.html"><i>✚</i>আমার ডাক্তার</a>${NAV.map(n=>`<a class="l ${n[0]==pg?'on':''}" href="${n[0]}">${n[1]}</a>`).join('')}<a class="btn" href="${U0?'profile.html':'login.html'}">${U0?(U0.name||'👤').slice(0,8):'লগইন'}</a></div></nav>`);
document.body.insertAdjacentHTML('beforeend',`<div class="tab">${NAV.slice(0,5).map(n=>`<a class="${n[0]==pg?'on':''}" href="${n[0]}">${n[2]}<br>${n[1]}</a>`).join('')}</div>`);
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),2600)}
/* AI triage. Real AI: set window.AMAR_API='https://your-backend/chat' (POST {text} -> {reply,sp}) */
const RED=/chest pain|can'?t breathe|breathless|unconscious|seizure|stroke|suicid|বুকে ব্যথা|শ্বাসকষ্ট|অজ্ঞান|খিঁচুনি|আত্মহত্যা|রক্তক্ষরণ/i;
const MAP=[[/heart|palpit|blood pressure|হার্ট|প্রেশার/i,'Cardiologist'],[/skin|rash|acne|itch|চুল|ত্বক|চর্ম|র‍্যাশ/i,'Dermatologist'],[/child|baby|infant|শিশু|বাচ্চা/i,'Pediatrician'],[/period|pregnan|গর্ভ|মাসিক/i,'Gynecologist'],[/headache|migraine|dizz|numb|মাথা|ঝিমঝিম/i,'Neurologist'],[/anxi|stress|depress|sleep|ঘুম|মানসিক|দুশ্চিন্তা/i,'Psychiatrist'],[/bone|joint|back pain|knee|কোমর|হাঁটু|হাড়|জোড়া/i,'Orthopedic']];
async function triage(text,hist){
 if(RED.test(text))return{em:1,reply:'⚠️ এটি জরুরি লক্ষণ হতে পারে। এখনই ৯৯৯ এ কল করুন বা নিকটস্থ হাসপাতালের ইমার্জেন্সিতে যান। অপেক্ষা করবেন না।'};
 
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

    return {
      sp: 'General',
      reply: 'দুঃখিত, AI সার্ভিসে বর্তমানে সংযোগ করা যাচ্ছে না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
    };
  }
}

 await new Promise(r=>setTimeout(r,900));
 if(RED.test(text))return{em:1,reply:'⚠️ এটি জরুরি লক্ষণ হতে পারে। এখনই ৯৯৯ এ কল করুন বা নিকটস্থ হাসপাতালের ইমার্জেন্সিতে যান। অপেক্ষা করবেন না।'};
 const m=MAP.find(x=>x[0].test(text)),sp=m?m[1]:'General';
 return{sp,reply:`আপনার বিবরণ অনুযায়ী সম্ভাব্য সমস্যা সাধারণ কিছু হতে পারে, তবে নিশ্চিত হতে ${sp} বিশেষজ্ঞ দেখানো ভালো।\n\n• এখন: বিশ্রাম, পর্যাপ্ত পানি, লক্ষণ লিখে রাখুন\n• সতর্ক সংকেত: তীব্র ব্যথা, জ্বর ৩ দিনের বেশি, শ্বাসকষ্ট\n• এটি সাধারণ পরামর্শ, রোগ নির্ণয় নয়।`}}
function book(d,slot){const a=LS.g('appts',[]);const id=Date.now();a.push({doc:d.n,sp:d.sp,slot,fee:d.fee,id,paid:0});LS.s('appts',a);return id}
