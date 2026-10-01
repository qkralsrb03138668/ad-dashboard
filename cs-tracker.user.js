// ==UserScript==
// @name         CS 상황판 자동 실행 (다나로브)
// @namespace    danarobe-cs
// @version      1
// @description  카카오 채널 채팅·네이버페이 고객문의관리 화면이 열리면 CS 상황판 숫자와 처리 기록을 자동으로 모음 (북마크 대신)
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

/* Tampermonkey 자동 실행 — 북마크로 eval될 때는 GM_info가 없어서 건너뜀.
   PC마다 처음 한 번: 이 PC에서 수집할지 + 초대코드 (사이트별 localStorage). 카카오는 채널 채팅 화면이 될 때까지 기다림(화면 이동이 새로고침 없이 일어나서). */
if(typeof GM_info!=='undefined')(function(){
  var F='https://pydxcqfztjogmztvayux.supabase.co/functions/v1/cs-lookup',K='cs_board_code',ON='cs_board_on';
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
  function ready(){return /kakao/.test(location.hostname)?/\/channel\/_[A-Za-z0-9]+\/chats/.test(location.pathname):/조회하기/.test(document.body.innerText)}
  var t=setInterval(function(){
    if(!ready())return;clearInterval(t);
    if(ls(ON)==null)ls(ON,confirm('CS 상황판: 이 PC에서 상황판 숫자·처리 기록을 자동으로 모을까요?\n(한 PC만 켜도 충분해요. 나중에 바꾸려면 상황판 안내 참고)')?'1':'0');
    if(ls(ON)!=='1')return;
    var c=ls(K)||prompt('CS 상황판 초대코드를 입력하세요 (처음 한 번만)');
    if(!c)return;ls(K,c.trim());tracker(c.trim(),F);
  },3000);
})();
