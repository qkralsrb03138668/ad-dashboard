// ==UserScript==
// @name         CS 상황판 자동 실행 (다나로브)
// @namespace    danarobe-cs
// @version      9
// @description  CS 상황판 숫자·처리 기록 자동 수집(수집 PC 한 대) + 카카오 채팅창·네이버 고객문의 답변 후보 패널(상담원 PC)
// @match        https://business.kakao.com/*
// @match        https://admin.pay.naver.com/front/m/v2/customer/inquiry*
// @grant        GM_xmlhttpRequest
// @connect      danarobe.sellmate.co.kr
// @require      https://qkralsrb03138668.github.io/ad-dashboard/cs-answer-rules.js
// @require      https://qkralsrb03138668.github.io/ad-dashboard/cs-reply.js
// @run-at       document-idle
// @updateURL    https://qkralsrb03138668.github.io/ad-dashboard/cs-tracker.user.js
// @downloadURL  https://qkralsrb03138668.github.io/ad-dashboard/cs-tracker.user.js
// ==/UserScript==
// 고친 뒤엔 @version을 올릴 것 — Tampermonkey가 하루 한 번 새 버전을 받아 감(@require 규칙 파일도 그때 새로 받음). 상황판 북마크(cs-board.html)도 이 파일을 받아 실행.
// (GM_xmlhttpRequest 권한) 셀메이트(다른 사이트)를 이 브라우저의 셀메이트 로그인 그대로 조회하려고 — 셀메이트 탭을 안 열어도 됨. 북마크로 실행될 땐 GM이 없어 셀메이트만 빠짐.
//
// tracker(C,F): 카카오·네이버 탭에서 카카오 10초·네이버 1분마다 숫자를 서버로 보냄
//    카카오: 왼쪽 메뉴(shadow DOM) '내 채팅' 옆 .txt_badge — 카카오 화면이 알아서 수시로 갱신
//           + 1분마다 처리 기록: 채팅 목록 API(카카오 화면이 쓰는 것, 100개씩·since=마지막 last_log_id)에서 오늘 바뀐 채팅마다
//             채팅 기록(GET .../chats/<id>/chatlogs, 20개씩·since=가장 오래된 id로 이전 페이지)을 자정 전까지 읽어
//             m(어제 고객 말에 답 못 한 채 자정 넘김)·w(오늘 고객이 씀) 계산 → 서버가 '오늘 새로 시작된 상담'만 셈 (kakao-step.ts)
//    네이버: '6개월'(끝 날짜를 오늘로) → '조회하기' 누르고 첫 페이지에서 답변일시가 '미답변'인 줄 세기(필터는 '전체' 그대로) + 그 줄들의 문의번호 — 사라진 번호 = 답변 처리(서버가 셈)
/* 상담 데이터(cs_qa) — "고객 질문 묶음 → 바로 뒤 사람 직원 답변 묶음" 쌍. 자동응답·챗봇·메뉴 버튼은 빼고, 전화번호·주소·계좌·이메일은 가림.
   6개월치는 2026-10-01 한 번 수집, 그 뒤로는 수집 PC의 tracker가 매일 그날 쌍을 올림 (서버가 같은 채팅방·시각은 건너뜀). */
function qaMask(s){return String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'[이메일]').replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g,'[전화번호]').replace(/\d{2,6}-\d{2,6}-\d{2,8}/g,'[번호]').replace(/\d{10,}/g,'[번호]')
  .replace(/(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]{0,50}?(\d+동\s*\d+호|\d+호|번길\s*\d+|로\s*\d+(-\d+)?|길\s*\d+)[^\n]{0,20}/g,'[주소]').replace(/\r/g,'').trim()}
function qaPairs(logs,user,chatId,since){   /* logs = 카카오 채팅 기록(오래된 것부터), user = 고객 id → [{src,ref,asked_at,q,a}] */
  var AUTO=/채팅 운영시간|챗봇 상담|상담 가능 시간이 아닙니다|알림톡\/브랜드메시지|채널을 추가해 주셔서|쿠폰이 지급되었습니다|^\(광고\)/;
  var MENU=/^(상담 접수|배송 안내|교환\/반품|교환\/반품정책|교환\/반품 배송비 안내|네이버페이 교환\/반품 방법|사진|사진 \d+장|동영상|자주하는 질문|상담원 연결|처음으로)$/;
  var out=[],cb=[],cAt=0,hb=[],lastC=0,done=function(){var q=qaMask(cb.join('\n')),a=qaMask(hb.join('\n'));
    if(cAt>=since&&q.replace(/\s/g,'').length>=4&&a.replace(/\s/g,'').length>=10)out.push({src:'kakao',ref:String(chatId),asked_at:cAt,q:q.slice(0,3000),a:a.slice(0,4000)});cb=[];hb=[]};
  logs.forEach(function(x){if(typeof x.message!=='string'||!x.message.trim())return;var t=x.message.trim();
    if(String(x.author_id)===String(user)){if(hb.length)done();if(MENU.test(t))return;if(!cb.length)cAt=x.send_at;cb.push(t);lastC=x.send_at;return}
    var bot=x.type!==1||AUTO.test(t)||(x.send_at-lastC<3000&&!hb.length);if(!bot&&cb.length)hb.push(t)});
  if(hb.length)done();return out}

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
    logs=logs.slice().sort(function(a,b){return a.send_at-b.send_at});qaBuf=qaBuf.concat(qaPairs(logs,me,c.id,mid));
    return {m:pre&&cust(pre)&&pre.send_at>=mid-864e5?1:0,w:logs.some(function(x){return cust(x)&&x.send_at>=mid})?1:0}}
  var qaBuf=[];
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
    if(qaBuf.length){var rows=qaBuf.splice(0,500);post({action:'qa-add',rows:rows}).then(function(x){if(x&&x.error)qaBuf=rows.concat(qaBuf)})}
    Object.assign(seen,done);rec=' · 오늘 처리 '+r.n;
    }finally{busy=false}
  }
  function kakaoTick(){
    if(kc++%6==0)lease().then(function(ok){if(!ok)return idle();kakao();record().catch(function(){rec=' · 처리기록 실패(다음 분에 재시도)'})});
    else if(lead)kakao()}
  /* 네이버 미답변 세기 (2026-10-01 사용자: 답변여부 필터는 '전체'로 둠) — 조회 결과 첫 페이지(10줄)에서 답변일시 칸이 '미답변'인 줄.
     ponytail: 첫 페이지만 봄. 상단 '고객문의 미답변 N건'이 더 크면 경고만 — 다 세려면 네이버 목록 API(front-api/m/v2/inquiry/list) 요청 형식을 알아내 직접 부를 것 */
  function naverRead(){
    var ds=docs();
    for(var i=0;i<ds.length;i++){var d=ds[i];if(!/검색결과\s*내역/.test(d.body.innerText))continue;
      var rows=[].filter.call(d.querySelectorAll('tbody tr'),function(tr){return !tr.querySelector('[colspan]')&&tr.children.length>=6});
      var un=rows.filter(function(tr){var c=tr.children;return (c[c.length-2].innerText||'').trim()==='미답변'});
      var ids=un.map(function(tr){return tr.children[0].innerText.trim()}).filter(function(x){return /^\d{6,}$/.test(x)});
      var st=[].find.call(d.querySelectorAll('dd'),function(x){return /고객문의 미답변/.test(x.innerText)}),top=st?parseInt((st.querySelector('b')||{}).innerText||'',10):NaN;
      var n=un.length,note=!isNaN(top)&&top>n?'네이버 상단 미답변 '+top+'건 — 첫 페이지 밖에 더 있을 수 있어요':'';
      lastN=n;lastIds=ids;return send(n,note,ids)}
    send(null,'검색결과를 못 찾음 — 고객문의관리 화면을 새로고침해 주세요');
  }
  var lastN=null,lastIds=null;
  function naver(){
    var ae=document.activeElement,busy=document.querySelector('textarea[id^="answer-box-"]')||(ae&&/TEXTAREA|INPUT/.test(ae.tagName));
    if(busy){if(lastN!=null)send(lastN,'',lastIds);return}   /* 직원이 답변 중 — 마지막 숫자만 다시 보냄 */
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

/* 셀메이트 조회 (cs-overlay-private.js의 search()와 같은 요청 2개, 2026-09-22 확인) — Tampermonkey GM_xmlhttpRequest로 셀메이트 로그인 쿠키 그대로.
     POST /cs/new_cs_search.asp mode=list&search_how=all&date_type=all&search_text=… → 주문 행 HTML (lineClick('idx','happo','주문일',…))
     POST /cs/new_cs_ok.asp mode=lineClick&valuePoint=idx|happo&selectValue=…&orderDate=… → JSON {list:[{dealerNo, dealerName, proOpt, outputPossible, in_list…}]}
   셀메이트 화면이 바뀌면 여기와 cs-overlay-private.js를 같이 고칠 것. */
function smSearch(q){
  if(typeof GM_xmlhttpRequest==='undefined')return Promise.reject(new Error('셀메이트 조회는 Tampermonkey에서만 돼요'));
  var BASE='https://danarobe.sellmate.co.kr';
  function req(path,body){return new Promise(function(res,rej){GM_xmlhttpRequest({method:'POST',url:BASE+path,data:body,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:20000,
    onload:function(r){res({url:r.finalUrl||'',text:r.responseText||''})},onerror:function(){rej(new Error('셀메이트 연결 실패'))},ontimeout:function(){rej(new Error('셀메이트 응답 없음'))}})})}
  return (async function(){
    var r=await req('/cs/new_cs_search.asp','mode=list&search_how=all&date_type=all&search_text='+encodeURIComponent(q));
    if(/login/i.test(r.url)||(r.text.indexOf('lineClick')<0&&r.text.indexOf('주문이 없습니다')<0))throw new Error('셀메이트 로그인이 필요해요 (이 크롬에서 셀메이트에 로그인)');
    var rows=[],m,re=/lineClick\(([^)]*)\)/g;while((m=re.exec(r.text))){var a2=[],x,re2=/'([^']*)'/g;while((x=re2.exec(m[1])))a2.push(x[1]);rows.push({idx:a2[0],happo:a2[1],date:a2[2]})}
    var items=[],seen={};
    for(var i=0;i<rows.length&&i<20;i++){var row=rows[i],key=row.happo||row.idx;if(seen[key])continue;seen[key]=1;
      var vp=row.happo?'valuePoint=happo&selectValue='+row.happo:'valuePoint=idx&selectValue='+row.idx;
      var d=await req('/cs/new_cs_ok.asp','mode=lineClick&'+vp+'&orderDate='+row.date+'&ord_status=all'),j;try{j=JSON.parse(d.text)}catch(e){continue}
      (j.list||[]).forEach(function(x){var inl=[];try{inl=JSON.parse(x.in_list||'[]')}catch(e){}var st=inl[0]||{};
        items.push({order_id:String(x.dealerNo||''),name:String(x.dealerName||x.proName||''),opt:String(x.proOpt||'').trim(),qty:Number(x.proCount)||1,possible:Number(x.outputPossible),sent:String(x.sendDate||''),cancel:Number(x.cancel)||0,
          stock:typeof st.nowJaego==='number'?st.nowJaego:null,in_date:st.inputDate&&st.inputDate!=='1900-01-01'?String(st.inputDate):''})})}
    return items})()}

/* 네이버페이센터 고객문의 화면 구조 보고 — 나(Claude)는 이 사이트를 직접 못 열어서, 고객 글을 지운 뼈대(태그·class·버튼 글자·입력칸)를 서버 diag로 보냄.
   page = 처음 화면 · api = 화면이 불러온 데이터 주소(경로·파라미터 이름만, 값 없음) · open = 문의를 펼친 칸 · form = 펼친 칸에 답변 입력칸(textarea)이 있을 때.
   종류별로 한 번씩 (localStorage). 2026-10-01: 첫 보고 때 미답변이 0건이라 답변칸을 못 봄 → 펼친 칸은 답변 끝난 문의라도 보내게. */
function naverDiag(C,F){
  var V='cs_diag6_';function done(k){try{return localStorage.getItem(V+k)==='1'}catch(e){return false}}function mark(k){try{localStorage.setItem(V+k,'1')}catch(e){}}
  function skel(root){var out=[],n=0;
    (function walk(el,d){if(n++>4000||d>40)return;
      if(el.nodeType===3){var t=el.textContent.trim();if(t)out.push('  '.repeat(d)+(t.length<=14&&!/\d{3,}/.test(t)?JSON.stringify(t):'[글 '+t.length+'자]'));return}
      if(el.nodeType!==1||/^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT)$/.test(el.tagName))return;
      var at=['id','class','name','type','role','placeholder','aria-label','title','href','colspan','maxlength'].map(function(k){var v=el.getAttribute(k);if(v==null)return '';if(k==='href')v=v.replace(/[?#].*$/,'');return ' '+k+'="'+String(v).slice(0,60)+'"'}).join('');
      out.push('  '.repeat(d)+'<'+el.tagName.toLowerCase()+at+'>');[].forEach.call(el.childNodes,function(c){walk(c,d+1)})})(root,0);return out.join('\n')}
  function send(kind,html){if(done(kind))return;mark(kind);fetch(F,{method:'POST',headers:{'Content-Type':'application/json','x-cs-code':C},body:JSON.stringify({action:'diag',src:'naver',kind:kind,url:location.pathname,html:html})}).catch(function(){})}
  function apis(){var seen={};return performance.getEntriesByType('resource').filter(function(e){return /xmlhttprequest|fetch/.test(e.initiatorType)}).map(function(e){try{var u=new URL(e.name);return e.initiatorType+' '+u.host+u.pathname.replace(/\d{6,}/g,'N')+(u.search?' ?'+[].concat(Array.from(u.searchParams.keys())).join(','):'')}catch(x){return ''}}).filter(function(x){if(!x||seen[x])return false;return seen[x]=1}).join('\n')}
  send('page',skel(document.body));setTimeout(function(){send('api',apis())},4000);
  var body=document.querySelector('tbody')||document.body;
  new MutationObserver(function(ms){ms.forEach(function(m){[].forEach.call(m.addedNodes,function(nd){if(nd.nodeType!==1)return;
    var row=nd.closest?nd.closest('tr')||nd:nd;if(row.querySelector&&row.querySelector('textarea'))send('form',skel(row));else if(row.tagName==='TR'&&row.querySelector('[colspan]'))send('open',skel(row));
    if(!done('api2'))setTimeout(function(){send('api2',apis())},1500)})})}).observe(body,{childList:true,subtree:true});
}

/* ── 답변 패널 공용 (카카오·네이버) ──
   주문: 서버 search(전화번호·주문번호·네이버 주문번호) + delays(출고일 안내 게시판) + 셀메이트(smSearch) → cs-reply.js(@require, CS 주문조회와 같은 문구)로 답변.
   자주 쓰는 답변: cs-answer-rules.js(@require) 단어 규칙으로 3개. 넣기는 입력칸에 글만 넣음 — 전송/등록 버튼은 절대 안 누름. 고른 것은 서버 pick으로 기록. */
function el(t,css,txt){var e=document.createElement(t);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
function csPost(C,F,o){return fetch(F,{method:'POST',headers:{'Content-Type':'application/json','x-cs-code':C},body:JSON.stringify(o)}).then(function(r){return r.json()}).catch(function(){return {error:'서버 연결 실패'}})}
var csDelays=null;
async function lookupOrder(C,F,q,smQ){   /* → {order, delays, sm, note} */
  if(typeof CSR==='undefined')return {note:'답변 문구 파일을 못 불러왔어요 (Tampermonkey 업데이트 확인)'};
  if(!csDelays||csDelays.error)csDelays=await csPost(C,F,{action:'delays'});
  var r=await csPost(C,F,{action:'search',q:q});
  if(r.error)return {note:'주문조회 실패: '+r.error};
  if(!r.orders||!r.orders.length)return {note:'"'+q+'"로 주문을 못 찾았어요'};
  var o=r.orders[0],sm=null,note='';try{sm=await smSearch(smQ||o.order_id)}catch(e){note=e.message}
  return {order:o,delays:csDelays,sm:sm,note:note}}
function setInput(ta,text){var set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(ta,ta.value?ta.value+'\n\n'+text:text);ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()}
function ansCard(title,text,onInsert,tag){var c=el('div','border:1px solid #DFE2E9;border-radius:10px;padding:8px 10px;margin:6px 0;background:#fff;color:#15171C;font:13px/1.5 sans-serif');
  var h=el('div','display:flex;gap:6px;align-items:center');h.appendChild(el('b','flex:1',title));if(tag)h.appendChild(el('span','font-size:11px;color:#2C49D6;background:#E4E9FB;border-radius:99px;padding:1px 7px',tag));
  var b=el('button','border:0;background:#2C49D6;color:#fff;border-radius:8px;padding:4px 10px;font:600 12px sans-serif;cursor:pointer','넣기');b.type='button';b.onclick=function(){onInsert(text)};h.appendChild(b);c.appendChild(h);
  var pv=el('div','color:#5E6472;font-size:12px;white-space:pre-wrap;max-height:3.1em;overflow:hidden;margin-top:3px');c.appendChild(pv);
  c.setText=function(t){text=t;pv.textContent=t.replace(/^안녕하세요[^\n]*\n+/,'')};c.setText(text);return c}
/* 후보 목록을 box에 그림: ① 주문 상태 답변(품목 체크) ② 자주 쓰는 답변 3개 ③ 검색 */
function renderAnswers(box,o){   /* o = {lk, text, ctx, favs, similar:[{q,a,asked_at,score}], insert(text,key,rank,shown)} */
  var SKIP=['성함과 연락처 남겨주세요','확인 후 안내'],lk=o.lk||{},order=lk.order,shown=[],ins=function(key,rank){return function(t){o.insert(t,key,rank,shown)}};
  /* 배송 문의일 때만 주문 상태 답변을 맨 위에 (2026-10-01: 색상 변경 문의에 배송 답변이 1번으로 나와 헷갈림) */
  var ranked=typeof csRank==='function'?csRank(o.text,o.ctx):[],shipQ=/언제|배송|출고|발송|도착|받을 ?수|출발/.test(o.text)&&!(ranked[0]&&/교환|반품|철회|사이즈|불량|취소/.test(ranked[0].name));
  var tail=el('div');
  function similarBlock(){var sm=(o.similar||[]).filter(function(x){return x.score>=20}).slice(0,3);if(!sm.length)return;
    box.appendChild(el('div','font:600 12px sans-serif;color:#5E6472;margin:10px 0 2px','비슷한 과거 상담 (직원이 실제로 보낸 답변 — 날짜·상품명은 꼭 고쳐서)'));
    sm.forEach(function(x,i){var c=ansCard('“'+x.q.replace(/\s+/g,' ').slice(0,40)+(x.q.length>40?'…':'')+'”',x.a,ins('similar',20+i),String(x.asked_at).slice(5,10).replace('-','/')+' · '+x.score+'%');shown.push('similar');box.appendChild(c)})}
  if(order&&!shipQ){var realBox=box;box=tail}
  if(order){shown.push('order');
    var OPEN=['N00','N10','N20','N21','N22','N30'],its=order.items,anyOpen=its.some(function(i){return OPEN.indexOf(i.status)>=0}),boxes=[];
    var pickNow=function(){return boxes.map(function(b,k){return b.checked?k:-1}).filter(function(k){return k>=0})};
    var sum=CSR.summary(order,lk.delays,lk.sm,its.map(function(i,k){return !anyOpen||OPEN.indexOf(i.status)>=0?k:-1}).filter(function(k){return k>=0}));
    var oc=ansCard('주문 상태 답변 · '+sum.date+' 주문',sum.reply,ins('order',0),its.length>1?'체크한 상품만':'');box.appendChild(oc);
    var info=el('div','font:12px/1.55 sans-serif;color:#5E6472;margin:-2px 0 8px;padding:6px 9px;background:#fff;border-radius:8px');
    sum.items.forEach(function(i){var row=el('label','display:flex;gap:6px;align-items:flex-start;cursor:pointer'),cb=el('input');cb.type='checkbox';cb.style.marginTop='3px';
      cb.checked=!anyOpen||OPEN.indexOf(i.status)>=0;cb.onchange=function(){var p=pickNow();oc.setText(p.length?CSR.summary(order,lk.delays,lk.sm,p).reply:'답변에 넣을 상품을 하나 이상 체크하세요')};boxes.push(cb);row.appendChild(cb);
      var t=i.name+(i.opt?' ('+String(i.opt).split(',').map(function(x){return x.split('=').pop().trim()}).join(', ')+')':'')+' — '+(i.status_text||'');
      if(i.sm)t+=' · 셀메이트 '+(i.sm.possible===1?'출고가능':i.sm.possible===0?'출고불가':'?')+(i.sm.stock!=null?' · 재고 '+i.sm.stock:'')+(i.sm.in_date?' · 입고예정 '+i.sm.in_date:'');
      if(i.delay)t+=' · 게시판: '+i.delay.split(' · ').pop();row.appendChild(el('span','',t));info.appendChild(row)});
    if(lk.note)info.appendChild(el('div','color:#C7791F',lk.note));box.appendChild(info)}
  if(realBox)box=realBox;
  if(!shipQ)similarBlock();
  var delay=order&&CSR.summary(order,lk.delays,lk.sm).items.map(function(i){return i.delay}).filter(Boolean)[0],when=delay?delay.split(' · ').pop().replace(/\s*출고$/,'').trim():'';
  var favs=o.favs||[],names=ranked.map(function(x){return x.name}).filter(function(n){return SKIP.indexOf(n)<0});
  names.map(function(n){return favs.find(function(f){return f.name===n})}).filter(Boolean).slice(0,3).forEach(function(f,i){
    var txt=when?f.text.replace(/(예상 출고일은 )[^\n]*?( ?입니다)/,'$1'+when+'$2'):f.text;shown.push(f.name);box.appendChild(ansCard(f.name,txt,ins(f.name,i+1),i===0&&!order?'1순위':''))});
  if(!order&&shown.length===0)box.appendChild(el('div','color:#5E6472;margin:6px 0;font:12px sans-serif',favs.length?'맞는 자주 쓰는 답변을 못 찾았어요. 아래에서 검색하세요.':'자주 쓰는 답변 목록이 아직 없어요 (카카오 채팅창을 한 번 열면 생겨요)'));
  if(!order&&lk.note){box.appendChild(el('div','color:#C7791F;font:12px sans-serif;margin:6px 0',lk.note));var f0=favs.find(function(f){return f.name==='성함과 연락처 남겨주세요'});if(f0)box.appendChild(ansCard(f0.name,f0.text,ins(f0.name,9)))}
  if(shipQ)similarBlock();
  if(tail.childNodes.length){box.appendChild(el('div','font:600 12px sans-serif;color:#5E6472;margin:10px 0 2px','주문 정보'));while(tail.firstChild)box.appendChild(tail.firstChild)}
  var sb=el('input','width:100%;box-sizing:border-box;margin-top:8px;padding:7px 9px;border:1px solid #DFE2E9;border-radius:8px;font:13px sans-serif;background:#fff;color:#15171C');sb.placeholder='자주 쓰는 답변 '+favs.length+'개에서 검색';var res=el('div');
  sb.oninput=function(){res.innerHTML='';var k=sb.value.trim();if(!k)return;favs.filter(function(f){return f.name.indexOf(k)>=0||f.text.indexOf(k)>=0}).slice(0,8).forEach(function(f){res.appendChild(ansCard(f.name,f.text,ins(f.name,-1)))})};
  box.appendChild(sb);box.appendChild(res);return shown}

/* 카카오 채팅창(팝업, /chats/<id>) 패널. 팝업(380px)을 오른쪽으로 W만큼 넓혀 카카오 화면(#kakaoWrap)은 왼쪽, 패널은 오른쪽에 항상 표시
   (window.resizeTo — 스크립트가 연 팝업이라 허용). 창이 좁으면 버튼 + 겹쳐 뜨는 시트. 새 메시지가 오면(화면 변화 3초 뒤) 다시 계산 — 주문 조회는 검색어별 한 번.
   대화는 채팅 기록 API로 읽음(읽음 처리 요청은 안 보냄). 자주 쓰는 답변은 서버에도 저장 → 네이버 패널이 씀. */
function panel(C,F){
  var m=location.pathname.match(/\/channel\/(_[A-Za-z0-9]+)\/chats\/(\d+)/);if(!m||window.__csPanel)return;window.__csPanel=1;
  var ch=m[1],chat=m[2],api='/api/profiles/'+ch,favs=null,looked={},lastKey='',W=330,wrap=document.getElementById('kakaoWrap'),wrapCss=wrap?wrap.style.cssText:'';
  var btn=el('button','position:fixed;right:12px;bottom:104px;z-index:2147483646;background:#2C49D6;color:#fff;border:0;border-radius:18px;padding:8px 14px;font:600 13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer','💬 추천 답변');
  var sheet=el('div','position:fixed;left:8px;right:8px;bottom:96px;max-height:68vh;overflow:auto;z-index:2147483647;background:#F3F4F7;color:#15171C;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.3);font:13px/1.5 sans-serif;padding:12px;display:none');
  var SHEET=sheet.style.cssText,SIDE='position:fixed;right:0;top:0;bottom:0;width:'+W+'px;box-sizing:border-box;overflow:auto;z-index:2147483647;background:#F3F4F7;color:#15171C;border-left:1px solid #DFE2E9;font:13px/1.5 sans-serif;padding:12px;display:block';
  document.body.appendChild(btn);document.body.appendChild(sheet);
  btn.onclick=function(){if(sheet.style.display==='block'){sheet.style.display='none';return}sheet.style.display='block';open()};
  function isSide(){return innerWidth>=380+W}
  function layout(){if(isSide()){if(wrap)wrap.style.cssText=wrapCss+';position:fixed;left:0;top:0;bottom:0;width:calc(100% - '+W+'px);transform:translateZ(0);overflow:hidden';sheet.style.cssText=SIDE;btn.style.display='none'}
    else{if(wrap)wrap.style.cssText=wrapCss;sheet.style.cssText=SHEET;btn.style.display=''}}
  if(!isSide())try{window.resizeTo(window.outerWidth+W,window.outerHeight)}catch(e){}
  setTimeout(function(){layout();if(isSide())open()},400);
  window.addEventListener('resize',function(){var was=sheet.style.cssText===SIDE;layout();if(isSide()&&!was)open()});
  var tm;if(wrap)new MutationObserver(function(){clearTimeout(tm);tm=setTimeout(function(){if(isSide())open(true)},3000)}).observe(wrap,{childList:true,subtree:true});
  async function loadFavs(){var all=[],p,j;for(p=0;p<5;p++){j=await (await fetch(api+'/chat_favorite_answers?page='+p+'&limit=20',{credentials:'include'})).json();all=all.concat(j.items||[]);if(!j.has_next)break}
    var seen={},out=all.filter(function(a){if(seen[a.id])return false;return seen[a.id]=1}).map(function(a){return {name:a.name,text:a.description}});if(out.length)csPost(C,F,{action:'favs-save',favs:out});return out}
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
  function insert(text,key,rank,shown){var ta=document.querySelector('#chatWrite');if(!ta)return alert('입력칸을 못 찾았어요');setInput(ta,text);if(!isSide())sheet.style.display='none';
    csPost(C,F,{action:'pick',chat:chat,pick:key,rank:rank,top:shown.slice(0,5)})}
  async function open(auto){
    if(!auto){sheet.innerHTML='';sheet.appendChild(el('div','color:#5E6472','대화 읽는 중…'))}
    try{
      if(!favs)favs=await loadFavs();
      var t=await talk(),q=findQ(t.all);
      if(auto&&t.text+'|'+q===lastKey)return;lastKey=t.text+'|'+q;
      var lk=q?(looked[q]||(looked[q]=await lookupOrder(C,F,q,/^01/.test(q)?q:''))):{note:'대화에 전화번호·주문번호가 없어 주문은 못 찾았어요'};
      if(!lk.order&&q)delete looked[q];
      sheet.innerHTML='';
      var head=el('div','display:flex;align-items:center;margin-bottom:4px');head.appendChild(el('b','flex:1;font-size:14px','추천 답변'));
      var rf=el('button','border:0;background:none;font-size:14px;cursor:pointer;color:#5E6472','↻');rf.title='다시 계산';rf.onclick=function(){open()};head.appendChild(rf);
      if(!isSide()){var x=el('button','border:0;background:none;font-size:16px;cursor:pointer','✕');x.onclick=function(){sheet.style.display='none'};head.appendChild(x)}
      sheet.appendChild(head);sheet.appendChild(el('div','color:#9AA0AD;font-size:11px;margin-bottom:6px','넣기를 누르면 입력칸에 들어가기만 해요. 고쳐서 직접 보내세요.'));
      var simq=t.text.replace(/\s/g,'').length<12?(t.ctx+' '+t.text):t.text,sim=await csPost(C,F,{action:'similar',text:simq,n:3});
      renderAnswers(sheet,{lk:lk,text:t.text,ctx:t.ctx,favs:favs,similar:(sim&&sim.items)||[],insert:insert});
    }catch(e){sheet.innerHTML='';sheet.appendChild(el('div','color:#CC3F38','추천을 못 만들었어요: '+e.message))}
  }
}

/* 네이버페이센터 고객문의 패널 — 직원이 문의를 펼쳐 답변칸(textarea#answer-box-<문의번호>-<주문번호>-<상품주문번호>)이 생기면 그 위에 추천 칸을 끼움.
   문의 글: 펼친 칸의 [class*=inquiry-text], 유형·제목: 바로 윗줄(tr). 주문: 답변칸 id의 네이버 주문번호 → 서버 search(카페24 market_order_no).
   넣기 = 답변칸에 글만 넣음 ('답변 등록하기'는 안 누름, 1000자 제한 경고). 구조는 2026-10-01 diag 보고 기준 — 네이버가 화면을 바꾸면 여기 선택자를 고칠 것. */
function naverPanel(C,F){
  if(window.__csNPanel)return;window.__csNPanel=1;
  var favs=null;async function getFavs(){if(!favs){var r=await csPost(C,F,{action:'favs'});favs=(r&&r.favs)||[]}return favs}
  function attach(ta){if(ta.dataset.csPanel)return;ta.dataset.csPanel='1';
    var m=ta.id.match(/^answer-box-(\d+)-(\d+)-(\d+)/),ab=ta.closest('[class*="answer-box"]')||ta.parentElement,detail=ta.closest('[class*="detail"]')||ab.parentElement;
    var q=detail.querySelector('[class*="inquiry-text"]'),text=q?q.innerText.trim():'',tr=ta.closest('tr'),prev=tr&&tr.previousElementSibling;
    var head=prev?[].slice.call(prev.children,1,3).map(function(td){return td.innerText.replace('문의내역 펼치기','').trim()}).join(' '):'';
    var box=el('div','margin:10px 0;padding:10px 12px;background:#F3F4F7;border:1px solid #DFE2E9;border-radius:12px;font:13px/1.5 sans-serif;color:#15171C');ab.parentElement.insertBefore(box,ab);
    box.appendChild(el('div','color:#5E6472','추천 답변 만드는 중…'));
    (async function(){try{
      var fv=await getFavs(),lk=m?await lookupOrder(C,F,m[2],''):{note:'주문번호를 못 읽었어요'};
      box.innerHTML='';var h=el('div','display:flex;align-items:center;margin-bottom:2px');h.appendChild(el('b','flex:1;font-size:14px','💬 추천 답변'));box.appendChild(h);
      box.appendChild(el('div','color:#9AA0AD;font-size:11px;margin-bottom:4px','넣기를 누르면 아래 답변칸에 들어가기만 해요. 고친 뒤 [답변 등록하기]는 직접 누르세요.'));
      var sim=await csPost(C,F,{action:'similar',text:text||head,n:3});
      renderAnswers(box,{lk:lk,text:head+' '+text,ctx:'',favs:fv,similar:(sim&&sim.items)||[],insert:function(t,key,rank,shown){setInput(ta,t);if(ta.value.length>1000)alert('네이버 답변은 1000자까지예요 — 지금 '+ta.value.length+'자');
        csPost(C,F,{action:'pick',chat:'naver-'+(m?m[1]:''),pick:key,rank:rank,top:shown.slice(0,5)})}});
    }catch(e){box.innerHTML='';box.appendChild(el('div','color:#CC3F38','추천을 못 만들었어요: '+e.message))}})()}
  var scan=function(){document.querySelectorAll('textarea[id^="answer-box-"]').forEach(attach)};scan();
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
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
    if(!kakao){var cd=code();if(cd){naverDiag(cd,F);naverPanel(cd,F)}}
    if(ls(ON)==null)ls(ON,confirm('CS 상황판: 이 PC에서 상황판 숫자·처리 기록을 자동으로 모을까요?\n(수집은 한 PC만 켜면 충분해요. 상담원 PC는 "취소" — 답변 패널은 그대로 써요)')?'1':'0');
    if(ls(ON)!=='1')return;var c2=code();if(c2)tracker(c2,F);
  },3000);
})();
