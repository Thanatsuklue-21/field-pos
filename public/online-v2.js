// FIELD POS Online v2 — server-first Turso snapshot sync.
// Uses current backend routes only: /api/auth/login, /api/auth/session, /api/state, /api/import/commit.
(() => {
  'use strict';

  const el = id => document.getElementById(id);
  const originalSaveState = saveState;
  const originalLockApp = lockApp;
  const originalRefreshAccessUi = refreshAccessUi;

  let csrf = '';
  let revision = null;
  let serverUser = null;
  let onlineReady = false;
  let syncPending = false;
  let syncing = false;
  let syncTimer = null;
  let retryTimer = null;
  let retryDelay = 3000;
  let editVersion = 0;

  const gate = document.createElement('div');
  gate.id = 'fieldOnlineGateV2';
  gate.innerHTML = `
    <div class="field-online-card">
      <div class="field-online-brand">🌿 FIELD · ONLINE</div>
      <h2 id="fieldOnlineTitle">กำลังเชื่อมข้อมูลร้าน</h2>
      <p id="fieldOnlineMessage">ตรวจสอบบัญชีและ Turso</p>
      <form id="fieldOnlineForm" hidden>
        <label>ชื่อผู้ใช้
          <input id="fieldOnlineUsername" autocomplete="username" value="admin" required>
        </label>
        <label>รหัสผ่าน
          <input id="fieldOnlinePassword" type="password" autocomplete="current-password" required>
        </label>
        <button class="btn green" id="fieldOnlineSubmit" type="submit">เข้าสู่ระบบออนไลน์</button>
      </form>
      <div id="fieldOnlineChoices" hidden></div>
      <button class="btn ghost" id="fieldOnlineBackup" type="button" hidden>ดาวน์โหลด Backup เครื่องนี้</button>
      <button class="btn ghost" id="fieldOnlineRetry" type="button" hidden>ลองใหม่</button>
    </div>`;
  const css = document.createElement('style');
  css.textContent = `
    #fieldOnlineGateV2{position:fixed;inset:0;z-index:100001;background:#17382c;display:grid;place-items:center;padding:16px}
    #fieldOnlineGateV2[hidden]{display:none}
    #fieldOnlineGateV2 .field-online-card{width:min(460px,100%);max-height:94vh;overflow:auto;background:#f8f4e9;color:#211e19;border-radius:20px;padding:24px;box-shadow:0 18px 60px #0005}
    #fieldOnlineGateV2 .field-online-brand{font-weight:900;color:#527b3b;letter-spacing:.06em}
    #fieldOnlineGateV2 h2{margin:10px 0 6px}
    #fieldOnlineGateV2 p{line-height:1.5;color:#6c6257}
    #fieldOnlineGateV2 label{display:block;margin:10px 0;font-size:.84rem;font-weight:800}
    #fieldOnlineGateV2 input{display:block;width:100%;margin-top:5px;padding:12px;border:1px solid #c8c5b9;border-radius:9px}
    #fieldOnlineGateV2 button{width:100%;margin:9px 0;padding:11px}
    #fieldOnlineSyncV2{position:fixed;right:12px;bottom:12px;z-index:9999;background:#e8f1e6;color:#225037;border-radius:12px;padding:7px 12px;font:700 12px system-ui;box-shadow:0 2px 12px #0002}
    #fieldOnlineSyncV2.warn{background:#f7e9c7;color:#765b21}
    #fieldOnlineSyncV2.bad{background:#f5ded8;color:#8f392f}`;
  document.head.appendChild(css);
  document.body.appendChild(gate);

  const status = document.createElement('div');
  status.id = 'fieldOnlineSyncV2';
  status.hidden = true;
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  document.body.appendChild(status);

  function syncStatus(message, tone='') {
    status.textContent = message || '';
    status.className = tone;
    status.hidden = !message;
  }
  function show() { gate.hidden = false; }
  function hide() { gate.hidden = true; }
  function message(title, detail) {
    el('fieldOnlineTitle').textContent = title;
    el('fieldOnlineMessage').textContent = detail;
  }
  function setLoginForm(detail='ใช้บัญชี Admin ออนไลน์ที่อยู่ใน Turso') {
    show();
    el('fieldOnlineForm').hidden = false;
    el('fieldOnlineChoices').hidden = true;
    el('fieldOnlineRetry').hidden = true;
    message('เข้าสู่ระบบ FIELD Online', detail);
    el('fieldOnlinePassword').value = '';
    setTimeout(()=>el('fieldOnlineUsername').focus({preventScroll:true}),0);
  }
  async function request(path, options={}) {
    const response = await fetch('/api/'+path, {
      credentials:'same-origin',
      cache:'no-store',
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(options.body ? {'X-CSRF-Token':csrf} : {}),
        ...(options.headers||{})
      }
    });
    const data = await response.json().catch(()=>({error:'invalid_server_response'}));
    if (!response.ok) {
      const err = new Error(data.error || 'server_error');
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  function counts(s) {
    return `${(s?.sales||[]).length} บิล · ${(s?.orders||[]).length} คิว · ${(s?.expenses||[]).length} ค่าใช้จ่าย`;
  }
  const CLEAN_REVISION_KEY = 'field_pos_online_clean_revision_v1';
  function localHasData(s) {
    return !!((s?.sales||[]).length || (s?.orders||[]).length || (s?.expenses||[]).length || (s?.customers||[]).length);
  }
  function stableSnapshot(value) {
    if (Array.isArray(value)) return '['+value.map(stableSnapshot).join(',')+']';
    if (value && typeof value === 'object') {
      return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableSnapshot(value[k])).join(',')+'}';
    }
    return JSON.stringify(value);
  }
  function snapshotsEqual(a,b) {
    try {
      return stableSnapshot(normalizeState(deepClone(a))) === stableSnapshot(normalizeState(deepClone(b)));
    } catch (e) {
      console.warn('FIELD snapshot compare failed',e);
      return false;
    }
  }
  function cleanRevision() {
    return Number(localStorage.getItem(CLEAN_REVISION_KEY) || 0);
  }
  function markCleanRevision(rev) {
    localStorage.setItem(CLEAN_REVISION_KEY, String(Number(rev)||0));
  }
  function markLocalDirty() {
    localStorage.removeItem(CLEAN_REVISION_KEY);
  }
  function syncFingerprint(source=state) {
    const copy=deepClone(source||{});
    copy.cart=[]; // cart is intentionally device-local until checkout transaction
    return stableSnapshot(copy);
  }
  let lastServerFingerprint='';
  function backupLocal() {
    const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'FIELD_POS_before_online_'+new Date().toISOString().slice(0,10)+'.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  el('fieldOnlineBackup').onclick = backupLocal;

  async function persistAdoptedState() {
    localStorage.setItem(APP_KEY, JSON.stringify(state));
    if (typeof persistDatabase === 'function') {
      try { await persistDatabase(); } catch (e) { console.warn('FIELD local mirror failed',e); }
    }
  }

  function serverAuthIntoUi() {
    authData = {
      version:2,
      users:[{
        id:serverUser.id,
        username:serverUser.username,
        role:serverUser.role,
        views:serverUser.permissions||{},
        active:true
      }],
      recovery:null
    };
    unlockApp(authData.users[0]);
    if (el('accessSettings')) el('accessSettings').hidden = true;
  }

  function installOnlinePasswordCard() {
    if (!serverUser || serverUser.role !== 'admin' || el('fieldOnlinePasswordAdminCard')) return;
    const settings = el('v-settings');
    if (!settings) return;
    const card = document.createElement('div');
    card.id = 'fieldOnlinePasswordAdminCard';
    card.className = 'card';
    card.innerHTML = `
      <h3>🔐 รหัสผ่าน FIELD Online</h3>
      <p class="muted">ใช้บัญชีออนไลน์เดียวกันเพื่อเข้า POS จากทุกเครื่อง การเปลี่ยนรหัสจะออกจากระบบทุกอุปกรณ์เพื่อความปลอดภัย</p>
      <form id="fieldOnlinePasswordAdminForm">
        <div class="form-row two">
          <div><label>รหัสผ่านใหม่</label><input id="fieldOnlinePasswordNew" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div>
          <div><label>ยืนยันรหัสผ่านใหม่</label><input id="fieldOnlinePasswordConfirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></div>
        </div>
        <button class="btn dark" id="fieldOnlinePasswordSave" type="submit">ตั้งรหัสผ่านออนไลน์ใหม่</button>
        <div id="fieldOnlinePasswordStatus" class="muted" style="margin-top:8px"></div>
      </form>`;
    const readiness = el('serverReadiness');
    if (readiness) readiness.insertAdjacentElement('afterend', card);
    else settings.appendChild(card);

    el('fieldOnlinePasswordAdminForm').onsubmit = async e => {
      e.preventDefault();
      const password = el('fieldOnlinePasswordNew').value;
      const confirm = el('fieldOnlinePasswordConfirm').value;
      const out = el('fieldOnlinePasswordStatus');
      if (password.length < 10 || password.length > 128 || !/\p{L}/u.test(password)) {
        out.textContent = 'รหัสผ่านต้องยาว 10–128 ตัว และมีตัวอักษรอย่างน้อย 1 ตัว';
        return;
      }
      if (password !== confirm) {
        out.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
        return;
      }
      const btn = el('fieldOnlinePasswordSave');
      btn.disabled = true;
      out.textContent = 'กำลังเปลี่ยนรหัสผ่านออนไลน์…';
      try {
        await request('admin/users/'+encodeURIComponent(serverUser.id), {
          method:'PATCH',
          body:JSON.stringify({password})
        });
        el('fieldOnlinePasswordNew').value = '';
        el('fieldOnlinePasswordConfirm').value = '';
        onlineReady = false;
        out.textContent = 'เปลี่ยนสำเร็จ · กรุณาเข้าสู่ระบบใหม่ด้วยรหัสนี้ทุกเครื่อง';
        setTimeout(()=>setLoginForm('เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่'),400);
      } catch (err) {
        out.textContent = err.status===400 ? 'รูปแบบรหัสผ่านไม่ถูกต้อง' : 'เปลี่ยนรหัสผ่านไม่สำเร็จ · '+(err.message||'server_error');
      } finally {
        btn.disabled = false;
      }
    };
  }

  async function adopt(remote) {
    const localCart = deepClone(state?.cart||[]);
    state = normalizeState(remote.state);
    // Cart is device-local work in progress and must never be overwritten by another register.
    state.cart = localCart;
    revision = Number(remote.revision);
    onlineReady = true;
    syncPending = false;
    retryDelay = 3000;
    await persistAdoptedState();
    markCleanRevision(revision);
    lastServerFingerprint=syncFingerprint(state);
    serverAuthIntoUi();
    installOnlinePasswordCard();

    renderCategories();
    renderMenuGrid();
    renderCart();
    renderQueue();
    updateQueueBadge();
    renderActionAlerts();
    if (typeof renderReport === 'function') renderReport();

    const readiness = el('serverReadiness');
    if (readiness) readiness.innerHTML = `
      <h3>🌐 FIELD Online</h3>
      <div class="summary-row"><span>ฐานข้อมูลหลัก</span><b>Turso · revision ${revision}</b></div>
      <div class="summary-row"><span>เครื่องนี้</span><b>Local mirror สำหรับความเร็ว</b></div>
      <p class="muted">ทุกการแก้ไขบันทึกในเครื่องก่อน แล้วซิงก์ snapshot ไป Turso พร้อม revision check เพื่อกันเขียนทับจากหลายเครื่อง</p>`;

    if (el('resetAllBtn')) {
      el('resetAllBtn').disabled = true;
      el('resetAllBtn').title = 'ปิดการรีเซ็ตข้อมูลขณะใช้ FIELD Online';
    }
    if (el('importFile')) {
      el('importFile').disabled = true;
      if (el('importFile').parentElement) el('importFile').parentElement.hidden = true;
    }

    syncStatus('ออนไลน์ · Turso revision '+revision);
    setTimeout(()=>{ if(!syncPending) syncStatus(''); },1800);
    hide();
  }

  async function commitInitial(local) {
    show();
    message('กำลังนำข้อมูลเครื่องนี้ขึ้น Turso','รอฐานข้อมูลยืนยัน snapshot ตั้งต้น');
    const body = JSON.stringify({state:local, expectedRevision:0});
    if (new Blob([body]).size > 3_500_000) throw new Error('ข้อมูลใหญ่เกิน 3.5 MB');
    const result = await request('import/commit',{method:'POST',body});
    await adopt({state:local,revision:result.revision});
  }

  async function establish(user) {
    serverUser = user;
    const remote = await request('state');
    const local = deepClone(state);

    if (Number(remote.revision) === 0) {
      show();
      el('fieldOnlineForm').hidden = true;
      el('fieldOnlineChoices').hidden = false;
      el('fieldOnlineBackup').hidden = false;

      if (localHasData(local)) {
        message('พบข้อมูลเดิมในเครื่อง',`เครื่องนี้มี ${counts(local)} · Turso ยังว่าง ให้ Backup ก่อนนำขึ้นออนไลน์`);
        el('fieldOnlineChoices').innerHTML = `
          <button class="btn green" id="fieldOnlineUseLocal" type="button">Backup แล้วนำข้อมูลเครื่องนี้ขึ้น Turso</button>
          <button class="btn ghost" id="fieldOnlineWait" type="button">ยังไม่เปิด Online</button>`;
        el('fieldOnlineUseLocal').onclick = async()=>{
          backupLocal();
          try { await commitInitial(local); } catch(e) { failure(e); }
        };
        el('fieldOnlineWait').onclick = ()=>message('ยังไม่ได้เปิด Online','ไม่มีการเขียนข้อมูลขึ้น Turso');
      } else {
        message('Turso ยังไม่มีข้อมูลร้าน','เครื่องนี้ก็ไม่มีประวัติ สามารถเริ่ม snapshot แรกได้');
        el('fieldOnlineChoices').innerHTML = `<button class="btn green" id="fieldOnlineStartEmpty" type="button">เริ่ม FIELD Online</button>`;
        el('fieldOnlineStartEmpty').onclick = async()=>{
          try { await commitInitial(local); } catch(e) { failure(e); }
        };
      }
      return;
    }

    if (cleanRevision() === Number(remote.revision) || snapshotsEqual(local, remote.state)) {
      await adopt(remote);
      return;
    }

    if (localHasData(local)) {
      show();
      el('fieldOnlineForm').hidden = true;
      el('fieldOnlineChoices').hidden = false;
      el('fieldOnlineBackup').hidden = false;
      message('พบข้อมูลออนไลน์แล้ว',`เครื่องนี้: ${counts(local)} · Turso: ${counts(remote.state)} ให้ Backup เครื่องนี้ก่อนใช้ข้อมูล Turso`);
      el('fieldOnlineChoices').innerHTML = `<button class="btn green" id="fieldOnlineAdoptRemote" type="button">Backup แล้วใช้ข้อมูล Turso</button>`;
      el('fieldOnlineAdoptRemote').onclick = async()=>{
        backupLocal();
        await adopt(remote);
      };
      return;
    }

    await adopt(remote);
  }

  async function flush() {
    if (!onlineReady || !syncPending || syncing) return;
    syncing = true;
    try {
      while (syncPending) {
        const version = editVersion;
        const document = deepClone(state);
        const body = JSON.stringify({state:document, expectedRevision:revision, replace:true});
        if (new Blob([body]).size > 3_500_000) throw new Error('ข้อมูลใหญ่เกิน 3.5 MB');
        const result = await request('import/commit',{method:'POST',body});
        revision = Number(result.revision);
        syncPending = editVersion !== version;
      }
      retryDelay = 3000;
      clearTimeout(retryTimer);
      markCleanRevision(revision);
      lastServerFingerprint=syncFingerprint(state);
      syncStatus('บันทึก Turso แล้ว · r'+revision);
      setTimeout(()=>{ if(!syncPending) syncStatus(''); },1500);
    } catch(e) {
      syncPending = true;
      if (e.status === 409) {
        syncStatus('ข้อมูลเปลี่ยนจากอีกเครื่อง · กำลังโหลดล่าสุด','warn');
        try {
          const remote=await request('state');
          await adopt(remote);
        } catch(refreshError) {
          syncStatus('โหลดข้อมูลล่าสุดไม่สำเร็จ · จะลองใหม่','warn');
          clearTimeout(retryTimer);
          retryTimer=setTimeout(flush,retryDelay);
        }
      } else if (e.status === 401) {
        syncStatus('เซสชันหมดอายุ · ข้อมูลยังอยู่ในเครื่อง','warn');
        setLoginForm('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      } else {
        syncStatus('เก็บในเครื่องแล้ว · รอซิงก์ Turso','warn');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush,retryDelay);
        retryDelay = Math.min(retryDelay*2,30000);
      }
    } finally {
      syncing = false;
    }
  }

  function failure(e) {
    show();
    el('fieldOnlineForm').hidden = true;
    el('fieldOnlineChoices').hidden = true;
    el('fieldOnlineBackup').hidden = false;
    el('fieldOnlineRetry').hidden = false;

    if (e.status === 409) message('หยุดเพื่อป้องกันข้อมูลหาย','Turso revision เปลี่ยนจากอีกเครื่อง กรุณา Backup ก่อนตรวจข้อมูลออนไลน์');
    else if (e.status === 401) message('ต้องเข้าสู่ระบบใหม่','ข้อมูลที่ยังไม่ซิงก์ยังอยู่ในเครื่องนี้');
    else message('เชื่อม FIELD Online ไม่สำเร็จ',e.message||'server_error');

    el('fieldOnlineRetry').onclick = ()=>boot();
  }

  saveState = function() {
    originalSaveState();
    if (onlineReady) {
      const currentFingerprint=syncFingerprint(state);
      if(currentFingerprint===lastServerFingerprint)return;
      markLocalDirty();
      syncPending = true;
      editVersion++;
      syncStatus('บันทึกในเครื่องแล้ว · กำลังซิงก์ Turso…','warn');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flush,120);
    }
  };

  window.FIELD_LOCAL_SAVE = function(){ originalSaveState(); };

  window.FIELD_ONLINE_POS = {
    isReady:()=>onlineReady,
    async checkout(payload) {
      if(!onlineReady) throw new Error('online_not_ready');
      if(syncPending && !syncing) flush().catch(()=>{});
      syncStatus('กำลังบันทึกออเดอร์…','warn');
      const result=await request('pos/checkout',{method:'POST',body:JSON.stringify(payload)});
      await adopt(result);
      return result;
    },
    async queueAction(payload) {
      if(!onlineReady) throw new Error('online_not_ready');
      if(syncPending && !syncing) flush().catch(()=>{});
      const result=await request('pos/queue',{method:'POST',body:JSON.stringify(payload)});
      await adopt(result);
      return result;
    },
    async refresh() {
      if(!onlineReady) return null;
      const remote=await request('state');
      await adopt(remote);
      return remote;
    },
    async promptPayConfig() {
      if(!onlineReady) return {configured:false};
      return request('payments/promptpay/config');
    },
    async promptPayCreate(amount,reference) {
      if(!onlineReady) throw new Error('online_not_ready');
      return request('payments/promptpay/create',{method:'POST',body:JSON.stringify({amount,reference})});
    },
    async promptPayStatus(chargeId) {
      if(!onlineReady) throw new Error('online_not_ready');
      return request('payments/promptpay/status',{method:'POST',body:JSON.stringify({chargeId})});
    },
    async splitStart(payload) {
      if(!onlineReady) throw new Error('online_not_ready');
      const result=await request('pos/split/start',{method:'POST',body:JSON.stringify(payload)});
      await adopt(result);
      return result;
    },
    async splitPay(payload) {
      if(!onlineReady) throw new Error('online_not_ready');
      const result=await request('pos/split/pay',{method:'POST',body:JSON.stringify(payload)});
      await adopt(result);
      return result;
    },
    async splitStatus(sessionId) {
      if(!onlineReady) throw new Error('online_not_ready');
      return request('pos/split/status',{method:'POST',body:JSON.stringify({sessionId})});
    },
    async splitList() {
      if(!onlineReady) throw new Error('online_not_ready');
      return request('pos/split/list');
    },
    async splitCancel(payload) {
      if(!onlineReady) throw new Error('online_not_ready');
      const result=await request('pos/split/cancel',{method:'POST',body:JSON.stringify(payload)});
      await adopt(result);
      return result;
    }
  };

  refreshAccessUi = function() {
    originalRefreshAccessUi();
    if (onlineReady && el('accessSettings')) el('accessSettings').hidden = true;
  };

  lockApp = function(messageText) {
    if (onlineReady) {
      authSession = null;
      document.body.classList.add('auth-locked');
      setLoginForm(messageText || 'กรุณาเข้าสู่ระบบออนไลน์');
      return;
    }
    originalLockApp(messageText);
  };

  el('fieldOnlineForm').onsubmit = async e=>{
    e.preventDefault();
    const btn = el('fieldOnlineSubmit');
    btn.disabled = true;
    try {
      const username = el('fieldOnlineUsername').value.trim().toLowerCase();
      const password = el('fieldOnlinePassword').value;
      const login = await request('auth/login',{method:'POST',body:JSON.stringify({username,password})});
      csrf = login.csrf;
      el('fieldOnlinePassword').value = '';
      await establish(login.user);
    } catch(e) {
      message('เข้าสู่ระบบไม่สำเร็จ', e.status===401 ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : (e.message||'server_error'));
    } finally {
      btn.disabled = false;
    }
  };

  window.addEventListener('beforeunload', e=>{
    if (syncPending) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  async function boot() {
    show();
    message('กำลังเชื่อม FIELD Online','ตรวจ session และ Turso');
    try {
      const session = await request('auth/session');
      csrf = session.csrf;
      await establish(session.user);
    } catch(e) {
      if (e.status === 401) setLoginForm();
      else failure(e);
    }
  }

  let remotePollTimer=null;
  let remotePollInFlight=false;
  function remotePollDelay(){
    if(document.hidden)return 5000;
    const hasLiveQueue=(state?.orders||[]).some(o=>o.status!=='returned');
    const queueVisible=!!document.getElementById('v-queue')?.classList.contains('active');
    return (hasLiveQueue||queueVisible)?650:1800;
  }
  async function pollRemote(){
    clearTimeout(remotePollTimer);
    if(remotePollInFlight){
      remotePollTimer=setTimeout(pollRemote,remotePollDelay());
      return;
    }
    remotePollInFlight=true;
    try {
      if (onlineReady && !syncPending && !syncing && gate.hidden) {
        const meta = await request('state/meta');
        if (Number(meta.revision) !== Number(revision)) {
          syncStatus('พบข้อมูลใหม่จากอีกเครื่อง · กำลังโหลด','warn');
          const remote = await request('state');
          if (Number(remote.revision) !== Number(revision)) await adopt(remote);
        }
      }
    } catch(e) {
      if (e.status === 401) setLoginForm('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      else if (onlineReady) syncStatus('ออฟไลน์ชั่วคราว · ใช้ข้อมูลในเครื่อง','warn');
    } finally {
      remotePollInFlight=false;
      remotePollTimer=setTimeout(pollRemote,remotePollDelay());
    }
  }
  function pollRemoteSoon(delay=60){
    clearTimeout(remotePollTimer);
    remotePollTimer=setTimeout(pollRemote,delay);
  }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)pollRemoteSoon(60);
  });
  window.addEventListener('focus',()=>pollRemoteSoon(60),{passive:true});
  window.addEventListener('online',()=>pollRemoteSoon(60),{passive:true});

  boot();
  remotePollTimer=setTimeout(pollRemote,400);
})();
