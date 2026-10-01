// ==UserScript==
// @name         CS 상황판 자동 실행 (다나로브)
// @namespace    danarobe-cs
// @version      3
// @description  CS 상황판 숫자·처리 기록 자동 수집(수집 PC 한 대) + 카카오 채팅창 답변 후보 패널(상담원 PC)
// @match        https://business.kakao.com/*
// @match        https://admin.pay.naver.com/front/m/v2/customer/inquiry*
// @grant        none
// @run-at       document-idle
// @updateURL    https://qkralsrb03138668.github.io/ad-dashboard/cs-tracker.user.js
// @downloadURL  https://qkralsrb03138668.github.io/ad-dashboard/cs-tracker.user.js
// ==/UserScript==
// 고친 뒤엔 @version을 올릴 것 — Tampermonkey가 하루 한 번 새 버전을 받아 감. 상황판 북마크(cs-board.html)도 이 파일을 받아 실행.
//
// tracker(C,F): 카카오·네이버 탭에서 카카오 10초·네이버 1분마다 숫자를 서버로 보냄
//    카카오: 왼쪽 메뉴(shadow DOM) '내 채팅' 옆 .txt_badge — 카카오 화면이 알아서 수시로 갱신
//           + 1분마다 처리 기록: 채팅 목록 API(카카오 화면이 쓰는 것, 100개씩·since=마지막 last_log_id)에서 오늘 바뀐 채팅마다
//             채팅 기록(GET .../chats/<id>/chatlogs, 20개씩·since=가장 오래된 id로 이전 페이지)을 자정 전까지 읽어
//             m(어제 고객 말에 답 못 한 채 자정 넘김)·w(오늘 고객이 씀) 계산 → 서버가 '오늘 새로 시작된 상담'만 셈 (kakao-step.ts)
//    네이버: '6개월'(끝 날짜를 오늘로) → '조회하기' 누르고 "검색결과 내역 (총 N건)" 읽기 + 목록의 문의번호(9~10자리) — 사라진 번호 = 답변 처리(서버가 셈)
function tracker(C,F){
  if(window.__csBoard){alert('CS 상황판: 이미 켜져 있어요. 이 탭은 그대로 열어두세요.');return}
  var h=location.hostname,src=/kakao\.com$/.test(h)?'kakao':/naver\.com$/.test(h)?'naver':'';
  if(!src){alert('CS 상황판: 카카오 채팅 화면이나 네이버페이센터 고객문의관리 화면에서 눌러주세요.');return}
  window.__csBoard=1;
  var tag=document.createElement('div');
  tag.style.cssText='position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#15171C;color:#fff;font:12px/1.4 sans-serif;padding:6px 10px;border-radius:8px;opacity:.85;pointer-events:none';
  document.body.appendChild(tag);
  var rec='',me=Math.random().toString(36).slice(2,12),lead=false;
  /* 탭이 여러 개여도 수집은 한 탭만 (서버 lease, 2분 반). 서버에 못 물어보면 그냥 내가 함 */
  function lease(){return post({action:'lease',src:src,id:me}).then(function(r){lead=!!r.ok;return lead},function(){lead=true;return true})}
  function idle(){tag.textContent='○ CS 상황판: 다른 탭이 수집 중 (이 탭은 대기)'}
  function send(n,e,ids){
    var u=F+'?action=push&code='+encodeURIComponent(C)+'&src='+src+'&n='+(n==null?'':n)+'&err='+encodeURIComponent(e||'')+(ids?'&ids='+ids.join(','):'');
    tag.textContent='● CS 상황판 전송 중 · '+new Date().toTimeString().slice(0,5)+' · '+(n==null?e:n+'건')+rec;
    fetch(u).then(function(r){if(r.status==401){timer.stop();tag.textContent='CS 상황판: 초대코드가 맞지 않아요 — 북마크를 다시 만드세요'}}).catch(function(){new Image().src=u});
  }
  function post(o){return fetch(F,{method:'POST',headers:{'Content-Type':'application/json','x-cs-code':C},body:JSON.stringify(o)}).then(function(r){return r.json()})}
  function docs(){var d=[document];for(var i=0;i<frames.length;i++){try{if(frames[i].document.body)d.push(frames[i].document)}catch(e){}}return d}
  function find(t){var ds=docs();for(var i=0;i<ds.length;i++){var eq=function(e){return e.textContent.trim()===t};
    var x=[].find.call(ds[i].querySelectorAll('button'),eq)||[].find.call(ds[i].querySelectorAll('a,label,span,div,li'),function(e){return !e.children.length&&eq(e)});
    if(x)return x.closest('button,a,label')||x}}
  function kakao(){
    var all=document.querySelectorAll('*');
    for(var i=0;i<all.length;i++){var r=all[i].shadowRoot;if(!r)continue;
      var a=[].find.call(r.querySelectorAll('a'),function(x){return /내\s*채팅/.test(x.textContent)});
      if(a){var b=a.querySelector('.txt_badge');return send(b?parseInt(b.textContent.replace(/\D/g,''),10)||0:0)}}
    send(null,'내 채팅 메뉴를 못 찾음 — 카카오 채팅 화면을 새로고침해 주세요');
  }
  var kc=0,names={},seen={},busy=false;
  var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  async function list(api,since){return (await fetch(api+'/chats/search?size=100'+(since?'&since='+since:''),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_blocked:false,status:'all',keyword:'',labels:[]})})).json()}
  async function items(api,cut){var out=[],since='',p,j,its;
    for(p=0;p<80;p++){j=await list(api,since);its=j.items||[];
      its.forEach(function(i){if(i.updated_at>=cut)out.push(i)});
      if(!j.has_next||!its.length||its[its.length-1].updated_at<cut)break;since=its[its.length-1].last_log_id}
    return out}
  async function facts(api,c,mid){   /* 채팅 기록을 자정 전 메시지가 나올 때까지 거슬러 읽음 */
    var logs=[],since='',p,j,its,me=String(c.talk_user&&c.talk_user.id);
    for(p=0;p<10;p++){j=await (await fetch(api+'/chats/'+c.id+'/chatlogs'+(since?'?since='+since:''),{credentials:'include'})).json();its=j.items||[];logs=logs.concat(its);
      if(!j.has_prev||!its.length)break;var old=its.reduce(function(x,y){return x.send_at<y.send_at?x:y});if(old.send_at<mid)break;since=old.id;await wait(150)}
    var cust=function(x){return String(x.author_id)===me},pre=null;
    logs.forEach(function(x){if(x.send_at<mid&&(!pre||x.send_at>pre.send_at))pre=x});
    return {m:pre&&cust(pre)&&pre.send_at>=mid-864e5?1:0,w:logs.some(function(x){return cust(x)&&x.send_at>=mid})?1:0}}
  async function record(){
    if(busy)return;busy=true;try{
    var ch=(location.pathname.match(/\/(_[A-Za-z0-9]+)/)||[])[1];if(!ch){rec=' · 처리기록: 채널 채팅 화면에서만 됨';return}
    var api='/api/profiles/'+ch,mid=new Date().setHours(0,0,0,0),today=await items(api,mid),chats=[],done={};
    for(var i=0;i<today.length;i++){var c=today[i];if(seen[c.id]===c.updated_at)continue;
      if(!chats.length)rec=' · 처리기록 확인 중…';
      var f=await facts(api,c,mid);chats.push({id:c.id,a:c.assignee_id||0,m:f.m,w:f.w});done[c.id]=c.updated_at;await wait(150)}
    if(!chats.length)return;
    if(chats.some(function(c){return c.a&&!names[c.a]})){var m=await (await fetch(api+'/managers',{credentials:'include'})).json();
      (Array.isArray(m)?m:m.items||m.managers||Object.values(m).find(Array.isArray)||[]).forEach(function(x){names[x.id]=x.name})}
    var nm={};chats.forEach(function(c){if(names[c.a])nm[c.a]=names[c.a]});
    var r=await post({action:'record',src:'kakao',chats:chats,names:nm});
    if(r.seed){rec=' · 처리기록 준비 중…';var all=(await items(api,Date.now()-60*864e5)).map(function(c){return {id:c.id,a:c.assignee_id||0}});
      for(var k=0;k<all.length;k+=2000)await post({action:'seed',src:'kakao',chats:all.slice(k,k+2000)});
      r=await post({action:'record',src:'kakao',chats:chats,names:nm})}
    if(r.error){rec=' · 처리기록 오류';return}
    Object.assign(seen,done);rec=' · 오늘 처리 '+r.n;
    }finally{busy=false}
  }
  function kakaoTick(){
    if(kc++%6==0)lease().then(function(ok){if(!ok)return idle();kakao();record().catch(function(){rec=' · 처리기록 실패(다음 분에 재시도)'})});
    else if(lead)kakao()}
  function naverRead(){
    var ds=docs();
    for(var i=0;i<ds.length;i++){var t=ds[i].body.innerText,m=t.match(/검색결과\s*내역\s*\(\s*총\s*([\d,]+)\s*건/);if(!m)continue;
      var k=t.indexOf('답변여부');
      if(k>=0&&t.slice(k,k+40).indexOf('미답변')<0)return send(null,'답변여부가 미답변이 아님 — 미답변으로 바꿔주세요');
      var ids=(t.slice(m.index).match(/(^|\s)\d{9,10}(?=\s)/g)||[]).map(function(x){return x.trim()});
      ids=ids.filter(function(x,i){return ids.indexOf(x)==i});var n=parseInt(m[1].replace(/,/g,''),10);
      return send(n,ids.length==n?'':'문의번호 '+ids.length+'/'+n+'개만 읽힘 — 답변 처리 기록이 빠질 수 있음',ids)}
    send(null,'검색결과 숫자를 못 찾음 — 고객문의관리 화면을 새로고침해 주세요');
  }
  function naver(){
    var go=find('조회하기');
    if(!go)return send(null,'고객문의관리 화면이 아님 — 고객관리 → 고객문의관리를 열어 주세요');
    var p=find('6개월');if(p)p.click();
    setTimeout(function(){go.click();setTimeout(naverRead,4000)},800);
  }
  /* 뒤에 가려진 탭은 크롬이 setInterval을 1분 간격으로 늦춤 → Worker 타이머로 깨움 (Worker가 막힌 사이트면 setInterval) */
  function every(ms,f){f();var t,w;
    function fb(){if(w)w.terminate();w=null;t=setInterval(f,ms)}
    try{w=new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},'+ms+')'])));w.onmessage=f;w.onerror=fb}catch(e){fb()}
    return {stop:function(){if(w)w.terminate();clearInterval(t)}}}
  var timer=every(src=='kakao'?10000:60000,src=='kakao'?kakaoTick:function(){lease().then(function(ok){ok?naver():idle()})});
}

/* 카카오 채팅창(팝업, /chats/<id>) 답변 후보 패널. 자동 전송 없음 — '넣기'는 입력칸에 글만 넣음.
   후보: ① 대화 속 전화번호·주문번호로 찾은 주문의 상태 답변(cs-lookup.html을 숨은 iframe으로 열어 replyFor로 만듦 — 지연이면 출고일 게시판 날짜)
         ② cs-answer-rules.js 단어 규칙으로 고른 '자주 쓰는 답변' 3개 (마지막 고객 글 + 하루 안 앞 글 참고, 지연 날짜 채움)
         ③ 39개 전체 검색. 고른 것은 서버 pick으로 기록(적중률 확인용).
   대화는 채팅 기록 API로 읽음(읽음 처리 요청은 안 보냄 — 어차피 직원이 연 방).
   배치: 채팅 팝업(380px)을 오른쪽으로 W만큼 넓히고(window.resizeTo — 스크립트가 연 팝업이라 허용) 카카오 화면(#kakaoWrap)은 왼쪽, 패널은 오른쪽에 항상 표시.
         창이 좁은 채로면(넓히기가 막힌 경우) 예전처럼 버튼 + 겹쳐 뜨는 시트. 새 메시지가 오면(화면 변화 3초 뒤) 다시 계산 — 주문 조회는 검색어별로 한 번만. */
function panel(C,F){
  var m=location.pathname.match(/\/channel\/(_[A-Za-z0-9]+)\/chats\/(\d+)/);if(!m||window.__csPanel)return;window.__csPanel=1;
  var ch=m[1],chat=m[2],api='/api/profiles/'+ch,PAGES='https://qkralsrb03138668.github.io',favs=null,rank=null,frame=null,seq=0,wait={},shown=[];
  var SKIP=['성함과 연락처 남겨주세요','확인 후 안내'],W=330,wrap=document.getElementById('kakaoWrap'),wrapCss=wrap?wrap.style.cssText:'',composed={},lastKey='';
  function el(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
  function post(o){return fetch(F,{method:'POST',headers:{'Content-Type':'application/json','x-cs-code':C},body:JSON.stringify(o)}).then(function(r){return r.json()}).catch(function(){})}
  var btn=el('button','position:fixed;right:12px;bottom:104px;z-index:2147483646;background:#2C49D6;color:#fff;border:0;border-radius:18px;padding:8px 14px;font:600 13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer','💬 추천 답변');
  var sheet=el('div','position:fixed;left:8px;right:8px;bottom:96px;max-height:68vh;overflow:auto;z-index:2147483647;background:#fff;color:#15171C;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.3);font:13px/1.5 sans-serif;padding:12px;display:none');
  var SHEET=sheet.style.cssText,SIDE='position:fixed;right:0;top:0;bottom:0;width:'+W+'px;box-sizing:border-box;overflow:auto;z-index:2147483647;background:#F3F4F7;color:#15171C;border-left:1px solid #DFE2E9;font:13px/1.5 sans-serif;padding:12px;display:block';
  document.body.appendChild(btn);document.body.appendChild(sheet);
  btn.onclick=function(){if(sheet.style.display==='block'){sheet.style.display='none';return}sheet.style.display='block';open()};
  function isSide(){return innerWidth>=380+W}
  function layout(){
    if(isSide()){if(wrap)wrap.style.cssText=wrapCss+';position:fixed;left:0;top:0;bottom:0;width:calc(100% - '+W+'px);transform:translateZ(0);overflow:hidden';sheet.style.cssText=SIDE;btn.style.display='none'}
    else{if(wrap)wrap.style.cssText=wrapCss;sheet.style.cssText=SHEET;btn.style.display=''}}
  function hide(){if(!isSide())sheet.style.display='none'}
  if(!isSide())try{window.resizeTo(window.outerWidth+W,window.outerHeight)}catch(e){}
  setTimeout(function(){layout();if(isSide())open()},400);
  window.addEventListener('resize',function(){var was=sheet.style.cssText===SIDE;layout();if(isSide()&&!was)open()});
  var tm;if(wrap)new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(function(){if(isSide())open(true)},3000)}).observe(wrap,{childList:true,subtree:true});
  async function loadFavs(){var all=[],p,j;for(p=0;p<5;p++){j=await (await fetch(api+'/chat_favorite_answers?page='+p+'&limit=20',{credentials:'include'})).json();all=all.concat(j.items||[]);if(!j.has_next)break}
    var seen={};return all.filter(function(a){if(seen[a.id])return false;return seen[a.id]=1}).map(function(a){return {name:a.name,text:a.description}})}
  async function loadRules(){var src=await (await fetch(PAGES+'/ad-dashboard/cs-answer-rules.js?'+Date.now())).text();return (0,eval)(src+'\n;csRank')}
  async function talk(){   /* 고객 글: 마지막 묶음(우리 답 이후) + 하루 안 앞 글 */
    var logs=[],since='',p,j,its,i;for(p=0;p<3;p++){j=await (await fetch(api+'/chats/'+chat+'/chatlogs'+(since?'?since='+since:''),{credentials:'include'})).json();its=j.items||[];logs=logs.concat(its);
      if(!j.has_prev||!its.length)break;var old=its.reduce(function(x,y){return x.send_at<y.send_at?x:y});if(Date.now()-old.send_at>864e5)break;since=old.id}
    var seen={};logs=logs.filter(function(x){if(seen[x.id])return false;return seen[x.id]=1}).sort(function(a,b){return a.send_at-b.send_at});
    var cust=function(x){return String(x.author_id)!==ch&&typeof x.message==='string'&&x.message};
    var lastOurs=-1;for(i=0;i<logs.length;i++)if(!cust(logs[i])&&String(logs[i].author_id)===ch)lastOurs=i;
    var after=logs.slice(lastOurs+1).filter(cust).map(function(x){return x.message});
    var day=logs.filter(function(x){return cust(x)&&Date.now()-x.send_at<864e5}).map(function(x){return x.message});
    if(!after.length&&day.length)after=[day[day.length-1]];
    return {text:after.join(' / '),ctx:day.slice(0,Math.max(0,day.length-after.length)).join(' / '),all:logs.filter(cust).map(function(x){return x.message}).reverse()}}
  function findQ(all){for(var i=0;i<all.length;i++){var t=all[i],o=t.match(/\d{8}-\d{7}/);if(o)return o[0];var ph=t.match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/);if(ph)return ph[0].replace(/[\s.]/g,'-')}return ''}
  function compose(q){return new Promise(function(res){
    if(!frame){frame=el('iframe','display:none');frame.src=PAGES+'/ad-dashboard/cs-lookup.html?embed=1&code='+encodeURIComponent(C);document.body.appendChild(frame);
      window.addEventListener('message',function(ev){if(ev.origin!==PAGES||!ev.data||ev.data.type!=='cs-composed'||!wait[ev.data.id])return;wait[ev.data.id](ev.data);delete wait[ev.data.id]})}
    var id=++seq;wait[id]=res;setTimeout(function(){if(wait[id]){delete wait[id];res({error:'주문조회 응답 없음'})}},25000);
    var go=function(){frame.contentWindow.postMessage({type:'cs-compose',id:id,q:q},PAGES)};
    if(frame.dataset.ok)go();else frame.addEventListener('load',function(){frame.dataset.ok=1;setTimeout(go,300)},{once:true})})}
  function insert(text,key,rank){var ta=document.querySelector('#chatWrite');if(!ta)return alert('입력칸을 못 찾았어요');
    var set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,ta.value?ta.value+'\n\n'+text:text);ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus();
    hide();post({action:'pick',chat:chat,pick:key,rank:rank,top:shown.slice(0,5)})}
  function card(title,text,key,rank,tag){var c=el('div','border:1px solid #DFE2E9;border-radius:10px;padding:8px 10px;margin:6px 0');
    var h=el('div','display:flex;gap:6px;align-items:center');h.appendChild(el('b','flex:1',title));if(tag)h.appendChild(el('span','font-size:11px;color:#2C49D6;background:#E4E9FB;border-radius:99px;padding:1px 7px',tag));
    var b=el('button','border:0;background:#2C49D6;color:#fff;border-radius:8px;padding:4px 10px;font:600 12px sans-serif;cursor:pointer','넣기');b.onclick=function(){insert(text,key,rank)};h.appendChild(b);c.appendChild(h);
    c.appendChild(el('div','color:#5E6472;font-size:12px;white-space:pre-wrap;max-height:3.1em;overflow:hidden;margin-top:3px',text.replace(/^안녕하세요[^\n]*\n+/,'')));return c}
  async function open(auto){
    if(!auto){sheet.innerHTML='';sheet.appendChild(el('div','color:#5E6472','대화 읽는 중…'))}
    try{
      if(!favs)favs=await loadFavs();if(!rank)rank=await loadRules();
      var t=await talk(),q=findQ(t.all),order=null,note='';
      if(auto&&t.text+'|'+q===lastKey)return;lastKey=t.text+'|'+q;
      if(q){var r=composed[q]||(composed[q]=await compose(q));if(r.error)delete composed[q];if(r.error)note='주문조회 실패: '+r.error;else if(!r.orders||!r.orders.length)note='"'+q+'"로 주문을 못 찾았어요';else order=r.orders[0]}
      else note='대화에 전화번호·주문번호가 없어 주문은 못 찾았어요';
      var delay=order&&order.items.map(function(i){return i.delay}).filter(Boolean)[0];
      var when=delay?delay.split(' · ').pop().replace(/\s*출고$/,'').trim():'';
      var names=rank(t.text,t.ctx).map(function(x){return x.name}).filter(function(n){return SKIP.indexOf(n)<0});
      var top=names.map(function(n){return favs.find(function(f){return f.name===n})}).filter(Boolean).slice(0,3);
      sheet.innerHTML='';
      var head=el('div','display:flex;align-items:center;margin-bottom:4px');head.appendChild(el('b','flex:1;font-size:14px','추천 답변'));var rf=el('button','border:0;background:none;font-size:14px;cursor:pointer;color:#5E6472','↻');rf.title='다시 계산';rf.onclick=function(){open()};head.appendChild(rf);
      if(!isSide()){var x=el('button','border:0;background:none;font-size:16px;cursor:pointer','✕');x.onclick=function(){sheet.style.display='none'};head.appendChild(x)}sheet.appendChild(head);
      sheet.appendChild(el('div','color:#9AA0AD;font-size:11px;margin-bottom:6px','넣기를 누르면 입력칸에 들어가기만 해요. 고쳐서 직접 보내세요.'));
      shown=[];
      if(order){shown.push('order');sheet.appendChild(card('주문 상태 답변 · '+order.date+' 주문',order.reply,'order',0,order.items.map(function(i){return i.status_text}).filter(function(v,i,a){return a.indexOf(v)==i}).join(', ')))}
      top.forEach(function(f,i){var txt=when?f.text.replace(/(예상 출고일은 )[^\n]*?( ?입니다)/,'$1'+when+'$2'):f.text;shown.push(f.name);sheet.appendChild(card(f.name,txt,f.name,i+1,i===0&&!order?'1순위':''))});
      if(!order&&!top.length)sheet.appendChild(el('div','color:#5E6472;margin:6px 0','맞는 자주 쓰는 답변을 못 찾았어요. 아래에서 검색하세요.'));
      if(note){var n=el('div','color:#C7791F;font-size:12px;margin:6px 0',note);sheet.appendChild(n);if(!order){var f0=favs.find(function(f){return f.name==='성함과 연락처 남겨주세요'});if(f0)sheet.appendChild(card(f0.name,f0.text,f0.name,9))}}
      var box=el('input','width:100%;box-sizing:border-box;margin-top:8px;padding:7px 9px;border:1px solid #DFE2E9;border-radius:8px;font:13px sans-serif');box.placeholder='자주 쓰는 답변 '+favs.length+'개에서 검색';var res=el('div');
      box.oninput=function(){res.innerHTML='';var k=box.value.trim();if(!k)return;favs.filter(function(f){return f.name.indexOf(k)>=0||f.text.indexOf(k)>=0}).slice(0,8).forEach(function(f){res.appendChild(card(f.name,f.text,f.name,-1))})};
      sheet.appendChild(box);sheet.appendChild(res);
    }catch(e){sheet.innerHTML='';sheet.appendChild(el('div','color:#CC3F38','추천을 못 만들었어요: '+e.message))}
  }
}

/* Tampermonkey 자동 실행 — 북마크로 eval될 때는 GM_info가 없어서 건너뜀.
   카카오 채팅창 팝업(/chats/<id>) → 답변 패널. 카카오 채팅 목록(/chats)·네이버 고객문의 → 수집(이 PC에서 켠 경우만, 처음 한 번 물어봄).
   초대코드는 처음 한 번만 (사이트별 localStorage). 카카오는 화면 이동이 새로고침 없이 일어나서 3초마다 경로 확인. */
if(typeof GM_info!=='undefined')(function(){
  var F='https://pydxcqfztjogmztvayux.supabase.co/functions/v1/cs-lookup',K='cs_board_code',ON='cs_board_on',kakao=/kakao/.test(location.hostname);
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
  function code(){var c=ls(K);if(!c){c=prompt('CS 초대코드를 입력하세요 (처음 한 번만)');if(c)ls(K,c.trim())}return c&&c.trim()}
  var t=setInterval(function(){
    var p=location.pathname;
    if(kakao&&/\/chats\/\d+/.test(p)){clearInterval(t);var c=code();if(c)panel(c,F);return}
    if(!(kakao?/\/channel\/_[A-Za-z0-9]+\/chats\/?$/.test(p):/조회하기/.test(document.body.innerText)))return;
    clearInterval(t);
    if(ls(ON)==null)ls(ON,confirm('CS 상황판: 이 PC에서 상황판 숫자·처리 기록을 자동으로 모을까요?\n(수집은 한 PC만 켜면 충분해요. 상담원 PC는 "취소" — 답변 패널은 그대로 써요)')?'1':'0');
    if(ls(ON)!=='1')return;var c2=code();if(c2)tracker(c2,F);
  },3000);
})();
