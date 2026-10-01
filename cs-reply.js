// CS 답변 문구 + 배송지연 게시판·셀메이트 매칭 — cs-lookup.html(CS 주문조회)과 cs-tracker.user.js(카카오·네이버 답변 패널, @require)가 같이 씀.
// 답변 말투·문구를 바꾸면 여기만 고치면 됨 (Tampermonkey 쪽은 user.js @version을 올려야 새로 받음). 점검: node test/cs-reply.test.mjs
var CSR = (function () {
// 카페24 품목 상태 코드 → 우리말 (카페24 관리자 표기 기준)
const ST={N00:'입금전',N10:'상품준비중',N20:'배송준비중',N21:'배송대기',N22:'배송보류',N30:'배송중',N40:'배송완료',N50:'구매확정',
  C00:'취소신청',C10:'취소접수',C34:'취소처리중',C40:'취소완료',C47:'취소완료',C48:'취소완료(환불완료)',R00:'반품신청',R10:'반품접수',R30:'반품처리중(수거전)',R34:'반품처리중(환불전)',R40:'반품완료',
  E00:'교환신청',E10:'교환접수',E30:'교환처리중',E40:'교환완료',E41:'교환완료(재배송)'};
const stText=s=>ST[s]||({N:'처리중',C:'취소',R:'반품',E:'교환'}[s[0]]||'')+' ('+s+')';   // 모르는 코드도 원문 코드 대신 그룹명으로
// ── 답변 문구 — CS 답변 지침(Desktop/클ㄹ드/CS-답변지침.md, 저장소 밖) 말투: "안녕하세요 고객님 :)" → 공감·상황 확인 → 사실(날짜는 게시판 그대로) → 마무리 ♥️. 3~6문장, 이모지 1~3개, 정책·날짜 창작 금지 ──
const 은는=w=>{ const m=w.match(/[가-힣](?=[^가-힣]*$)/); if(!m) return '은(는)'; const c=m[0].charCodeAt(0); return (c-0xAC00)%28?'은':'는'; };   // 마지막 한글 글자 받침으로 (뒤에 괄호·영문이 붙어도)
const clean=n=>n.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();   // (made)·(2 colors) 같은 꼬리표는 답변에서 뺀다
const nm=g=>{ const names=[...new Set(g.map(i=>clean(i.product_name)))]; const opt=g.length===1&&g[0].option?` (${g[0].option.split(',').map(x=>x.split('=').pop().trim()).join(', ')})`:''; return names.join(', ')+opt; };
const when=line=>{ const seg=line.split(' · ').pop().trim(); return (seg.replace(/\s*출고$/,'')||seg)+' 출고 예정'; };   // "9/28 출고"→"9/28 출고 예정", "다음주 중"→"다음주 중 출고 예정"
const R={   // g = 같은 상태(·같은 지연 줄)인 품목 묶음, a = 지연 글 매칭({line})
  pre:g=>`문의주신 ${nm(g)}${은는(nm(g))} 아직 입금 확인 전으로 확인됩니다 😊\n입금 확인되는 대로 바로 상품 준비 시작할게요.`,
  prep:g=>`문의주신 ${nm(g)}${은는(nm(g))} 현재 출고 준비 중으로 확인됩니다 😊\n출고 후에는 보통 1~2일 정도 소요되지만 택배사 사정에 따라 조금 달라질 수 있는 점 참고 부탁드릴게요.`,
  delay:(g,a)=>`문의주신 ${nm(g)}${은는(nm(g))} 현재 입고가 지연되어 ${when(a.line)}으로 확인됩니다.\n입고되는 대로 최대한 빠르게 준비하여 보내드릴 수 있도록 하겠습니다 🙏`,
  delayNoDate:(g,sm)=>`문의주신 ${nm(g)}${은는(nm(g))} 현재 입고가 지연되어 출고가 늦어지고 있어요.${sm&&sm.in_date?`\n${sm.in_date} 입고 예정으로 확인되며, 입고되는 대로 최대한 빠르게 보내드릴 수 있도록 하겠습니다 🙏`:`\n입고 일정이 확인되는 대로 다시 안내드리고, 입고되는 대로 최대한 빠르게 보내드릴 수 있도록 하겠습니다 🙏`}`,
  hold:g=>`문의주신 ${nm(g)}${은는(nm(g))} 현재 배송 보류 상태로 확인됩니다 ㅠㅠ\n확인 후 다시 안내드릴게요.`,
  ship:g=>`문의주신 ${nm(g)}${은는(nm(g))} ${g[0].carrier||'택배'}로 발송 완료되었습니다 😊\n송장번호는 ${g[0].tracking}이며, 보통 발송 후 1~2일 정도 소요되지만 택배사 사정에 따라 조금 달라질 수 있는 점 참고 부탁드릴게요.`,
  done:g=>`문의주신 ${nm(g)}${은는(nm(g))} 배송완료로 확인됩니다 😊\n혹시 상품이 보이지 않으시면 번거로우시겠지만 배송기사님께 한 번 연락해보시는 게 좋을 것 같아요. 연락하실 때 주소와 송장번호${g[0].tracking?`(${g[0].tracking})`:''}를 함께 말씀해주시면 정확한 배송 위치를 안내받으실 수 있습니다.`,
  cancelIng:g=>`문의주신 주문건은 현재 취소 처리 진행 중으로 확인됩니다 😊\n처리 완료되면 다시 안내드릴게요.`,
  cancelDone:g=>`문의주신 주문건은 취소처리 완료된 것으로 확인됩니다 😊\n확인 부탁드릴게요.`,
  retIng:g=>`문의주신 반품건은 정상적으로 접수되었습니다 😊\n기사님께서 연락 후 방문 수거 예정이니 상품 전달 부탁드릴게요 🙏`,
  retRefund:g=>`문의주신 반품건은 상품 수거 확인되어 현재 환불 처리 진행 중으로 확인됩니다 😊\n처리 완료되면 다시 안내드릴게요.`,
  retDone:g=>`문의주신 반품건은 반품 처리 완료된 것으로 확인됩니다 😊\n확인 부탁드릴게요.`,
  exIng:g=>`문의주신 교환건은 정상적으로 접수되었습니다 😊\n기사님께서 연락 후 방문 수거 예정이니 상품 전달 부탁드릴게요 🙏`,
  exDone:g=>`문의주신 교환건은 교환 처리 완료되어 재발송된 것으로 확인됩니다 😊\n확인 부탁드릴게요.`,
  etc:g=>`문의주신 ${nm(g)}${은는(nm(g))} 현재 ${stText(g[0].status)} 상태로 확인됩니다 😊\n처리 완료되면 다시 안내드릴게요.`,
};
function bodyFor(g,a,sm){ const s=g[0].status;
  if(s==='N00') return R.pre(g);
  if(['N10','N20','N21'].includes(s)){
    if(sm&&sm.possible===1) return R.prep(g);                 // 셀메이트: 출고 가능 → 곧 나감
    if(sm&&sm.possible===0) return a?R.delay(g,a):R.delayNoDate(g,sm);   // 셀메이트: 출고 불가 → 게시판 날짜, 없으면 날짜 없이
    return a?R.delay(g,a):R.prep(g); }                         // 셀메이트 미연결 → 게시판만
  if(s==='N22') return R.hold(g);
  if(s==='N30') return R.ship(g);
  if(s==='N40'||s==='N50') return R.done(g);
  if(['C40','C47','C48'].includes(s)) return R.cancelDone(g); if(s[0]==='C') return R.cancelIng(g);
  if(s==='R40') return R.retDone(g); if(s==='R34') return R.retRefund(g); if(s[0]==='R') return R.retIng(g);
  if(s==='E40'||s==='E41') return R.exDone(g); if(s[0]==='E') return R.exIng(g);
  return R.etc(g); }
// 주문 하나 → 답변 하나. 묶음(상태·지연줄이 같은 품목)이 하나면 한 단락, 여러 개면 묶음마다 한 줄 요약 + 안내 문장은 한 번씩만 (2026-10-01 "단락을 이어붙여 너무 길다")
const LINE={   // 여러 묶음일 때 한 줄: "· 상품명 → 상태"
  pre:()=>'입금 확인 전', prep:()=>'출고 준비 중', delay:(g,a)=>when(a.line), hold:()=>'배송 보류 (확인 후 안내)',
  delayNoDate:(g,sm)=>sm&&sm.in_date?`${sm.in_date} 입고 예정 (입고되는 대로 출고)`:'입고 지연 (일정 확인되는 대로 안내)',
  ship:g=>`${g[0].carrier||'택배'} 발송 완료${g[0].tracking?` (송장 ${g[0].tracking})`:''}`, done:()=>'배송 완료',
  cancelIng:()=>'취소 처리 중', cancelDone:()=>'취소 완료', retIng:()=>'반품 접수 완료', retRefund:()=>'반품 수거 확인, 환불 진행 중', retDone:()=>'반품 완료',
  exIng:()=>'교환 접수 완료', exDone:()=>'교환 재발송 완료', etc:g=>stText(g[0].status),
};
function kindOf(g,a,sm){ const s=g[0].status;   // bodyFor와 같은 판단, 이름만 돌려줌
  if(s==='N00') return 'pre';
  if(['N10','N20','N21'].includes(s)){ if(sm&&sm.possible===1) return 'prep'; if(sm&&sm.possible===0) return a?'delay':'delayNoDate'; return a?'delay':'prep'; }
  if(s==='N22') return 'hold'; if(s==='N30') return 'ship'; if(s==='N40'||s==='N50') return 'done';
  if(['C40','C47','C48'].includes(s)) return 'cancelDone'; if(s[0]==='C') return 'cancelIng';
  if(s==='R40') return 'retDone'; if(s==='R34') return 'retRefund'; if(s[0]==='R') return 'retIng';
  if(s==='E40'||s==='E41') return 'exDone'; if(s[0]==='E') return 'exIng';
  return 'etc'; }
const NOTE=[   // 여러 묶음일 때 끝에 한 번씩
  [k=>k.has('prep')||k.has('ship'),'출고 후에는 보통 1~2일 정도 소요되며, 택배사 사정에 따라 조금 달라질 수 있어요.'],
  [k=>k.has('delay')||k.has('delayNoDate'),'지연 상품은 입고되는 대로 최대한 빠르게 보내드릴게요 🙏'],
  [k=>k.has('done'),'배송완료인데 상품이 보이지 않으시면 송장번호로 배송기사님께 위치 확인 부탁드릴게요.'],
  [k=>k.has('retIng')||k.has('exIng'),'기사님께서 연락 후 방문 수거 예정이니 상품 전달 부탁드릴게요 🙏'],
  [k=>['pre','hold','cancelIng','retRefund','etc'].some(x=>k.has(x)),'처리 완료되면 다시 안내드릴게요.'],
];
function replyFor(o,items){
  const groups=new Map();
  for(const {i,art,sm} of items){ const k=i.status+'|'+(art?art.line:'')+'|'+(sm?sm.possible+':'+sm.in_date:''); if(!groups.has(k)) groups.set(k,{g:[],art,sm}); groups.get(k).g.push(i); }
  const gs=[...groups.values()].map(gr=>({...gr,kind:kindOf(gr.g,gr.art,gr.sm)}));
  const late=gs.some(x=>x.kind==='delay'||x.kind==='delayNoDate'), waiting=late||gs.some(x=>x.kind==='hold');
  const sorry=late?'기다리고 계셨을 텐데 배송이 늦어져 정말 죄송합니다 ㅠㅠ\n':'';
  let body;
  if(gs.length<=1) body=gs.length?sorry+bodyFor(gs[0].g,gs[0].art,gs[0].sm):'';
  else { const ks=new Set(gs.map(x=>x.kind));
    body=sorry+'문의주신 상품 확인해드렸어요 😊\n'+gs.map(x=>`· ${nm(x.g)} → ${LINE[x.kind](x.g,x.kind==='delay'?x.art:x.sm)}`).join('\n')
      +'\n\n'+NOTE.filter(([f])=>f(ks)).map(([,t])=>t).join('\n'); }
  return ['안녕하세요 고객님 :)',body,waiting?'조금만 양해 부탁드릴게요 고객님 ♥️':'감사합니다 고객님 ♥️'].filter(Boolean).join('\n\n');
}

// 배송지연 글 매칭: 글의 상품번호가 같거나, 글 제목·본문에 상품명이 있거나, 상품명 안에 글 제목이 있으면
const norm=s=>String(s||'').toLowerCase().replace(/\s+/g,'');
function delayFor(item,delays){
  const arts=(delays&&delays.articles)||[]; const pn=norm(item.product_name);
  // 상품명에서 괄호 꼬리표((made)·(2 colors) 등)를 뺀 핵심 이름으로도 찾는다 — 글에는 보통 짧게 적으므로
  const core=norm(item.product_name.replace(/\([^)]*\)/g,' ').trim());
  // 옵션값(컬러=베이지, 사이즈=L → 베이지, L) — 같은 상품이 여러 줄이면 옵션이 맞는 줄을 고른다
  const opts=String(item.option||'').split(',').map(x=>norm(x.split('=').pop())).filter(x=>x.length>=1);
  for(const a of arts){
    const lines=String(a.text||'').split('\n');
    const byNo=a.product_no&&String(a.product_no)===String(item.product_no);
    const k=[pn,core].find(k=>k.length>=4&&(norm(a.title).includes(k)||lines.some(l=>norm(l).includes(k))));
    if(byNo||k||(norm(a.title).length>=4&&pn.includes(norm(a.title)))){
      const cand=k?lines.filter(l=>norm(l).includes(k)):[];
      if(k&&cand.length&&opts.length&&!cand.some(l=>opts.every(o=>norm(l).includes(o)))) continue;   // 이 상품은 있지만 이 옵션은 지연 아님
      const line=(cand.find(l=>opts.every(o=>norm(l).includes(o)))||cand[0]||'').replace(/\s*\|\s*/g,' · ').trim();
      return {title:a.title,text:a.text,line};
    }
  }
  return null;
}
// 셀메이트 품목 찾기: 같은 주문번호 + 같은 옵션(공백 무시). 옵션이 없으면 상품명으로.
const smFor=(o,i,list)=>{ list=list||[]; const on=norm(i.option), pn=norm(i.product_name);
  return list.find(x=>x.order_id===o.order_id&&(on?norm(x.opt)===on&&norm(x.name)===pn:norm(x.name)===pn))||null; };
const itemsOf=(o,delays,smItems)=>o.items.map(i=>({i,art:delayFor(i,delays),sm:smFor(o,i,smItems)}));
// 패널용: 주문 → {order_id, date, items(상태·지연 줄·셀메이트), reply}. pick = 답변에 넣을 품목 순번 (없으면 전부)
function summary(o,delays,smItems,pick){ const its=itemsOf(o,delays,smItems), sel=pick?its.filter((x,k)=>pick.includes(k)):its;
  return {order_id:o.order_id,date:String(o.order_date).slice(0,10),items:its.map(({i,art,sm})=>({name:clean(i.product_name),opt:i.option,status:i.status,status_text:i.status_text||stText(i.status),delay:art?art.line:'',sm:sm?{possible:sm.possible,stock:sm.stock,in_date:sm.in_date}:null})),reply:replyFor(o,sel)}; }
return {ST,stText,clean,norm,delayFor,smFor,itemsOf,replyFor,summary};
})();
if (typeof module !== 'undefined') module.exports = CSR;
