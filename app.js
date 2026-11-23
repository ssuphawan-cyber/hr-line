// © 2569 S.SUPHAWAN. All rights reserved. Developed by MEAWMEAW
// 4Source HR · staff web page: check in/out with GPS + selfie, leave / OT / time-correction requests, approvals.
// Opens in any phone browser and can be added to the home screen. The person signs in with employee code + 6-digit PIN;
// the Apps Script web app (gas\Code.gs) gives a signed session that is kept on the phone for 60 days, checks it on
// every call, and keeps the time of every record itself. Notices (decisions on my requests, requests waiting for me)
// are shown here: on the home page, on the app icon's badge where the phone supports it, refreshed while the page is open.
'use strict';
const C = window.HR_CONFIG;
const SKEY = 'hr_session', CKEY = 'hr_code';
const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { } } };
const S = { session: store.get(SKEY), me: null, page: '' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoOf(new Date());
const thDate = iso => iso ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(iso.slice(0, 10) + 'T00:00:00')) : '';
const thDay = iso => new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00'));
const hhmm = s => String(s || '').slice(11, 16);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const KIND = { TimeLog: 'ลงเวลา', LeaveReq: 'ขอลา', OTReq: 'ขอ OT', TimeFix: 'ขอแก้เวลา' };

// ---------- server ----------
async function call(action, data = {}) {
  let r;
  const sess = S.session;   // an answer that comes back after the person signed out / in again is not acted on
  try { r = await fetch(C.GAS_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action, session: sess }, data)) }); }
  catch { throw new Error('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
  const j = await r.json().catch(() => ({ ok: false, error: 'ระบบตอบกลับผิดรูปแบบ' }));
  if (sess && sess !== S.session) { const e = new Error('stale'); e.handled = true; throw e; }
  if (!j.ok) {
    const e = new Error(j.error || 'เกิดข้อผิดพลาด'); e.first = !!j.first; e.otp = !!j.otp;
    if (j.auth && sess) { signOut(); toast(e.message, true); pLogin(); e.handled = true; }
    throw e;
  }
  return j;
}
function signIn(r) { S.session = r.session; if (!(S.me && S.me.dev)) store.set(SKEY, r.session); }
function signOut() { S.session = ''; S.me = null; store.set(SKEY, ''); }
function toast(msg, err) {
  if (msg === 'stale') return;   // a late answer to a screen that is gone (see call)
  const t = $('#toast'); t.textContent = (err ? '⚠ ' : '✓ ') + msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', err ? 6000 : 3500);
}
const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; if (on) { btn._t = btn.innerHTML; btn.innerHTML = label || 'กำลังส่ง…'; } else if (btn._t) btn.innerHTML = btn._t; };
function view(html) { $('#app').innerHTML = html; window.scrollTo(0, 0); }
const back = `<button class="back" data-go="home">‹ กลับหน้าหลัก</button>`;

// ---------- start ----------
async function boot() {
  const q = new URLSearchParams(location.search);
  S.page = q.get('p') || 'home';
  // developer / HR check from the program: #dev=<2-hour session> (kept in this tab only, never saved on the device)
  const dv = /^#dev=([\w.-]+)$/.exec(location.hash);
  if (dv) { S.session = dv[1]; history.replaceState(null, '', location.pathname + location.search); }
  if (!C.GAS_URL) return view(`<div class="card err-card"><h2>ยังไม่ได้ตั้งค่า</h2><p>ใส่ GAS_URL ในไฟล์ config.js</p></div>`);
  if (!S.session) { await loadCfg(); return pLogin(); }
  try { await loadCfg(); await afterSignIn(null, true); }
  catch (e) { if (!e.handled) view(`<div class="card err-card"><h2>เปิดหน้าไม่สำเร็จ</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">ลองใหม่</button></div>`); }
}
async function loadMe() { S.me = await call('web.me'); $('#org').textContent = S.me.org || ''; badge(); }
// after signing in: HR's PIN is changed first, then the page asked for (a link may ask for approvals: ?p=approve)
function start() { if (S.me.mustChange) return pPin(true); const p = S.page; S.page = 'home'; go(p); }
function go(p) {
  if (S.admin && !S.me) return p === 'pin' ? pPin(false) : pAdmin();
  if (!S.me) return pLogin();
  S.cur = p;
  ({ home: pHome, clock: pClock, leave: pLeave, ot: pOt, fix: pFix, mine: pMine, approve: pApprove, pin: () => pPin(false) }[p] || pHome)();
}

// ---------- notices (in place of LINE messages) ----------
// decisions on my requests since I last looked (kept per person on this phone), and requests waiting for me
const seenKey = () => 'hr_seen_' + (S.me && S.me.emp ? S.me.emp.Code : '');
const tsOf = s => String(s || '').replace(' ', 'T');
const unseen = () => (S.me && S.me.news || []).filter(n => tsOf(n.UpdatedAt) > store.get(seenKey()));
function markSeen() { const n = (S.me && S.me.news || [])[0]; if (n) store.set(seenKey(), tsOf(n.UpdatedAt)); badge(); }
function badge() {
  const k = (S.me ? (S.me.waiting || 0) : 0) + unseen().length;
  try { if (navigator.setAppBadge) k ? navigator.setAppBadge(k) : navigator.clearAppBadge(); } catch { }
  document.title = (k ? `(${k}) ` : '') + '4Source HR';
}
function newsCard() {
  const m = S.me, list = unseen(), out = [];
  if (m.approver && m.waiting) out.push(`<button class="card notice ap" data-go="approve"><b>✅ มีคำขอรอคุณอนุมัติ ${m.waiting} รายการ</b><span>แตะเพื่อดูและอนุมัติ ›</span></button>`);
  if (list.length) out.push(`<div class="card notice"><div class="row"><b>🔔 ผลคำขอของคุณ (${list.length})</b><button class="mini" data-seen>รับทราบ</button></div>
    ${list.slice(0, 5).map(n => `<div class="nrow"><span class="st ${stCls(n.Status)}">${esc(n.Status)}</span> ${esc(KIND[n.sheet] || '')} ${esc(summary(n))}${n.ApproveNote ? `<div class="muted">หมายเหตุ: ${esc(n.ApproveNote)}</div>` : ''}</div>`).join('')}
    ${list.length > 5 ? `<button class="mini" data-go="mine">ดูทั้งหมด ›</button>` : ''}</div>`);
  return out.join('');
}
document.addEventListener('click', e => { if (e.target.closest('[data-seen]')) { markSeen(); if (S.cur === 'home') pHome(); } });
// while the page is open: fresh figures when it comes back to the screen, and every 2 minutes on the home page
async function refresh() {
  if (!S.session || !S.me || document.hidden) return;
  try { await loadMe(); if (S.cur === 'home' && !document.querySelector('input:focus, textarea:focus')) pHome(); } catch { }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (S.cur === 'home') refresh(); }, 120000);
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

// ---------- sign in ----------
//   login  username (employee code / company email / ID card / passport, as the admin made it) + PIN or password
//   first  first time or forgotten secret: a 6-digit code by email or SMS, then the person's own PIN / password
//   The top admin signs in with username + password only (no code), and gets the admin console.
const digits = v => String(v || '').replace(/\D/g, '');
const isPw = () => S.cfg && S.cfg.cred === 'password';
const credTh = () => isPw() ? 'รหัสผ่าน' : ' PIN ';
// a box for a secret: PIN = 6 digits on the number pad; password (and the admin's) = any text
function secretInput(id, label, auto, own, pw) {
  pw = pw || isPw();
  return `<label>${label}<input id="${id}" type="password" ${pw ? 'maxlength="64" autocapitalize="off"' : 'inputmode="numeric" pattern="[0-9]*" maxlength="6" class="pinbox"'} autocomplete="${auto}" placeholder="${pw ? (own ? '8 ตัวขึ้นไป มีตัวอักษรและตัวเลข' : 'รหัสผ่าน') : '••••••'}"></label>`;
}
// the same rule as the server, so a mistake shows before sending
function ownSecretOk(s, code, admin) {
  if (!admin && !isPw()) { if (!/^\d{6}$/.test(s)) return 'PIN ต้องเป็นตัวเลข 6 หลัก'; if (/^(\d)\1{5}$/.test(s) || '0123456789'.includes(s) || '9876543210'.includes(s)) return 'PIN นี้เดาง่ายเกินไป'; return ''; }
  if (s.length < (admin ? 10 : 8)) return `รหัสผ่านต้องยาว ${admin ? 10 : 8} ตัวขึ้นไป`;
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
  if (code && s.toUpperCase().includes(code)) return 'รหัสผ่านต้องไม่มีรหัสพนักงานอยู่ในนั้น';
  return '';
}
const secretVal = (id, pw) => (pw || isPw()) ? ($(id) ? $(id).value : '') : digits($(id) ? $(id).value : '');
async function loadCfg() { if (!S.cfg) { try { S.cfg = await call('web.config'); } catch { S.cfg = { cred: 'pin', email: true, sms: false }; } } if (S.cfg.org) $('#org').textContent = S.cfg.org; return S.cfg; }
const userVal = () => ($('#lUser') ? $('#lUser').value.trim() : '');
function pLogin(mode, typed) {
  if (!S.cfg) { loadCfg().then(() => pLogin(mode, typed)); return view('<div class="loading"><i></i>กำลังโหลด…</div>'); }
  mode = mode === 'first' ? 'first' : 'login';
  const user = typed != null ? typed : store.get(CKEY), adm = !!S.adminLogin;
  const O = S.otp || {};   // { user, channels, sentTo }
  let body = '';
  if (mode === 'login') body = `${secretInput('lPin', adm ? 'รหัสผ่าน' : credTh(), 'current-password', false, adm)}
      <button class="btn big primary" id="lGo">เข้าสู่ระบบ</button>
      <p class="hint">${adm ? 'บัญชีผู้ดูแลระบบสูงสุด · ' : 'ใช้ครั้งแรกหรือลืมรหัส เลือก “ครั้งแรก / ลืมรหัส” · '}กรอกผิด 5 ครั้งต้องรอ 15 นาที
        · <a href="#" data-admlogin>${adm ? 'เข้าสู่ระบบพนักงาน' : 'ผู้ดูแลระบบ'}</a></p>`;
  else if (!O.channels || O.user !== user) body = `<button class="btn big primary" id="lGo">ถัดไป</button>
      <p class="hint">ระบบจะส่งรหัสยืนยัน 6 หลักไปที่อีเมลหรือเบอร์มือถือที่ผู้ดูแลระบบบันทึกไว้ แล้วให้คุณตั้ง${credTh()}เอง · ถ้ายังไม่มีบัญชี ติดต่อผู้ดูแลระบบ</p>`;
  else if (!O.sentTo) body = `<div class="muted" style="margin-top:10px">ส่งรหัสยืนยันไปที่</div>
      ${O.channels.map(c => `<button class="btn" data-otpch="${c.ch}">${c.ch === 'email' ? '📧 อีเมล' : '📱 SMS'} ${esc(c.to)}</button>`).join('')}
      <button class="btn" data-otpback style="border:0">‹ เปลี่ยนชื่อผู้ใช้</button>`;
  else body = `<div class="note">ส่งรหัส 6 หลักไปที่ <b>${esc(O.sentTo)}</b> แล้ว (ใช้ได้ 10 นาที${O.ch === 'email' ? ' · ดูในกล่องจดหมายขยะด้วย' : ''})</div>
      <label>รหัสยืนยัน<input id="lOtp" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" class="pinbox" placeholder="••••••"></label>
      ${secretInput('lPin', 'ตั้ง' + credTh() + 'ของคุณ', 'new-password', true)}${secretInput('lPin2', 'ยืนยัน' + credTh() + 'อีกครั้ง', 'new-password', true)}
      <button class="btn big primary" id="lGo">ยืนยันและเข้าใช้</button>
      <button class="btn" data-otpagain>ขอรหัสใหม่</button>`;
  view(`<div class="card login"><h2>${adm ? 'เข้าสู่ระบบผู้ดูแล' : 'เข้าสู่ระบบพนักงาน'}</h2>
    ${adm ? '' : `<div class="seg"><button class="${mode === 'login' ? 'on' : ''}" data-login="login">เข้าสู่ระบบ</button><button class="${mode === 'first' ? 'on' : ''}" data-login="first">ครั้งแรก / ลืมรหัส</button></div>`}
    <label>ชื่อผู้ใช้<input id="lUser" autocapitalize="off" autocomplete="username" value="${esc(user)}" placeholder="${adm ? 'ชื่อผู้ใช้ผู้ดูแล' : 'รหัสพนักงาน / อีเมล / เลขบัตร ตามที่ได้รับแจ้ง'}" ${mode === 'first' && O.channels && O.user === user ? 'readonly' : ''}></label>
    ${body}</div>${adm ? '' : installCard()}`);
  S.mode = mode;
  $('#lUser').oninput = () => { S.otp = null; };
  const f = mode === 'first' && O.sentTo ? $('#lOtp') : user ? ($('#lPin') || $('#lGo')) : $('#lUser');
  if (f && f.focus) f.focus();
  document.querySelectorAll('.login input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && $('#lGo')) $('#lGo').click(); });
  if ($('#lGo')) $('#lGo').onclick = async e => {
    const u = userVal();
    if (!u) return toast('กรอกชื่อผู้ใช้', true);
    busy(e.target, true, 'กำลังตรวจสอบ…');
    try {
      if (mode === 'login') {
        const s = secretVal('#lPin', adm); if (!s) { busy(e.target, false); return toast('กรอกรหัส', true); }
        const r = await call('web.login', { user: u, pin: s });
        store.set(CKEY, u); signIn(r); S.adminLogin = false; await afterSignIn(r); return;
      }
      if (!O.channels || O.user !== u) { const r = await call('web.otpstart', { user: u }); S.otp = { user: u, channels: r.channels }; store.set(CKEY, u); return pLogin('first', u); }
      const o = digits($('#lOtp').value), s = secretVal('#lPin');
      if (o.length !== 6) { busy(e.target, false); return toast('กรอกรหัสยืนยัน 6 หลัก', true); }
      const bad = ownSecretOk(s, ''); if (bad) { busy(e.target, false); return toast(bad, true); }
      if (s !== secretVal('#lPin2')) { busy(e.target, false); return toast(credTh() + 'ทั้งสองช่องไม่ตรงกัน', true); }
      const r = await call('web.otpverify', { user: u, otp: o, pin: s });
      S.otp = null; signIn(r); toast('ยืนยันตัวตนและตั้ง' + credTh() + 'เรียบร้อย'); await afterSignIn(r);
    } catch (x) {
      toast(x.message, true); busy(e.target, false);
      if (mode === 'login' && x.first) { S.otp = null; pLogin('first', u); }
    }
  };
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-login]'); if (b) { S.otp = null; return pLogin(b.dataset.login, userVal()); }
  if (e.target.closest('[data-admlogin]')) { e.preventDefault(); S.adminLogin = !S.adminLogin; return pLogin('login', ''); }
  if (e.target.closest('[data-otpback]')) { S.otp = null; return pLogin('first', userVal()); }
  if (e.target.closest('[data-otpagain]')) { S.otp.sentTo = ''; return pLogin('first', S.otp.user); }
  const c = e.target.closest('[data-otpch]');
  if (c) {
    busy(c, true, 'กำลังส่งรหัส…');
    try { const r = await call('web.otp', { user: S.otp.user, ch: c.dataset.otpch }); S.otp.sentTo = r.to; S.otp.ch = r.ch; toast('ส่งรหัสแล้ว'); pLogin('first', S.otp.user); }
    catch (x) { toast(x.message, true); busy(c, false); }
  }
});
// where a session goes: the admin console, or the person's page
async function afterSignIn(r, quiet) {
  const who = r && r.admin != null ? r : await call('web.check');
  if (r && r.admin || who.code === '#ADMIN') { S.admin = true; S.me = null; await loadCfg(); return pAdmin(); }
  S.admin = false; await loadMe(); if (!quiet) toast('เข้าสู่ระบบแล้ว'); start();
}
// change one's own secret (the admin: password of 10+); the new session replaces the old one
function pPin(forced) {
  if (!S.cfg) { loadCfg().then(() => pPin(forced)); return; }
  const adm = !!S.admin, cr = adm ? 'รหัสผ่าน' : credTh(), needOld = adm || (!forced && S.me && S.me.hasSecret);
  view(`${forced ? '' : adm ? admBack : back}<div class="card login"><h2>${forced ? 'ตั้ง' + cr + 'ของคุณ' : 'เปลี่ยน' + cr}</h2>
    ${needOld ? secretInput('pOld', cr + 'เดิม', 'current-password', false, adm) : ''}
    ${secretInput('pNew', cr + 'ใหม่', 'new-password', true, adm)}${secretInput('pNew2', 'ยืนยัน' + cr + 'ใหม่', 'new-password', true, adm)}
    <button class="btn big primary" id="pGo">บันทึก</button>
    <p class="hint">${adm ? '10 ตัวขึ้นไป มีทั้งตัวอักษรและตัวเลข' : isPw() ? '8 ตัวขึ้นไป มีทั้งตัวอักษรและตัวเลข ไม่ใช้รหัสพนักงาน' : 'ตัวเลข 6 หลัก ห้ามใช้ 123456, 111111 หรือวันเกิด'} · เครื่องอื่นที่เข้าสู่ระบบไว้จะต้องเข้าใหม่</p></div>`);
  $('#pGo').onclick = async e => {
    const s = secretVal('#pNew', adm), bad = ownSecretOk(s, adm ? '' : S.me.emp.Code, adm);
    if (bad) return toast(bad, true);
    if (s !== secretVal('#pNew2', adm)) return toast(cr + 'ใหม่ทั้งสองช่องไม่ตรงกัน', true);
    busy(e.target, true, 'กำลังบันทึก…');
    try { signIn(await call('web.pin', { pin: s, old: needOld ? secretVal('#pOld', adm) : '' })); toast('บันทึก' + cr + 'แล้ว'); if (adm) pAdmin(); else { S.me.mustChange = false; S.me.hasSecret = true; start(); } }
    catch (x) { toast(x.message, true); busy(e.target, false); }
  };
}
function logout() {
  if (S.asFrom) return backToAdmin();
  if (!confirm('ออกจากระบบบนเครื่องนี้?')) return;
  signOut(); S.admin = false; S.adminLogin = false; pLogin();
}

// ---------- admin console (top admin): users, act-as ----------
const KIND_TH = { code: 'รหัสพนักงาน', email: 'อีเมลบริษัท', idcard: 'เลขบัตรประชาชน', passport: 'หนังสือเดินทาง', admin: 'ผู้ดูแลสูงสุด' };
const admBack = '<button class="back" data-admin>‹ เมนูผู้ดูแล</button>';
const admHead = sub => `<div class="card hello"><div class="av">🛡</div><div><b>ผู้ดูแลระบบสูงสุด</b><div class="muted">${sub}</div></div></div>`;
// the admin's home: the menu (counts filled in when they come back)
async function pAdmin() {
  S.cur = 'admin';
  const n = k => `<em id="n-${k}" hidden></em>`;
  view(`${admHead(esc((S.cfg && S.cfg.org) || ''))}
    <div class="grid">
      <button class="tile ap" data-admgo="waiting"><i>⏳</i>รออนุมัติทั้งหมด${n('waiting')}</button>
      <button class="tile" data-admgo="today"><i>🕘</i>ลงเวลาวันนี้</button>
      <button class="tile" data-admgo="all"><i>📋</i>คำขอทั้งหมด<span class="muted" style="display:block;font-weight:400;font-size:12px">30 วันล่าสุด</span></button>
      <button class="tile" data-admgo="as"><i>🧑‍💼</i>ใช้งานแทนพนักงาน<span class="muted" style="display:block;font-weight:400;font-size:12px">เมนูของพนักงานทั้งหมด</span></button>
      <button class="tile" data-admgo="users"><i>👥</i>ผู้ใช้${n('users')}</button>
      <button class="tile" data-go="pin"><i>🔑</i>เปลี่ยนรหัสผ่าน</button>
    </div>
    <p class="hint center">ข้อมูลส่วนบุคคล (ค่าจ้าง เหตุผล หมายเหตุ เอกสาร รูป ตำแหน่ง) ถูกซ่อนในทุกหน้าของผู้ดูแล</p>
    <div class="foot-links"><button class="mini" data-logout>ออกจากระบบ</button></div>`);
  try {
    const [L, W] = await Promise.all([call('web.admin.list'), call('web.admin.overview', { what: 'waiting' })]);
    S.adm = L; if (S.cur !== 'admin') return;
    const set = (k, v) => { const el = $('#n-' + k); if (el && v) { el.textContent = v; el.hidden = false; } };
    set('waiting', W.rows.length); set('users', L.users.length - 1);
  } catch (x) { if (!x.handled) toast(x.message, true); }
}
async function pAdmUsers() {
  S.cur = 'admusers';
  view(`${admBack}${admHead('ผู้ใช้ · สร้าง / แก้ไข / ใช้งานแทน')}<div id="adm" class="loading"><i></i>กำลังโหลด…</div>`);
  try { S.adm = await call('web.admin.list'); admList(); }
  catch (x) { if (!x.handled && $('#adm')) $('#adm').innerHTML = `<p class="bad">${esc(x.message)}</p>`; }
}
// pick a person to act as (everyone still working; with or without a user)
async function pAdmAs() {
  S.cur = 'admas';
  view(`${admBack}<div class="card"><h2>ใช้งานแทนพนักงาน</h2><p class="hint" style="margin-top:0">เปิดเมนูของพนักงานคนนั้นทั้งหมด (1 ชั่วโมง) · ซ่อนข้อมูลส่วนบุคคล · ลงเวลาแทนไม่ได้ · คำขอ/การอนุมัติที่ทำจะระบุว่าทำแทน</p>
    <input id="asQ" placeholder="ค้นหา รหัส / ชื่อ / หน่วยงาน"><div id="asList" class="loading"><i></i>กำลังโหลด…</div></div>`);
  try { if (!S.adm) S.adm = await call('web.admin.list'); } catch (x) { if (!x.handled) toast(x.message, true); return; }
  const draw = () => { const q = ($('#asQ').value || '').toLowerCase(), box = $('#asList'); if (!box) return; box.className = '';
    box.innerHTML = S.adm.emps.filter(e => !q || [e.code, e.name, e.unit, e.pos].join(' ').toLowerCase().includes(q))
      .map(e => `<button class="item pick" data-uas="${esc(e.code)}"><b>${esc(e.name)}</b><div class="muted">${esc(e.code)} · ${esc(e.pos || '')} · ${esc(e.unit || '')}${e.hasUser ? '' : ' · ยังไม่มีบัญชี'}</div></button>`).join('') || '<p class="muted">ไม่พบ</p>'; };
  $('#asQ').oninput = draw; draw();
}
// company-wide lists for the admin (confidential things come back hidden)
async function pAdmView(what) {
  S.cur = 'adm-' + what;
  const title = { waiting: 'รออนุมัติทั้งหมด', all: 'คำขอทั้งหมด · 30 วันล่าสุด', today: 'ลงเวลาวันนี้ · ' + thDay(todayIso()) }[what];
  view(`${admBack}<div class="card"><h2>${title}</h2><div id="ov" class="loading"><i></i>กำลังโหลด…</div></div>`);
  let r; try { r = await call('web.admin.overview', { what }); } catch (x) { if (!x.handled && $('#ov')) $('#ov').innerHTML = `<p class="bad">${esc(x.message)}</p>`; return; }
  const box = $('#ov'); if (!box) return; box.className = '';
  if (what === 'today') {
    const by = {}; r.rows.forEach(l => (by[l.Emp] = by[l.Emp] || []).push(l));
    const came = r.team.filter(e => by[e.Code]), not = r.team.filter(e => !by[e.Code]);
    box.innerHTML = `<p class="muted">ลงเวลาแล้ว ${came.length} · ยังไม่ลงเวลา ${not.length} จาก ${r.team.length} คน</p>
      ${came.map(e => `<div class="item"><b>${esc(e.Name)}</b> <span class="muted">${esc(e.Code)}</span><div>${by[e.Code].map(l => `<span class="t-${l.Type === 'IN' ? 'in' : 'out'}">${l.Type === 'IN' ? 'เข้า' : 'ออก'} ${hhmm(l.CreatedAt)}</span>${l.InZone === 'Y' ? '' : ' <span class="bad">นอกพื้นที่</span>'}${l.Status === 'รอยืนยัน' ? ' <span class="chip warn">รอยืนยัน</span>' : ''}`).join(' · ')}</div></div>`).join('')}
      ${not.length ? `<div class="item"><b>ยังไม่ลงเวลา</b><div class="muted">${not.map(e => esc(e.Name)).join(' · ')}</div></div>` : ''}`;
    return;
  }
  box.innerHTML = r.rows.length ? r.rows.map(x => `<div class="item"><div class="row"><span class="kind">${x.sheet === 'TimeLog' ? 'ลงเวลานอกพื้นที่' : KIND[x.sheet]}</span><span class="st ${stCls(x.Status)}">${esc(x.Status)}</span></div>
      <b>${esc(x.EmpName)}</b> <span class="muted">${esc(x.Emp)}</span><div>${esc(summary(x))}</div>
      <div class="muted">ผู้อนุมัติ ${esc(x.ApproverName || '-')} · ส่งเมื่อ ${thDate(x.CreatedAt)} ${hhmm(String(x.CreatedAt).replace(' ', 'T'))} น.</div></div>`).join('')
    : `<p class="muted">${what === 'waiting' ? 'ไม่มีรายการรออนุมัติ 🎉' : 'ไม่มีคำขอใน 30 วันล่าสุด'}</p>`;
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-admgo]'); if (!g) return;
  const k = g.dataset.admgo;
  if (k === 'users') return pAdmUsers();
  if (k === 'as') return pAdmAs();
  return pAdmView(k);
});
function admList() {
  const A = S.adm, q = (S.admQ || '').trim().toLowerCase(), box = $('#adm'); if (!box) return;
  const rows = A.users.filter(u => !q || [u.code, u.name, u.hint, u.email].join(' ').toLowerCase().includes(q));
  const free = A.emps.filter(e => !e.hasUser).length;
  box.className = '';
  box.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">ผู้ใช้ ${A.users.length - 1} คน</h2><button class="btn primary" style="width:auto;margin:0" data-uadd ${free ? '' : 'disabled'}>+ เพิ่มผู้ใช้</button></div>
    <input id="admQ" placeholder="ค้นหา รหัส / ชื่อ / อีเมล" value="${esc(S.admQ || '')}" style="margin-top:10px">
    <p class="hint">ส่งรหัสยืนยันได้ทาง: ${A.cfg.email ? 'อีเมล' : ''}${A.cfg.email && A.cfg.sms ? ' และ ' : ''}${A.cfg.sms ? 'SMS' : ''}${!A.cfg.email && !A.cfg.sms ? '<b class="bad">ยังไม่ได้เปิด (ตั้งที่โปรแกรม HR)</b>' : ''} · พนักงานที่ยังไม่มีบัญชี ${free} คน</p></div>
    ${rows.map(u => `<div class="card user"><div class="row"><b>${esc(u.name)}</b><span class="st ${u.status === 'ปิด' ? 'bad' : u.verified ? 'ok' : 'warn'}">${u.status === 'ปิด' ? 'ปิดใช้งาน' : u.verified ? 'ใช้งานได้' : 'ยังไม่ยืนยันตัวตน'}</span></div>
      <div class="muted">${u.code === '#ADMIN' ? '' : esc(u.code) + ' · '}ชื่อผู้ใช้ (${esc(u.kindTh)}): <b>${esc(u.hint)}</b></div>
      ${u.code === '#ADMIN' ? '' : `<div class="muted">รับรหัสยืนยัน: ${u.email ? '📧 ' + esc(u.email) : ''} ${u.phone ? '📱 ' + esc(u.phone) : ''}${!u.email && !u.phone ? '<span class="bad">ไม่มีอีเมล/เบอร์</span>' : ''}</div>`}
      <div class="muted">เข้าใช้ล่าสุด ${u.lastLogin ? esc(thDate(u.lastLogin)) + ' ' + esc(hhmm(String(u.lastLogin).replace(' ', 'T'))) + ' น.' : '-'}</div>
      <div class="row" style="justify-content:flex-start;margin-top:8px">
        <button class="mini blue" data-uedit="${esc(u.code)}">แก้ไข</button>
        ${u.code === '#ADMIN' ? '' : `<button class="mini blue" data-uas="${esc(u.code)}">ใช้งานแทน</button>${u.verified ? `<button class="mini" data-ureset="${esc(u.code)}">ให้ยืนยันตัวตนใหม่</button>` : ''}<button class="mini" data-udel="${esc(u.code)}">ลบ</button>`}
      </div></div>`).join('')}`;
  $('#admQ').oninput = e => { S.admQ = e.target.value; const pos = e.target.selectionStart; admList(); const i = $('#admQ'); i.focus(); i.setSelectionRange(pos, pos); };
}
// make a user (from an employee without one) or change one; only the top admin can change a username
function admForm(code) {
  const A = S.adm, u = code ? A.users.find(x => x.code === code) : null, isAdm = code === '#ADMIN';
  const emps = A.emps.filter(e => !e.hasUser || (u && e.code === u.code));
  const e0 = u ? A.emps.find(e => e.code === u.code) : emps[0];
  const kind = u ? u.kind : 'code';
  view(`<button class="back" data-admgo="users">‹ ผู้ใช้</button><div class="card"><h2>${u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}</h2>
    ${isAdm ? '' : `<label>พนักงาน<select id="uEmp" ${u ? 'disabled' : ''}>${emps.map(e => `<option value="${esc(e.code)}" ${e0 && e.code === e0.code ? 'selected' : ''}>${esc(e.code)} · ${esc(e.name)}</option>`).join('')}</select></label>
    <label>ชื่อผู้ใช้สร้างจาก<select id="uKind">${['code', 'email', 'idcard', 'passport'].map(k => `<option value="${k}" ${k === kind ? 'selected' : ''}>${KIND_TH[k]}</option>`).join('')}</select></label>`}
    <label>ชื่อผู้ใช้${u ? ` <span class="muted">(ตอนนี้: ${esc(u.hint)} · เว้นว่าง = ไม่เปลี่ยน)</span>` : ''}<input id="uName" autocapitalize="off" placeholder=""></label>
    ${isAdm ? '' : `<label>อีเมลบริษัท (รับรหัสยืนยันทางอีเมล)<input id="uMail" type="email" value="${esc(u ? u.email : (e0 && e0.email) || '')}" placeholder="name@company.com"></label>
    <label>เบอร์มือถือ (รับรหัสทาง SMS)<input id="uPhone" inputmode="tel" value="${esc(u ? u.phone : (e0 && e0.phone) || '')}" placeholder="08xxxxxxxx"></label>
    <label>สถานะ<select id="uSt"><option value="ใช้งาน">ใช้งาน</option><option value="ปิด" ${u && u.status === 'ปิด' ? 'selected' : ''}>ปิดใช้งาน (เข้าใช้ไม่ได้)</option></select></label>`}
    <button class="btn big primary" id="uGo">${u ? 'บันทึก' : 'สร้างผู้ใช้'}</button>
    <p class="hint">${isAdm ? 'ชื่อผู้ใช้ผู้ดูแล: ตัวอักษรอังกฤษ ตัวเลข . _ - ยาว 4-30 ตัว' : 'เลขบัตรประชาชนและหนังสือเดินทางเก็บบนอินเทอร์เน็ตเป็นค่า hash เท่านั้น (แสดงแค่บางหลัก) · เปลี่ยนชื่อผู้ใช้หรือปิดใช้งานแล้ว เครื่องที่เข้าสู่ระบบอยู่จะออกจากระบบทันที · สร้างแล้วแจ้งชื่อผู้ใช้ให้พนักงาน เข้าใช้ครั้งแรกเลือก “ครั้งแรก / ลืมรหัส”'}</p></div>`);
  const fill = () => { if (!$('#uKind')) return; const k = $('#uKind').value, em = A.emps.find(e => e.code === $('#uEmp').value) || {};
    $('#uName').placeholder = { code: em.code || 'รหัสพนักงาน', email: 'name@company.com', idcard: 'เลขบัตร 13 หลัก', passport: 'เลขหนังสือเดินทาง' }[k];
    if (!u && k === 'code') $('#uName').value = em.code || ''; else if (!u && k === 'email') $('#uName').value = $('#uMail').value; else if (!u) $('#uName').value = '';
    if (!u) { $('#uMail').value = $('#uMail').value || em.email || ''; $('#uPhone').value = $('#uPhone').value || em.phone || ''; } };
  if ($('#uKind')) { $('#uKind').onchange = fill; $('#uEmp').onchange = () => { $('#uMail').value = ''; $('#uPhone').value = ''; fill(); }; fill(); }
  else $('#uName').placeholder = 'ชื่อผู้ใช้ใหม่';
  $('#uGo').onclick = async e => {
    const b = isAdm ? { code: '#ADMIN', username: $('#uName').value.trim() }
      : { code: u ? u.code : $('#uEmp').value, kind: $('#uKind').value, username: $('#uName').value.trim(), email: $('#uMail').value.trim(), phone: $('#uPhone').value.trim(), status: $('#uSt').value };
    if (isAdm && !b.username) return toast('กรอกชื่อผู้ใช้ใหม่', true);
    busy(e.target, true, 'กำลังบันทึก…');
    try { await call('web.admin.save', b); toast(u ? 'บันทึกแล้ว' : 'สร้างผู้ใช้แล้ว'); pAdmUsers(); } catch (x) { toast(x.message, true); busy(e.target, false); }
  };
}
// act-as: the person's page with confidential things hidden; the admin's own session is kept to come back to
async function actAs(code) {
  try {
    const r = await call('web.admin.as', { code });
    S.asFrom = S.session; S.session = r.session; S.admin = false;
    await loadMe(); toast('ใช้งานแทน ' + r.name); go('home');
  } catch (x) { toast(x.message, true); }
}
function backToAdmin() { if (!S.asFrom) return; S.session = S.asFrom; S.asFrom = ''; S.me = null; S.admin = true; pAdmin(); }
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-uadd],[data-uedit],[data-uas],[data-ureset],[data-udel],[data-admin]'); if (!t) return;
  if (t.dataset.admin != null) { if (S.asFrom) return backToAdmin(); return pAdmin(); }
  if (t.dataset.uadd != null) return admForm('');
  if (t.dataset.uedit) return admForm(t.dataset.uedit);
  if (t.dataset.uas) return actAs(t.dataset.uas);
  const code = t.dataset.ureset || t.dataset.udel, del = !!t.dataset.udel, u = S.adm.users.find(x => x.code === code);
  if (!confirm(del ? `ลบผู้ใช้ของ ${u.name}? พนักงานจะเข้าใช้ไม่ได้จนกว่าจะสร้างใหม่` : `ให้ ${u.name} ยืนยันตัวตนใหม่? รหัสเดิมใช้ไม่ได้ และเครื่องที่เข้าสู่ระบบอยู่จะออกจากระบบ`)) return;
  busy(t, true, '…');
  try { await call(del ? 'web.admin.remove' : 'web.admin.reset', { code }); toast(del ? 'ลบผู้ใช้แล้ว' : 'ต้องยืนยันตัวตนใหม่แล้ว'); pAdmUsers(); } catch (x) { toast(x.message, true); busy(t, false); }
});

// ---------- add to the home screen (works like an app; Android shows the browser's own install, iPhone needs Share) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; const b = $('#inst'); if (b) b.hidden = false; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const inLine = () => /Line\//i.test(navigator.userAgent);
function installCard() {
  if (standalone()) return '';
  if (inLine()) return `<div class="card tip">💡 เปิดในเบราว์เซอร์จะใช้งานสะดวกกว่า: กด ⋮ หรือ ⋯ มุมขวาบน › <b>เปิดในเบราว์เซอร์</b> แล้วเพิ่มลงหน้าจอโฮม</div>`;
  if (isIos()) return `<div class="card tip">📲 <b>ใช้เหมือนแอป:</b> กดปุ่มแชร์ <b>⬆︎</b> ด้านล่าง › <b>เพิ่มไปยังหน้าจอโฮม</b></div>`;
  return `<div class="card tip">📲 <b>ใช้เหมือนแอป:</b> ${'<button class="btn" id="inst" ' + (installEvt ? '' : 'hidden') + '>ติดตั้งบนหน้าจอ</button>'} หรือกดเมนู ⋮ › <b>เพิ่มลงในหน้าจอหลัก</b></div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id === 'inst' && installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; e.target.hidden = true; }
  if (e.target.closest('[data-logout]')) logout();
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

// ---------- home ----------
function nextType() { return (S.me.today || []).length % 2 === 0 ? 'IN' : 'OUT'; }
function pHome() {
  const m = S.me, e = m.emp, logs = m.today || [], nt = nextType();
  view(`<div class="card hello"><div class="av">${esc((e.Name || '?').replace(/^(นาย|นางสาว|นาง)/, '')[0] || '?')}</div>
      <div><b>${esc(e.Name)}</b>${e.Nick ? ` <span class="muted">(${esc(e.Nick)})</span>` : ''}<div class="muted">${esc(e.Position || '')} · ${esc(e.Unit || '')}</div>
      <div class="muted">${esc(e.Code)}${e.ApproverName ? ' · ผู้อนุมัติ ' + esc(e.ApproverName) : ''}</div></div></div>
    ${m.dev ? `<div class="note warn"><b>${S.asFrom ? 'ผู้ดูแลระบบกำลังใช้งานแทน' : 'โหมดผู้พัฒนา'}</b> · ${esc(e.Name)} · ซ่อนข้อมูลส่วนบุคคล (ค่าจ้าง เหตุผล หมายเหตุ เอกสาร รูป ตำแหน่ง) · ลงเวลาแทนไม่ได้ · คำขอ/การอนุมัติที่ทำจะระบุว่าทำแทน${S.asFrom ? '<br><button class="btn" data-admin style="margin-top:8px">‹ กลับหน้าผู้ดูแล</button>' : ''}</div>` : ''}
    ${newsCard()}
    <div class="card today"><div class="row"><b>${thDay(todayIso())}</b>${m.shift ? `<span class="chip">${esc(m.shift.Name)} ${esc(m.shift.Start)}–${esc(m.shift.End)}</span>` : ''}</div>
      ${logs.length ? `<ul class="logs">${logs.map(l => `<li><span class="t ${l.Type === 'IN' ? 'in' : 'out'}">${l.Type === 'IN' ? 'เข้า' : 'ออก'}</span><b>${hhmm(l.CreatedAt)} น.</b>${l.InZone === 'Y' ? '<span class="ok">ในพื้นที่</span>' : `<span class="bad">นอกพื้นที่${l.DistanceM ? ' ' + l.DistanceM + ' ม.' : ''}</span>`}${l.Status === 'รอยืนยัน' ? '<span class="chip warn">รอหัวหน้ายืนยัน</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">วันนี้ยังไม่ได้ลงเวลา</p>'}
      ${m.dev ? '<p class="muted">ลงเวลาแทนพนักงานไม่ได้</p>' : `<button class="btn big ${nt === 'IN' ? 'primary' : 'out'}" data-go="clock">${nt === 'IN' ? '⏱ ลงเวลาเข้างาน' : '⏱ ลงเวลาออกงาน'}</button>`}</div>
    <div class="grid">
      <button class="tile" data-go="leave"><i>🗓</i>ขอลา</button>
      <button class="tile" data-go="ot"><i>🌙</i>ขอ OT</button>
      <button class="tile" data-go="fix"><i>✏️</i>ขอแก้เวลา</button>
      <button class="tile" data-go="mine"><i>📄</i>คำขอของฉัน${unseen().length ? `<em>${unseen().length}</em>` : ''}</button>
      ${m.approver ? `<button class="tile ap" data-go="approve"><i>✅</i>รออนุมัติ${m.waiting ? `<em>${m.waiting}</em>` : ''}</button>` : ''}
    </div>
    ${installCard()}
    <div class="foot-links">${m.dev ? '' : `<button class="mini" data-go="pin">🔑 ${S.me.hasSecret ? 'เปลี่ยน' : 'ตั้ง'}${credTh()}</button>`}<button class="mini" data-logout>${S.asFrom ? 'กลับหน้าผู้ดูแล' : m.dev ? 'ปิดโหมดผู้พัฒนา' : 'ออกจากระบบ'}</button></div>`);
}

// ---------- check in / out ----------
const metres = (a1, o1, a2, o2) => { const R = 6371000, r = x => x * Math.PI / 180, da = r(a2 - a1), dn = r(o2 - o1); const h = Math.sin(da / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function pClock() {
  const m = S.me, site = m.site, nt = nextType(), st = { pos: null, photo: '' };
  view(`${back}<div class="card"><h2>ลงเวลา${nt === 'IN' ? 'เข้างาน' : 'ออกงาน'}</h2>
    <div class="kv"><span>สถานที่</span><b>${site ? esc(site.Name) + ` (รัศมี ${esc(site.Radius)} ม.)` : 'ไม่ได้กำหนด'}</b></div>
    <div class="gps" id="gps"><i class="spin"></i>กำลังหาตำแหน่ง GPS…</div>
    <div class="selfie"><label class="cam" id="camLbl">📷 ถ่ายรูปตัวเอง${C.SELFIE_REQUIRED ? '' : ' (ไม่บังคับ)'}<input type="file" accept="image/*" capture="user" id="cam"></label><img id="pv" hidden></div>
    <label>หมายเหตุ (ถ้ามี)<input id="note" maxlength="200" placeholder="เช่น ปฏิบัติงานนอกสถานที่"></label>
    <button class="btn big primary" id="go" disabled>ยืนยันลงเวลา${nt === 'IN' ? 'เข้า' : 'ออก'}</button>
    <p class="hint">เวลาที่บันทึกคือเวลาของเซิร์ฟเวอร์ · ลงเวลานอกรัศมีได้ แต่ต้องให้หัวหน้ายืนยัน</p></div>`);
  const ready = () => { $('#go').disabled = !st.pos || (C.SELFIE_REQUIRED && !st.photo); };
  if (!navigator.geolocation) { $('#gps').innerHTML = '<span class="bad">อุปกรณ์นี้ไม่รองรับ GPS</span>'; return; }
  navigator.geolocation.getCurrentPosition(p => {
    st.pos = p.coords;
    const d = site ? Math.round(metres(p.coords.latitude, p.coords.longitude, +site.Lat, +site.Lng)) : null;
    const inZ = site && d - Math.min(p.coords.accuracy, 100) <= +site.Radius;
    $('#gps').innerHTML = `<b class="${inZ ? 'ok' : 'bad'}">${site ? (inZ ? '✓ อยู่ในพื้นที่' : '✗ อยู่นอกพื้นที่') : 'ไม่มีสถานที่ที่กำหนด'}</b>${d != null ? ` · ห่าง ${d.toLocaleString()} ม.` : ''} <span class="muted">(ความแม่นยำ ±${Math.round(p.coords.accuracy)} ม.)</span>`;
    ready();
  }, err => { $('#gps').innerHTML = `<span class="bad">หาตำแหน่งไม่ได้: ${esc(err.message)} · เปิด Location ในมือถือ และอนุญาตให้เบราว์เซอร์ใช้ตำแหน่ง แล้วลองใหม่</span>`; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  $('#cam').onchange = async e => { const f = e.target.files[0]; if (!f) return; st.photo = await shrink(f, 480); $('#pv').src = st.photo; $('#pv').hidden = false; $('#camLbl').classList.add('done'); ready(); };
  $('#go').onclick = async e => {
    busy(e.target, true, 'กำลังบันทึก…');
    try {
      const r = await call('web.clock', { lat: st.pos.latitude, lng: st.pos.longitude, accuracy: st.pos.accuracy, photo: st.photo, note: $('#note').value, type: nt, requestId: uid() });
      toast(`ลงเวลา${r.type === 'IN' ? 'เข้า' : 'ออก'} ${r.time || ''} น. ${r.inZone ? 'เรียบร้อย' : '(นอกพื้นที่ รอหัวหน้ายืนยัน)'}`);
      await loadMe(); go('home');
    } catch (x) { toast(x.message, true); busy(e.target, false); }
  };
}
// a photo made small enough to send (longest side `max` px, JPEG)
function shrink(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72)); };
    img.onerror = () => rej(new Error('อ่านรูปไม่ได้')); img.src = url;
  });
}

// ---------- requests ----------
// working days between two dates (the person's weekly days off and the published holidays are not counted)
function workDays(from, to, half) {
  if (!from || !to || to < from) return 0;
  if (half && from === to) return 0.5;
  const off = String(S.me.emp.OffDays || '0,6').split(',').filter(Boolean).map(Number), hol = new Set((S.me.holidays || []).map(h => h.Date));
  let n = 0; for (let d = new Date(from + 'T00:00:00'); isoOf(d) <= to; d.setDate(d.getDate() + 1)) if (!off.includes(d.getDay()) && !hol.has(isoOf(d))) n++;
  return n;
}
async function send(btn, action, data, okMsg) {
  busy(btn, true);
  try { await call(action, Object.assign({ requestId: uid() }, data)); toast(okMsg); await loadMe(); pMine(); }
  catch (x) { toast(x.message, true); busy(btn, false); }
}
// ---------- leave rights (sent up by HR; leave asked for since then is taken off here) ----------
const n1 = v => { const x = Math.round((+v || 0) * 100) / 100; return String(x); };
const isUnl = r => r.Quota === '' || r.Quota == null;
// this person's right to a type in the leave year: left now, after the leave asked since HR's figures
function rightOf(name, from) {
  const L = S.me.leave; if (!L || !L.rows || !L.rows.length) return null;
  const r = L.rows.find(x => x.Name === name); if (!r) return { none: true };
  const inYear = d => d >= r.CycleStart && d <= r.CycleEnd;
  const since = (L.recent || []).filter(x => x.LeaveType === name && inYear(x.From)).reduce((s, x) => s + (+x.Days || 0), 0);
  const left = isUnl(r) ? Infinity : (+r.Remaining || 0) - (+r.Pending || 0) - since;
  const paidLeft = r.PaidLeft === '' || r.PaidLeft == null ? Infinity : (+r.PaidLeft || 0) - (+r.Pending || 0) - since;
  return { r, since, left, paidLeft, outside: from && !inYear(from) };
}
function rightsCard() {
  const L = S.me.leave; if (!L || !L.rows || !L.rows.length) return '';
  return `<div class="card"><h2>สิทธิ์การลาของฉัน</h2><div class="muted">รอบ ${esc(L.rows[0].Cycle)} · ข้อมูลจากฝ่ายบุคคล ${esc(String(L.publishedAt || '').slice(0, 16).replace('T', ' '))}</div>
    <table class="rights"><tr><th>ประเภท</th><th>สิทธิ์</th><th>ใช้แล้ว</th><th>คงเหลือ</th></tr>
    ${L.rows.map(r => { const g = rightOf(r.Name), q = isUnl(r) ? 'ตามจริง' : n1(+r.Quota + (+r.CarryIn || 0));
      const pend = (+r.Pending || 0) + g.since;
      return `<tr class="${!isUnl(r) && +r.Quota === 0 && !(+r.Used > 0) ? 'off' : ''}"><td>${esc(r.Name)}${r.PaidLeft !== '' && +r.PayPct < 100 ? ` <span class="muted">(${esc(r.PayPct)}%)</span>` : ''}</td><td>${q}${+r.CarryIn ? `<div class="muted">ยกมา ${n1(r.CarryIn)}</div>` : ''}</td>
        <td>${n1(r.Used)}${pend ? `<div class="muted">รอ ${n1(pend)}</div>` : ''}</td><td><b class="${!isUnl(r) && g.left <= 0 && +r.Quota > 0 ? 'bad' : ''}">${isUnl(r) ? (r.PaidLeft === '' ? 'ตามจริง' : +r.PaidLeft === 0 ? 'ไม่ได้ค่าจ้าง' : `ได้ค่าจ้างอีก ${n1(Math.max(0, g.paidLeft))}`) : n1(Math.max(0, g.left))}</b>${!isUnl(r) && +r.Quota === 0 && r.Why ? `<div class="muted">${esc(r.Why)}</div>` : ''}</td></tr>`; }).join('')}
    </table></div>`;
}
function pLeave() {
  const t = todayIso(), L = S.me.leave, rows = L && L.rows && L.rows.length ? L.rows.filter(r => isUnl(r) || +r.Quota > 0 || +r.Used > 0) : null;
  const names = rows ? rows.map(r => r.Name) : C.LEAVE_TYPES;
  view(`${back}${rightsCard()}<div class="card"><h2>ขอลา</h2>
    <label>ประเภทการลา<select id="lt">${names.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
    <div id="lright" class="note"></div>
    <div class="two"><label>ตั้งแต่วันที่<input type="date" id="lf" value="${t}"></label><label>ถึงวันที่<input type="date" id="lto" value="${t}"></label></div>
    <label id="halfL">ช่วงเวลา<select id="lh"><option value="">เต็มวัน</option><option>ครึ่งวันเช้า</option><option>ครึ่งวันบ่าย</option><option value="H">รายชั่วโมง</option></select></label>
    <div class="two" id="lhT" hidden><label>ตั้งแต่เวลา<input type="time" id="lts" value="${esc(S.me.shift ? S.me.shift.Start : '08:00')}"></label><label>ถึงเวลา<input type="time" id="lte"></label></div>
    <div class="kv"><span id="ldL">จำนวนวันลา (ไม่นับวันหยุด)</span><b id="ld"></b></div>
    <label>เหตุผล<textarea id="lr" rows="2" maxlength="300"></textarea></label>
    <label class="cam" id="attL">📎 แนบรูปเอกสาร เช่น ใบรับรองแพทย์ (ถ้ามี)<input type="file" accept="image/*" id="att"></label><img id="pv" hidden>
    <button class="btn big primary" id="go">ส่งคำขอลา</button>
    <p class="hint">ผู้อนุมัติ: ${esc(S.me.emp.ApproverName || '-')} · ลาป่วยตั้งแต่ 3 วันทำงานขึ้นไป นายจ้างขอใบรับรองแพทย์ได้</p></div>`);
  let att = '';
  // what this request does to the right: days left after it, days beyond the paid ones
  const right = days => {
    const box = $('#lright'), g = rightOf($('#lt').value, $('#lf').value);
    box.className = 'note'; box.hidden = !g;
    if (!g) return;
    if (g.none) { box.textContent = 'ไม่มีประเภทการลานี้ในสิทธิ์ของคุณ'; box.className = 'note bad'; return; }
    if (g.outside) { box.textContent = `วันที่ลาอยู่นอกรอบ ${g.r.Cycle} · สิทธิ์ของรอบใหม่จะแสดงเมื่อฝ่ายบุคคลปรับข้อมูล`; box.className = 'note warn'; return; }
    const r = g.r, parts = [];
    if (isUnl(r)) parts.push(`${esc(r.Name)}: ลาได้ตามจริง`);
    else { const after = g.left - days; parts.push(`คงเหลือ <b>${n1(Math.max(0, g.left))}</b> วัน → หลังลานี้ <b>${n1(after)}</b> วัน`); if (after < 0) { parts.push(`<b>เกินสิทธิ์ ${n1(-after)} วัน</b> ผู้อนุมัติอาจไม่อนุมัติ`); box.className = 'note bad'; } }
    if (g.paidLeft !== Infinity) { const unpaid = Math.max(0, days - Math.max(0, g.paidLeft)); if (unpaid > 0) { parts.push(`${n1(unpaid)} วันไม่ได้รับค่าจ้าง`); if (box.className === 'note') box.className = 'note warn'; } else parts.push(`ได้รับค่าจ้างอีก ${n1(Math.max(0, g.paidLeft))} วัน`); }
    if (+r.PayPct < 100 && r.PaidLeft !== '' && +r.PaidLeft > 0) parts.push(`ค่าจ้างระหว่างลา ${esc(r.PayPct)}%`);
    if (r.Note) parts.push(`<span class="muted">${esc(r.Note)}</span>`);
    box.innerHTML = parts.join('<br>');
  };
  // by the hour: only types HR allows by the hour, one day; hours ÷ the hours of the person's shift = days
  const rowOf = () => (L && L.rows || []).find(r => r.Name === $('#lt').value);
  const hpd = () => { const r = rowOf(); if (r && +r.Hpd > 0) return +r.Hpd; const sh = S.me.shift; if (!sh) return 8; let m = minutesOf(sh.End) - minutesOf(sh.Start); if (m <= 0) m += 1440; return Math.max(1, (m - (+sh.BreakMin || 0)) / 60); };
  const hours = () => { const a = $('#lts').value, b = $('#lte').value; if (!a || !b || b <= a) return 0; return Math.round((minutesOf(b) - minutesOf(a)) / 60 * 100) / 100; };
  const amount = () => {
    const f = $('#lf').value, to = $('#lto').value, h = $('#lh').value;
    if (h !== 'H') return { days: workDays(f, to, h) };
    const n = workDays(f, f, ''), hrs = hours();
    return { days: n && hrs ? Math.min(1, Math.round(hrs / hpd() * 10000) / 10000) : 0, hrs };
  };
  const calc = () => {
    const f = $('#lf').value, to = $('#lto').value, r = rowOf(), hourOk = !!(r && r.Hourly === 'Y'), opt = $('#lh option[value=H]');
    opt.hidden = opt.disabled = !hourOk; if (!hourOk && $('#lh').value === 'H') $('#lh').value = '';
    $('#halfL').hidden = f !== to; if (f !== to) $('#lh').value = '';
    const hourly = $('#lh').value === 'H'; $('#lhT').hidden = !hourly;
    const a = amount();
    $('#ldL').textContent = hourly ? `จำนวนชั่วโมงลา (${n1(hpd())} ชม. = 1 วัน)` : 'จำนวนวันลา (ไม่นับวันหยุด)';
    $('#ld').textContent = hourly ? (a.hrs ? `${a.hrs} ชม. = ${Math.round(a.days * 100) / 100} วัน` : '-') : a.days + ' วัน';
    right(a.days);
  };
  ['#lt', '#lf', '#lto', '#lh', '#lts', '#lte'].forEach(s => $(s).onchange = () => { if ($('#lto').value < $('#lf').value) $('#lto').value = $('#lf').value; calc(); }); calc();
  $('#att').onchange = async e => { const f = e.target.files[0]; if (!f) return; att = await shrink(f, 1200); $('#pv').src = att; $('#pv').hidden = false; $('#attL').classList.add('done'); };
  $('#go').onclick = e => {
    const a = amount(), hourly = $('#lh').value === 'H', r = rowOf();
    if (hourly && !a.hrs) return toast('ระบุเวลาเริ่มและเวลาสิ้นสุด', true);
    if (hourly && r && +r.MinHours && a.hrs < +r.MinHours) return toast(`${r.Name} ลารายชั่วโมงขั้นต่ำ ${r.MinHours} ชม.`, true);
    if (!a.days) return toast(hourly ? 'วันที่เลือกเป็นวันหยุด' : 'ช่วงวันที่เลือกเป็นวันหยุดทั้งหมด', true);
    send(e.target, 'web.leave', Object.assign({ leaveType: $('#lt').value, from: $('#lf').value, to: $('#lto').value, half: hourly ? '' : $('#lh').value, days: a.days, reason: $('#lr').value, attach: att },
      hourly ? { hours: a.hrs, tStart: $('#lts').value, tEnd: $('#lte').value } : {}), 'ส่งคำขอลาแล้ว รออนุมัติ');
  };
}
const minutesOf = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
function pOt() {
  const sh = S.me.shift;
  view(`${back}<div class="card"><h2>ขอทำงานล่วงเวลา (OT)</h2>
    <label>วันที่<input type="date" id="od" value="${todayIso()}"></label>
    <div class="two"><label>เริ่ม<input type="time" id="os" value="${esc(sh ? sh.End : '17:00')}"></label><label>ถึง<input type="time" id="oe" value=""></label></div>
    <div class="kv"><span>จำนวนชั่วโมง</span><b id="oh">-</b></div>
    <label>งานที่ทำ / เหตุผล<textarea id="or" rows="2" maxlength="300"></textarea></label>
    <button class="btn big primary" id="go">ส่งคำขอ OT</button>
    <p class="hint">ขออนุมัติก่อนทำ · ระบบจ่ายตามชั่วโมงที่อนุมัติและไม่เกินเวลาที่ลงออกจริง · OT รวมทำงานวันหยุดไม่เกิน 36 ชม./สัปดาห์</p></div>`);
  const hrs = () => { if (!$('#oe').value) return 0; let d = minutesOf($('#oe').value) - minutesOf($('#os').value); if (d <= 0) d += 1440; return Math.round(d / 60 * 100) / 100; };
  ['#os', '#oe'].forEach(s => $(s).oninput = () => $('#oh').textContent = hrs() ? hrs() + ' ชม.' : '-');
  $('#go').onclick = e => { if (!hrs()) return toast('ระบุเวลาสิ้นสุด', true); send(e.target, 'web.ot', { date: $('#od').value, start: $('#os').value, end: $('#oe').value, hours: hrs(), reason: $('#or').value }, 'ส่งคำขอ OT แล้ว รออนุมัติ'); };
}
function pFix() {
  view(`${back}<div class="card"><h2>ขอแก้เวลา (ลืมลงเวลา)</h2>
    <label>วันที่<input type="date" id="fd" value="${todayIso()}" max="${todayIso()}"></label>
    <div class="two"><label>รายการ<select id="ft"><option value="IN">เวลาเข้า</option><option value="OUT">เวลาออก</option></select></label><label>เวลา<input type="time" id="fti"></label></div>
    <label>เหตุผล (จำเป็น)<textarea id="fr" rows="2" maxlength="300" placeholder="เช่น โทรศัพท์แบตหมด"></textarea></label>
    <button class="btn big primary" id="go">ส่งคำขอแก้เวลา</button></div>`);
  $('#go').onclick = e => send(e.target, 'web.fix', { date: $('#fd').value, type: $('#ft').value, time: $('#fti').value, reason: $('#fr').value }, 'ส่งคำขอแก้เวลาแล้ว รออนุมัติ');
}
// one line of what a record is about
function summary(r) {
  switch (r.sheet) {
    case 'TimeLog': return `${r.Type === 'IN' ? 'เข้า' : 'ออก'} ${hhmm(r.CreatedAt)} น. · ${r.InZone === 'Y' ? 'ในพื้นที่' : 'นอกพื้นที่ ' + (r.DistanceM || '') + ' ม.'}`;
    case 'LeaveReq': return `${r.LeaveType} ${thDate(r.From)}${r.To !== r.From ? ' – ' + thDate(r.To) : ''} ${+r.Hours > 0 ? `${r.StartTime}–${r.EndTime} (${r.Hours} ชม.)` : `(${r.Days} วัน)${r.Half ? ' ' + r.Half : ''}`}`;
    case 'OTReq': return `${thDate(r.Date)} ${r.Start}–${r.End} (${r.Hours} ชม.)`;
    case 'TimeFix': return `${thDate(r.Date)} ${r.Type === 'IN' ? 'เข้า' : 'ออก'} ${r.Time} น.`;
  }
  return '';
}
const stCls = s => /^อนุมัติ|ยืนยันแล้ว|บันทึกแล้ว/.test(s) ? 'ok' : /ไม่|ยกเลิก/.test(s) ? 'bad' : 'warn';
async function pMine() {
  view(`${back}<div class="card"><h2>คำขอและการลงเวลาของฉัน</h2><div id="list" class="loading"><i></i>กำลังโหลด…</div></div>`);
  try {
    const r = await call('web.mine');
    markSeen();   // the decisions are in front of the person now
    $('#list').className = '';
    $('#list').innerHTML = r.rows.length ? r.rows.map(x => `<div class="item"><div class="row"><span class="kind">${KIND[x.sheet]}</span><span class="st ${stCls(x.Status)}">${esc(x.Status)}</span></div>
      <div>${esc(summary(x))}</div>${x.Reason ? `<div class="muted">${esc(x.Reason)}</div>` : ''}${x.ApproveNote ? `<div class="muted">หมายเหตุผู้อนุมัติ: ${esc(x.ApproveNote)}</div>` : ''}
      <div class="row"><span class="muted">ส่งเมื่อ ${thDate(x.CreatedAt)} ${hhmm(x.CreatedAt)} น.</span>${x.Status === 'รออนุมัติ' && KIND[x.sheet] && x.sheet !== 'TimeLog' ? `<button class="mini" data-cancel="${esc(x.sheet)}|${esc(x.RequestID)}">ยกเลิก</button>` : ''}</div></div>`).join('') : '<p class="muted">ยังไม่มีรายการ</p>';
  } catch (x) { if (!x.handled && $('#list')) $('#list').innerHTML = `<p class="bad">${esc(x.message)}</p>`; }
}
document.addEventListener('click', async e => {
  const c = e.target.closest('[data-cancel]'); if (!c) return;
  if (!confirm('ยกเลิกคำขอนี้?')) return;
  const [sheet, id] = c.dataset.cancel.split('|'); busy(c, true, '…');
  try { await call('web.cancel', { sheet, id }); toast('ยกเลิกแล้ว'); pMine(); } catch (x) { toast(x.message, true); busy(c, false); }
});

// ---------- approvals ----------
async function pApprove() {
  view(`${back}<div class="card"><h2>รออนุมัติ</h2><div id="list" class="loading"><i></i>กำลังโหลด…</div></div>`);
  try {
    const r = await call('web.pending');
    $('#list').className = '';
    $('#list').innerHTML = r.rows.length ? r.rows.map(x => `<div class="item" data-id="${esc(x.RequestID)}"><div class="row"><span class="kind">${x.sheet === 'TimeLog' ? 'ลงเวลานอกพื้นที่' : KIND[x.sheet]}</span><span class="muted">${thDate(x.CreatedAt)} ${hhmm(x.CreatedAt)}</span></div>
      <b>${esc(x.EmpName)}</b><div>${esc(summary(x))}</div>${x.Reason || x.Note ? `<div class="muted">${esc(x.Reason || x.Note)}</div>` : ''}
      ${x.PhotoUrl || x.AttachUrl ? `<div class="muted">มีรูปแนบ (ดูได้ในระบบฝ่ายบุคคล)</div>` : ''}
      <input class="why" placeholder="หมายเหตุ (จำเป็นถ้าไม่อนุมัติ)" maxlength="200">
      <div class="row"><button class="btn no" data-dec="no|${esc(x.sheet)}|${esc(x.RequestID)}">${x.sheet === 'TimeLog' ? 'ไม่รับรอง' : 'ไม่อนุมัติ'}</button><button class="btn primary" data-dec="yes|${esc(x.sheet)}|${esc(x.RequestID)}">${x.sheet === 'TimeLog' ? 'ยืนยัน' : 'อนุมัติ'}</button></div></div>`).join('') : '<p class="muted">ไม่มีรายการรออนุมัติ 🎉</p>';
  } catch (x) { if (!x.handled && $('#list')) $('#list').innerHTML = `<p class="bad">${esc(x.message)}</p>`; }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-dec]'); if (!b) return;
  const [decision, sheet, id] = b.dataset.dec.split('|'), item = b.closest('.item'), note = item.querySelector('.why').value.trim();
  if (decision === 'no' && !note) { item.querySelector('.why').focus(); return toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ', true); }
  busy(b, true, '…');
  try { const r = await call('web.decide', { sheet, id, decision, note }); toast(r.status); item.remove(); S.me.waiting = Math.max(0, (S.me.waiting || 1) - 1); if (!$('#list .item')) $('#list').innerHTML = '<p class="muted">ไม่มีรายการรออนุมัติ 🎉</p>'; }
  catch (x) { toast(x.message, true); busy(b, false); }
});

boot();
