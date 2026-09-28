// Optimistic snapshot mode. The POS responds immediately and Turso sync runs in the background.
// A revision conflict never overwrites either copy; the operator must export and reconcile.
(() => {
  const gate = document.createElement('div');
  gate.id = 'onlineGate';
  gate.innerHTML = `<div class="online-card">
    <div class="online-brand">🌿 FIELD · ออนไลน์</div>
    <h2 id="onlineTitle">กำลังเชื่อมฐานข้อมูล</h2>
    <p id="onlineMessage">กำลังตรวจสถานะบัญชีและข้อมูลร้าน</p>
    <form id="onlineForm" hidden>
      <label>ชื่อผู้ใช้<input id="onlineUsername" autocomplete="username" value="admin" required></label>
      <label>รหัสผ่าน<input id="onlinePassword" type="password" autocomplete="current-password" required></label>
      <label id="onlineSetupLabel" hidden>รหัสตั้งค่าครั้งแรกจาก Vercel<input id="onlineSetupToken" type="password" autocomplete="off"></label>
      <button class="btn green" id="onlineSubmit" type="submit">เข้าสู่ระบบ</button>
    </form>
    <div id="onlineChoices" hidden></div>
    <button class="btn ghost" id="onlineRetry" type="button" hidden>ลองใหม่</button>
    <button class="btn ghost" id="onlineBackup" type="button" hidden>ดาวน์โหลดข้อมูลในเครื่อง (.json)</button>
  </div>`;
  const css = document.createElement('style');
  css.textContent = `#onlineGate{position:fixed;inset:0;z-index:100000;background:#17382c;display:grid;place-items:center;padding:16px}
    #onlineGate[hidden]{display:none}#onlineGate .online-card{width:min(460px,100%);max-height:95vh;overflow:auto;background:#f8f4e9;border-radius:20px;padding:26px;box-shadow:0 18px 60px #0004;color:#211e19}
    #onlineGate .online-brand{font-weight:800;color:#527b3b}#onlineGate h2{margin:12px 0}#onlineGate p{line-height:1.5}
    #onlineGate label{display:block;margin:10px 0;font-size:.85rem;font-weight:700}#onlineGate input{display:block;width:100%;padding:12px;border:1px solid #c8c5b9;border-radius:8px}
    #onlineGate button{display:block;width:100%;margin:10px 0;padding:11px}#onlineGate .online-note{font-size:.8rem;color:#6c6257}`;
  document.head.appendChild(css);
  document.body.appendChild(gate);
  const el = id => document.getElementById(id);
  let csrf = '', revision = null, onlineReady = false, syncPending = false, syncTimer = null, retryTimer = null, retryDelay = 3000, flushing = false, editVersion = 0;
  let setupMode = false, serverUser = null, lastSavedState = null;
  const originalSave = saveState;
  const originalLock = lockApp;
  const originalRefresh = refreshAccessUi;
  const msg = (title, detail) => { el('onlineTitle').textContent=title; el('onlineMessage').textContent=detail; };
  const show = () => { gate.hidden=false; };
  const hide = () => { gate.hidden=true; };
  const status = document.createElement('div');
  status.id='onlineSyncStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  status.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9999;background:#e8f1e6;color:#225037;border-radius:12px;padding:7px 12px;font:700 12px system-ui;box-shadow:0 2px 12px #0002';
  status.hidden=true;document.body.appendChild(status);
  const syncStatus = message => {status.textContent=message;status.hidden=!message};
  const request = async (path, options={}) => {
    const response = await fetch('/api/'+path,{credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json',...(options.body?{'X-CSRF-Token':csrf}:{}),...options.headers}});
    const data = await response.json().catch(()=>({error:'invalid_server_response'}));
    if(!response.ok)throw Object.assign(new Error(data.error||'server_error'),{status:response.status,data});
    return data;
  };
  const counts = s => `${(s.sales||[]).length} บิล · ${(s.orders||[]).length} คิว · ${(s.expenses||[]).length} ค่าใช้จ่าย`;
  function backup(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a'),url=URL.createObjectURL(blob);
    a.href=url;a.download='FIELD_POS_local_before_online_'+new Date().toISOString().slice(0,10)+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  el('onlineBackup').onclick=backup;
  function setForm(mode){
    setupMode=mode==='setup';show();el('onlineForm').hidden=false;el('onlineChoices').hidden=true;
    el('onlineSetupLabel').hidden=!setupMode;el('onlineSetupToken').required=setupMode;
    el('onlineSubmit').textContent=setupMode?'สร้าง Admin ออนไลน์':'เข้าสู่ระบบออนไลน์';
    msg(setupMode?'ตั้งค่า Admin ออนไลน์':'เข้าสู่ระบบออนไลน์',
      setupMode?'ใช้รหัสตั้งค่าครั้งแรกที่เก็บใน Environment Variables ของ Vercel เพื่อสร้างบัญชีฝั่ง Turso':'ใช้บัญชี Admin ที่เก็บใน Turso เพื่อเปิดข้อมูลร้านจากทุกเครื่อง');
    el('onlinePassword').value='';
  }
  async function establish(user){
    serverUser=user;await dbHydrationPromise;
    const remote=await request('state');
    const local=deepClone(state);
    if(remote.revision===0){
      if(Number(local.updatedAt)>0 || (local.sales||[]).length || (local.expenses||[]).length){
        show();el('onlineForm').hidden=true;el('onlineChoices').hidden=false;
        msg('ตรวจข้อมูลเดิมก่อนเปิดออนไลน์',`เครื่องนี้มี ${counts(local)} ส่วนฐานข้อมูลออนไลน์ยังว่าง ให้ดาวน์โหลด Backup แล้วเลือกนำข้อมูลเครื่องนี้ขึ้นออนไลน์`);
        el('onlineChoices').innerHTML='<button class="btn green" id="onlineImport" type="button">นำข้อมูลเครื่องนี้ขึ้น Turso</button><p class="online-note">ตรวจจำนวนบิลในไฟล์ Backup ก่อนเลือกนำเข้า</p>';
        el('onlineBackup').hidden=false;
        el('onlineImport').onclick=async()=>{backup();await firstCommit(local)};
        return;
      }
      show();el('onlineForm').hidden=true;el('onlineChoices').hidden=false;
      msg('ฐานข้อมูลออนไลน์ยังว่าง','หากมีข้อมูล POS อยู่ในเครื่องเดิม ให้เปิดเว็บนี้จากเครื่องนั้นและนำข้อมูลขึ้นออนไลน์ก่อน');
      el('onlineChoices').innerHTML='<button class="btn green" id="onlineStartEmpty" type="button">เริ่มร้านใหม่โดยไม่มีข้อมูลเดิม</button><button class="btn ghost" id="onlineCheckAgain" type="button">ตรวจข้อมูลออนไลน์อีกครั้ง</button>';
      el('onlineStartEmpty').onclick=()=>{if(confirm('ยืนยันว่าไม่มีบิลหรือข้อมูลเดิมที่ต้องนำเข้าจากเครื่องอื่น?'))firstCommit(local)};
      el('onlineCheckAgain').onclick=boot;
      return;
    }
    revision=remote.revision;
    if(Number(local.updatedAt)>Number(remote.updatedAt) && (local.sales||[]).length){
      show();el('onlineForm').hidden=true;el('onlineChoices').hidden=false;
      msg('พบข้อมูลทั้งในเครื่องและออนไลน์',`เครื่องนี้: ${counts(local)} · ออนไลน์: ${counts(remote.state)} กรุณาเก็บ Backup เครื่องนี้ก่อนใช้ข้อมูลออนไลน์`);
      el('onlineBackup').hidden=false;
      el('onlineChoices').innerHTML='<button class="btn green" id="onlineUseRemote" type="button">ดาวน์โหลด Backup แล้วใช้ข้อมูลออนไลน์</button>';
      el('onlineUseRemote').onclick=()=>{backup();adopt(remote)};
      return;
    }
    adopt(remote);
  }
  async function firstCommit(local){
    show();msg('กำลังบันทึกข้อมูลตั้งต้น','รอ Turso ยืนยันข้อมูลก่อนเริ่มขาย');
    try{
      const body=JSON.stringify({state:local,expectedRevision:0});
      if(new Blob([body]).size>3_500_000)throw new Error('ข้อมูลใหญ่เกิน 3.5 MB กรุณาลดขนาดรูปภาพเมนูแล้วลองใหม่');
      const result=await request('import/commit',{method:'POST',body});
      revision=result.revision;adopt({state:local,revision});
    }catch(e){if(e.status===409){const remote=await request('state');adopt(remote)}
      else failure(e)}
  }
  function adopt(remote){
    const needsMigration=remote.state?.dataVersion!==FIELD_DATA_VERSION;
    state=normalizeState(remote.state);revision=remote.revision;onlineReady=true;syncPending=false;syncStatus('');
    lastSavedState=JSON.stringify(state);
    localStorage.setItem(APP_KEY,lastSavedState);
    dbWrite=dbWrite.then(()=>persistDatabase()).catch(console.warn);
    authData={version:2,users:[{id:serverUser.id,username:serverUser.username,role:serverUser.role,
      views:serverUser.permissions||{},active:true}],recovery:null};
    renderCategories();renderMenuGrid();renderCart();renderQueue();updateQueueBadge();renderActionAlerts();
    unlockApp(authData.users[0]);el('onlineBackup').hidden=true;el('onlineRetry').hidden=true;hide();
    const readiness=el('serverReadiness');
    if(readiness)readiness.innerHTML='<h3>🌐 ข้อมูลออนไลน์</h3><p>บิล คิว สต๊อก และข้อมูลร้านบันทึกใน Turso หลังทุกการแก้ไข</p><p class="muted">เครื่องอื่นเข้าสู่ระบบด้วยบัญชีออนไลน์เดียวกันได้ หากสองเครื่องแก้พร้อมกัน ระบบจะหยุดและให้ตรวจข้อมูลก่อนเลือกเวอร์ชัน</p>';
    el('accessSettings').hidden=true;
    el('resetAllBtn').disabled=true;el('resetAllBtn').title='ปิดการรีเซ็ตข้อมูลขณะใช้ฐานข้อมูลออนไลน์';
    el('importFile').disabled=true;el('importFile').parentElement.hidden=true;
    if(needsMigration){syncPending=true;editVersion++;syncStatus('กำลังอัปเกรดฐานข้อมูลเมนู…');clearTimeout(syncTimer);syncTimer=setTimeout(flush,0)}
  }
  function failure(e){
    show();el('onlineForm').hidden=true;el('onlineChoices').hidden=true;el('onlineBackup').hidden=false;
    el('onlineRetry').hidden=false;
    if(e.status===409)msg('ข้อมูลสองเครื่องขัดแย้งกัน','หยุดบันทึกเพื่อป้องกันบิลหาย ดาวน์โหลดข้อมูลเครื่องนี้ก่อน แล้วตรวจข้อมูลออนไลน์อีกครั้ง');
    else if(e.status===401)msg('เซสชันหมดอายุ','ข้อมูลที่ยังไม่ซิงก์เก็บอยู่ในเครื่องนี้ กรุณาเข้าสู่ระบบอีกครั้ง');
    else msg('บันทึกออนไลน์ไม่สำเร็จ','หยุดรับรายการใหม่จนกว่าจะเชื่อมต่อและบันทึกสำเร็จ: '+e.message);
    el('onlineRetry').onclick=()=>{if(!onlineReady)boot();else if(e.status===401)setForm('login');else if(e.status===409)resolveConflict();else flush()};
  }
  async function resolveConflict(){
    try{const remote=await request('state');show();el('onlineRetry').hidden=true;el('onlineChoices').hidden=false;
      msg('ตรวจข้อมูลก่อนเปลี่ยนเครื่อง',`ข้อมูลเครื่องนี้: ${counts(state)} · ออนไลน์: ${counts(remote.state)} เก็บ Backup แล้วใช้ข้อมูลออนไลน์เท่านั้นเมื่อได้ตรวจบิลที่ค้างแล้ว`);
      el('onlineChoices').innerHTML='<button class="btn ghost" id="onlineReload" type="button">ดาวน์โหลด Backup แล้วโหลดข้อมูลออนไลน์</button>';
      el('onlineReload').onclick=()=>{backup();adopt(remote)};
    }catch(err){failure(err)}
  }
  async function flush(){
    if(!onlineReady||!syncPending||flushing)return;
    flushing=true;
    try{
      while(syncPending){
        const version=editVersion,document=deepClone(state);
        const body=JSON.stringify({state:document,expectedRevision:revision,replace:true});
        if(new Blob([body]).size>3_500_000)throw new Error('ข้อมูลใหญ่เกิน 3.5 MB กรุณาลดขนาดรูปภาพเมนูแล้วลองใหม่');
        const result=await request('import/commit',{method:'POST',body});
        revision=result.revision;lastSavedState=JSON.stringify(document);
        syncPending=editVersion!==version;
      }
      retryDelay=3000;clearTimeout(retryTimer);syncStatus('บันทึกออนไลน์แล้ว');setTimeout(()=>{if(!syncPending)syncStatus('')},1800);hide();
    }catch(e){
      syncPending=true;
      if(e.status===401||e.status===409)failure(e);
      else{syncStatus('บันทึกในเครื่องแล้ว · รอซิงก์ออนไลน์');clearTimeout(retryTimer);retryTimer=setTimeout(flush,retryDelay);retryDelay=Math.min(retryDelay*2,30000)}
    }
    finally{flushing=false}
  }
  saveState = function(){
    originalSave();
    if(onlineReady){syncPending=true;editVersion++;syncStatus('บันทึกในเครื่องแล้ว · กำลังซิงก์…');
      clearTimeout(syncTimer);syncTimer=setTimeout(flush,350)}
  };
  window.addEventListener('beforeunload',e=>{if(syncPending){e.preventDefault();e.returnValue=''}});
  refreshAccessUi = function(){originalRefresh();if(onlineReady)el('accessSettings').hidden=true};
  lockApp = function(message){if(onlineReady){authSession=null;document.body.classList.add('auth-locked');setForm('login');
    if(message)el('onlineMessage').textContent=message;return}originalLock(message)};
  el('onlineForm').onsubmit=async e=>{
    e.preventDefault();const button=el('onlineSubmit');button.disabled=true;
    try{
      const username=el('onlineUsername').value.trim().toLowerCase(),password=el('onlinePassword').value;
      if(setupMode){
        await request('setup/admin',{method:'POST',body:JSON.stringify({username,password,setupToken:el('onlineSetupToken').value})});
        el('onlineSetupToken').value='';setForm('login');msg('สร้าง Admin สำเร็จ','กรอกรหัสผ่านอีกครั้งเพื่อเข้าสู่ระบบออนไลน์');return;
      }
      const login=await request('auth/login',{method:'POST',body:JSON.stringify({username,password})});
      csrf=login.csrf;el('onlinePassword').value='';
      if(onlineReady&&syncPending){serverUser=login.user;authData.users=[{id:serverUser.id,username:serverUser.username,role:serverUser.role,views:serverUser.permissions||{},active:true}];unlockApp(authData.users[0]);await flush()}
      else await establish(login.user);
    }catch(err){msg(setupMode?'ตั้งค่าไม่สำเร็จ':'เข้าสู่ระบบไม่สำเร็จ',err.status===403?'ตรวจรหัสตั้งค่าหรือสิทธิ์บัญชี':err.message)}
    finally{button.disabled=false}
  };
  async function boot(){
    show();
    try{
      const status=await request('setup/status');
      if(!status.initialized){setForm('setup');return}
      try{const session=await request('auth/session');csrf=session.csrf;await establish(session.user)}
      catch(e){if(e.status===401)setForm('login');else throw e}
    }catch(e){failure(e)}
  }
  // The app is deliberately unavailable while connectivity or authentication is unresolved.
  boot();
  setInterval(async()=>{if(!onlineReady||syncPending||gate.hidden===false||!authSession)return;
    try{const remote=await request('state');if(remote.revision!==revision)adopt(remote)}
    catch(e){if(e.status===401)failure(e);else syncStatus('ออฟไลน์ชั่วคราว · ใช้ข้อมูลในเครื่อง')}} ,15000);
})();
