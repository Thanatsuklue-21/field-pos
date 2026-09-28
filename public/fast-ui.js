// A small, direct queue for a single shop. Returned orders remain in the ledger.
(() => {
  const style=document.createElement('style');
  style.textContent='.simple-queue-item{border:1px solid #d8dfd4;border-radius:12px;padding:12px;margin:9px 0;background:#fff}.simple-queue-item.selected{border:2px solid #378557;background:#eaf7ec}.simple-queue-item b{display:block;margin-bottom:4px}.simple-queue-item button{margin-top:8px;min-height:44px}.simple-queue-returned{text-decoration:line-through;opacity:.58}.simple-queue-actions{display:flex;gap:8px;flex-wrap:wrap}.simple-queue-actions button{flex:1;min-width:150px}';
  document.head.appendChild(style);
  document.querySelector('#v-queue .page-title p').textContent='เลือกเมนูที่กำลังทำ · ส่งให้ลูกค้า · ปิดคิว';
  document.querySelector('.queue-flow').innerHTML='<span>① รับออเดอร์</span><span>② เลือกทำ</span><span>③ ลูกค้ารับแล้ว</span>';
  document.querySelector('.prep-plan').hidden=true;
  document.querySelector('.section-heading').textContent='คิวที่กำลังทำ';
  function bell(){
    try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();
      [880,1175].forEach((freq,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+i*.17;
        o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(.16,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.7);
        o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+.72)});
      setTimeout(()=>ctx.close().catch(()=>{}),1400);
    }catch(e){console.warn('Bell unavailable',e)}
  }
  const payment=document.getElementById('confirmPaymentBtn'),originalPayment=payment.onclick;
  payment.onclick=function(event){const before=state.orders.length;originalPayment.call(this,event);if(state.orders.length>before)bell()};
  document.getElementById('pagerHandedBtn').onclick=()=>{hideModal('pagerModal');showView('queue')};
  renderQueue=function(){
    const active=activeQueue(),pool=document.getElementById('pagerPool'),max=Number(state.settings.pagerCount)||10;
    pool.innerHTML=Array.from({length:max},(_,i)=>{const o=active.find(x=>x.pagerNo===i+1);return `<div class="pager ${o?'busy':''}" title="${o?'คิว '+esc(queueLabel(o)):'ว่าง'}">${i+1}</div>`}).join('');
    document.getElementById('stagingGrid').innerHTML=active.slice(0,6).map(o=>`<div class="staging-slot"><b>${esc(queueLabel(o))}</b><small>${o.items?.some(x=>x.prepSelected)?'🟢 กำลังทำ':'รอทำ'}</small></div>`).join('');
    const list=document.getElementById('queueList');list.innerHTML='';
    for(const o of active){
      const card=document.createElement('div');card.className='kcard';card.dataset.orderId=o.id;
      const items=o.items||[];
      card.innerHTML=`<div class="no">คิว ${esc(queueLabel(o))}</div><div class="muted mono">บัตร ${esc(o.pagerNo)} · ${esc(o.billNo||'')}</div>`+
        items.map((x,i)=>`<div class="simple-queue-item ${x.prepSelected?'selected':''}"><b>${x.prepSelected?'🟢 กำลังทำ · ':''}${esc(x.name)} ×${Number(x.qty)||0}</b><span class="queue-formula">${esc(queueFormulaLabel(x))}</span><div><button type="button" class="btn ${x.prepSelected?'green':'ghost'} sm" data-select="${i}" aria-pressed="${!!x.prepSelected}">${x.prepSelected?'✓ กำลังทำเมนูนี้':'เลือกทำเมนูนี้'}</button></div></div>`).join('')+
        '<div class="simple-queue-actions"><button type="button" class="btn green" data-delivered>✓ เสร็จแล้ว · ลูกค้ารับแล้ว</button></div>';
      card.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>{
        if(!requireView('queue'))return;
        const index=Number(b.dataset.select),was=!!items[index].prepSelected;
        state.orders.forEach(order=>(order.items||[]).forEach(item=>{item.prepSelected=false}));
        items[index].prepSelected=!was;o.status='making';saveState();renderQueue();
      });
      card.querySelector('[data-delivered]').onclick=()=>{
        if(!requireView('queue'))return;
        items.forEach(x=>{x.readyQty=Number(x.qty)||0;x.qcQty=x.readyQty;x.calledQty=x.readyQty;x.prepSelected=false});
        o.status='returned';o.deliveredAt=Date.now();saveState();renderQueue();
      };
      list.appendChild(card);
    }
    if(!active.length)list.innerHTML='<div class="empty">ไม่มีคิวค้าง</div>';
    const completed=state.orders.filter(o=>o.status==='returned').slice(-3).reverse();
    if(completed.length)list.insertAdjacentHTML('beforeend','<details><summary>คิวที่ลูกค้ารับแล้ว</summary>'+completed.map(o=>`<div class="simple-queue-returned">✓ คิว ${esc(queueLabel(o))} · ${o.items.map(x=>esc(x.name)+' ×'+(Number(x.qty)||0)).join(' · ')}</div>`).join('')+'</details>');
    const old=active.filter(o=>Date.now()-Number(o.time||Date.now())>=10*60*1000);
    document.getElementById('queueAlert').textContent=old.length?'⏱ คิวค้างเกิน 10 นาที '+old.map(queueLabel).join(', '):'';
    updateQueueBadge();
  };
  renderQueue();
})();
