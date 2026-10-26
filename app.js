// © 2569 S.SUPHAWAN. All rights reserved. Developed by MEAWMEAW
// 4Source HR · LINE page (LIFF): check in/out with GPS + selfie, leave / OT / time-correction requests, approvals.
// Everything goes to the Apps Script web app (gas\Code.gs) with the person's LINE ID token; the server checks it with
// LINE, finds the employee linked to that LINE account, and keeps the time of every record itself.
'use strict';
const C = window.HR_CONFIG;
const S = { token: '', me: null };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoOf(new Date());
const thDate = iso => iso ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(iso.slice(0, 10) + 'T00:00:00')) : '';
const thDay = iso => new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T00:00:00'));
const hhmm = s => String(s || '').slice(11, 16);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const KIND = { TimeLog: 'ลงเวลา', LeaveReq: 'ขอลา', OTReq: 'ขอ OT', TimeFix: 'ขอแก้เวลา', DeviceBind: 'ผูกบัญชี LINE' };

// ---------- server ----------
async function call(action, data = {}) {
  let r;
  try { r = await fetch(C.GAS_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action, idToken: S.token }, data)) }); }
  catch { throw new Error('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
  const j = await r.json().catch(() => ({ ok: false, error: 'ระบบตอบกลับผิดรูปแบบ' }));
  if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
  return j;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = (err ? '⚠ ' : '✓ ') + msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', err ? 6000 : 3500);
}
const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; if (on) { btn._t = btn.innerHTML; btn.innerHTML = label || 'กำลังส่ง…'; } else if (btn._t) btn.innerHTML = btn._t; };
function view(html) { $('#app').innerHTML = html; window.scrollTo(0, 0); }
const back = `<button class="back" data-go="home">‹ กลับหน้าหลัก</button>`;

// ---------- start ----------
async function boot() {
  const q = new URLSearchParams(location.search);
  try {
    if (q.get('dev')) S.token = 'dev:' + q.get('dev');   // testing in a browser (the server accepts it only in DEV_MODE)
    else {
      if (!C.LIFF_ID) throw new Error('ยังไม่ได้ตั้งค่า LIFF_ID ในไฟล์ config.js');
      await liff.init({ liffId: C.LIFF_ID });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      S.token = liff.getIDToken();
    }
    await loadMe();
    go(q.get('p') || 'home');
  } catch (e) { view(`<div class="card err-card"><h2>เปิดหน้าไม่สำเร็จ</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">ลองใหม่</button></div>`); }
}
async function loadMe() { S.me = await call('liff.me'); $('#org').textContent = S.me.org || ''; }
function go(p) {
  if (!S.me.bound) return pBind();
  ({ home: pHome, clock: pClock, leave: pLeave, ot: pOt, fix: pFix, mine: pMine, approve: pApprove }[p] || pHome)();
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

// ---------- link LINE to an employee ----------
function pBind() {
  const m = S.me;
  view(`<div class="card"><h2>ผูกบัญชี LINE กับพนักงาน</h2>
    <p class="muted">สวัสดี ${esc(m.lineName || '')} · ทำครั้งเดียว เพื่อให้ระบบรู้ว่าบัญชี LINE นี้เป็นของพนักงานคนไหน</p>
    ${m.pendingBind ? '<div class="note warn">ส่งคำขอผูกบัญชีแล้ว รอฝ่ายบุคคลตรวจสอบ (เมื่ออนุมัติแล้ว ปิดแล้วเปิดหน้านี้ใหม่)</div>' : ''}
    <label>รหัสพนักงาน<input id="bCode" autocapitalize="characters" placeholder="เช่น EMP0012"></label>
    <label>เลขบัตรประชาชน 4 หลักท้าย<input id="bLast4" inputmode="numeric" maxlength="4" placeholder="xxxx"></label>
    <button class="btn primary" id="bGo">ผูกบัญชี</button>
    <p class="hint">ระบบไม่เก็บเลขบัตรของคุณบนอินเทอร์เน็ต ใช้ตรวจเทียบกับข้อมูลที่ฝ่ายบุคคลมีเท่านั้น · กรอกผิดได้ไม่เกิน 5 ครั้งต่อชั่วโมง</p></div>`);
  $('#bGo').onclick = async e => {
    busy(e.target, true);
    try {
      const r = await call('liff.bind', { code: $('#bCode').value, last4: $('#bLast4').value, requestId: uid() });
      if (r.linked) { toast('ผูกบัญชีเรียบร้อย'); await loadMe(); go('home'); }
      else { toast('ส่งคำขอแล้ว รอฝ่ายบุคคลตรวจสอบ'); S.me.pendingBind = true; pBind(); }
    } catch (x) { toast(x.message, true); busy(e.target, false); }
  };
}

// ---------- home ----------
function nextType() { return (S.me.today || []).length % 2 === 0 ? 'IN' : 'OUT'; }
function pHome() {
  const m = S.me, e = m.emp, logs = m.today || [], nt = nextType();
  view(`<div class="card hello"><div class="av">${esc((e.Name || '?').replace(/^(นาย|นางสาว|นาง)/, '')[0] || '?')}</div>
      <div><b>${esc(e.Name)}</b>${e.Nick ? ` <span class="muted">(${esc(e.Nick)})</span>` : ''}<div class="muted">${esc(e.Position || '')} · ${esc(e.Unit || '')}</div>
      <div class="muted">${esc(e.Code)}${e.ApproverName ? ' · ผู้อนุมัติ ' + esc(e.ApproverName) : ''}</div></div></div>
    <div class="card today"><div class="row"><b>${thDay(todayIso())}</b>${m.shift ? `<span class="chip">${esc(m.shift.Name)} ${esc(m.shift.Start)}–${esc(m.shift.End)}</span>` : ''}</div>
      ${logs.length ? `<ul class="logs">${logs.map(l => `<li><span class="t ${l.Type === 'IN' ? 'in' : 'out'}">${l.Type === 'IN' ? 'เข้า' : 'ออก'}</span><b>${hhmm(l.CreatedAt)} น.</b>${l.InZone === 'Y' ? '<span class="ok">ในพื้นที่</span>' : `<span class="bad">นอกพื้นที่${l.DistanceM ? ' ' + l.DistanceM + ' ม.' : ''}</span>`}${l.Status === 'รอยืนยัน' ? '<span class="chip warn">รอหัวหน้ายืนยัน</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">วันนี้ยังไม่ได้ลงเวลา</p>'}
      <button class="btn big ${nt === 'IN' ? 'primary' : 'out'}" data-go="clock">${nt === 'IN' ? '⏱ ลงเวลาเข้างาน' : '⏱ ลงเวลาออกงาน'}</button></div>
    <div class="grid">
      <button class="tile" data-go="leave"><i>🗓</i>ขอลา</button>
      <button class="tile" data-go="ot"><i>🌙</i>ขอ OT</button>
      <button class="tile" data-go="fix"><i>✏️</i>ขอแก้เวลา</button>
      <button class="tile" data-go="mine"><i>📄</i>คำขอของฉัน</button>
      ${m.approver ? `<button class="tile ap" data-go="approve"><i>✅</i>รออนุมัติ${m.waiting ? `<em>${m.waiting}</em>` : ''}</button>` : ''}
    </div>
    ${m.dev ? '<p class="hint center">โหมดทดสอบ (DEV) · ไม่ได้เปิดจาก LINE</p>' : ''}`);
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
  }, err => { $('#gps').innerHTML = `<span class="bad">หาตำแหน่งไม่ได้: ${esc(err.message)} · เปิด Location และอนุญาตให้ LINE ใช้ตำแหน่ง แล้วลองใหม่</span>`; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  $('#cam').onchange = async e => { const f = e.target.files[0]; if (!f) return; st.photo = await shrink(f, 480); $('#pv').src = st.photo; $('#pv').hidden = false; $('#camLbl').classList.add('done'); ready(); };
  $('#go').onclick = async e => {
    busy(e.target, true, 'กำลังบันทึก…');
    try {
      const r = await call('liff.clock', { lat: st.pos.latitude, lng: st.pos.longitude, accuracy: st.pos.accuracy, photo: st.photo, note: $('#note').value, type: nt, requestId: uid() });
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
const n1 = v => { const x = Math.round((+v || 0) * 10) / 10; return String(x); };
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
    <label id="halfL">ช่วงเวลา<select id="lh"><option value="">เต็มวัน</option><option>ครึ่งวันเช้า</option><option>ครึ่งวันบ่าย</option></select></label>
    <div class="kv"><span>จำนวนวันลา (ไม่นับวันหยุด)</span><b id="ld"></b></div>
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
  const calc = () => { const f = $('#lf').value, to = $('#lto').value; $('#halfL').hidden = f !== to; if (f !== to) $('#lh').value = ''; const d = workDays(f, to, $('#lh').value); $('#ld').textContent = d + ' วัน'; right(d); };
  ['#lt', '#lf', '#lto', '#lh'].forEach(s => $(s).onchange = () => { if ($('#lto').value < $('#lf').value) $('#lto').value = $('#lf').value; calc(); }); calc();
  $('#att').onchange = async e => { const f = e.target.files[0]; if (!f) return; att = await shrink(f, 1200); $('#pv').src = att; $('#pv').hidden = false; $('#attL').classList.add('done'); };
  $('#go').onclick = e => {
    const days = workDays($('#lf').value, $('#lto').value, $('#lh').value);
    if (!days) return toast('ช่วงวันที่เลือกเป็นวันหยุดทั้งหมด', true);
    send(e.target, 'liff.leave', { leaveType: $('#lt').value, from: $('#lf').value, to: $('#lto').value, half: $('#lh').value, days, reason: $('#lr').value, attach: att }, 'ส่งคำขอลาแล้ว รออนุมัติ');
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
  $('#go').onclick = e => { if (!hrs()) return toast('ระบุเวลาสิ้นสุด', true); send(e.target, 'liff.ot', { date: $('#od').value, start: $('#os').value, end: $('#oe').value, hours: hrs(), reason: $('#or').value }, 'ส่งคำขอ OT แล้ว รออนุมัติ'); };
}
function pFix() {
  view(`${back}<div class="card"><h2>ขอแก้เวลา (ลืมลงเวลา)</h2>
    <label>วันที่<input type="date" id="fd" value="${todayIso()}" max="${todayIso()}"></label>
    <div class="two"><label>รายการ<select id="ft"><option value="IN">เวลาเข้า</option><option value="OUT">เวลาออก</option></select></label><label>เวลา<input type="time" id="fti"></label></div>
    <label>เหตุผล (จำเป็น)<textarea id="fr" rows="2" maxlength="300" placeholder="เช่น โทรศัพท์แบตหมด"></textarea></label>
    <button class="btn big primary" id="go">ส่งคำขอแก้เวลา</button></div>`);
  $('#go').onclick = e => send(e.target, 'liff.fix', { date: $('#fd').value, type: $('#ft').value, time: $('#fti').value, reason: $('#fr').value }, 'ส่งคำขอแก้เวลาแล้ว รออนุมัติ');
}
// one line of what a record is about
function summary(r) {
  switch (r.sheet) {
    case 'TimeLog': return `${r.Type === 'IN' ? 'เข้า' : 'ออก'} ${hhmm(r.CreatedAt)} น. · ${r.InZone === 'Y' ? 'ในพื้นที่' : 'นอกพื้นที่ ' + (r.DistanceM || '') + ' ม.'}`;
    case 'LeaveReq': return `${r.LeaveType} ${thDate(r.From)}${r.To !== r.From ? ' – ' + thDate(r.To) : ''} (${r.Days} วัน)${r.Half ? ' ' + r.Half : ''}`;
    case 'OTReq': return `${thDate(r.Date)} ${r.Start}–${r.End} (${r.Hours} ชม.)`;
    case 'TimeFix': return `${thDate(r.Date)} ${r.Type === 'IN' ? 'เข้า' : 'ออก'} ${r.Time} น.`;
    case 'DeviceBind': return `ผูกบัญชี LINE ${r.DisplayName || ''}`;
  }
  return '';
}
const stCls = s => /^อนุมัติ|ยืนยันแล้ว|บันทึกแล้ว/.test(s) ? 'ok' : /ไม่|ยกเลิก/.test(s) ? 'bad' : 'warn';
async function pMine() {
  view(`${back}<div class="card"><h2>คำขอและการลงเวลาของฉัน</h2><div id="list" class="loading"><i></i>กำลังโหลด…</div></div>`);
  try {
    const r = await call('liff.mine');
    $('#list').className = '';
    $('#list').innerHTML = r.rows.length ? r.rows.map(x => `<div class="item"><div class="row"><span class="kind">${KIND[x.sheet]}</span><span class="st ${stCls(x.Status)}">${esc(x.Status)}</span></div>
      <div>${esc(summary(x))}</div>${x.Reason ? `<div class="muted">${esc(x.Reason)}</div>` : ''}${x.ApproveNote ? `<div class="muted">หมายเหตุผู้อนุมัติ: ${esc(x.ApproveNote)}</div>` : ''}
      <div class="row"><span class="muted">ส่งเมื่อ ${thDate(x.CreatedAt)} ${hhmm(x.CreatedAt)} น.</span>${x.Status === 'รออนุมัติ' && x.sheet !== 'DeviceBind' ? `<button class="mini" data-cancel="${esc(x.sheet)}|${esc(x.RequestID)}">ยกเลิก</button>` : ''}</div></div>`).join('') : '<p class="muted">ยังไม่มีรายการ</p>';
  } catch (x) { $('#list').innerHTML = `<p class="bad">${esc(x.message)}</p>`; }
}
document.addEventListener('click', async e => {
  const c = e.target.closest('[data-cancel]'); if (!c) return;
  if (!confirm('ยกเลิกคำขอนี้?')) return;
  const [sheet, id] = c.dataset.cancel.split('|'); busy(c, true, '…');
  try { await call('liff.cancel', { sheet, id }); toast('ยกเลิกแล้ว'); pMine(); } catch (x) { toast(x.message, true); busy(c, false); }
});

// ---------- approvals ----------
async function pApprove() {
  view(`${back}<div class="card"><h2>รออนุมัติ</h2><div id="list" class="loading"><i></i>กำลังโหลด…</div></div>`);
  try {
    const r = await call('liff.pending');
    $('#list').className = '';
    $('#list').innerHTML = r.rows.length ? r.rows.map(x => `<div class="item" data-id="${esc(x.RequestID)}"><div class="row"><span class="kind">${x.sheet === 'TimeLog' ? 'ลงเวลานอกพื้นที่' : KIND[x.sheet]}</span><span class="muted">${thDate(x.CreatedAt)} ${hhmm(x.CreatedAt)}</span></div>
      <b>${esc(x.EmpName)}</b><div>${esc(summary(x))}</div>${x.Reason || x.Note ? `<div class="muted">${esc(x.Reason || x.Note)}</div>` : ''}
      ${x.PhotoUrl || x.AttachUrl ? `<div class="muted">มีรูปแนบ (ดูได้ในระบบฝ่ายบุคคล)</div>` : ''}
      <input class="why" placeholder="หมายเหตุ (จำเป็นถ้าไม่อนุมัติ)" maxlength="200">
      <div class="row"><button class="btn no" data-dec="no|${esc(x.sheet)}|${esc(x.RequestID)}">${x.sheet === 'TimeLog' ? 'ไม่รับรอง' : 'ไม่อนุมัติ'}</button><button class="btn primary" data-dec="yes|${esc(x.sheet)}|${esc(x.RequestID)}">${x.sheet === 'TimeLog' ? 'ยืนยัน' : 'อนุมัติ'}</button></div></div>`).join('') : '<p class="muted">ไม่มีรายการรออนุมัติ 🎉</p>';
  } catch (x) { $('#list').innerHTML = `<p class="bad">${esc(x.message)}</p>`; }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-dec]'); if (!b) return;
  const [decision, sheet, id] = b.dataset.dec.split('|'), item = b.closest('.item'), note = item.querySelector('.why').value.trim();
  if (decision === 'no' && !note) { item.querySelector('.why').focus(); return toast('กรุณาระบุเหตุผลที่ไม่อนุมัติ', true); }
  busy(b, true, '…');
  try { const r = await call('liff.decide', { sheet, id, decision, note }); toast(r.status); item.remove(); S.me.waiting = Math.max(0, (S.me.waiting || 1) - 1); if (!$('#list .item')) $('#list').innerHTML = '<p class="muted">ไม่มีรายการรออนุมัติ 🎉</p>'; }
  catch (x) { toast(x.message, true); busy(b, false); }
});

boot();
