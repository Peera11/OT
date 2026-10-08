/* =========================================================
   OT TRACKER — script.js  (Vanilla JS + localStorage)

   กติกา:
   - ทำ OT 1 วัน = 3 ชั่วโมง (คงที่)
   - เงิน OT = จำนวนวันที่ทำ OT x เงิน OT ต่อวัน (ผู้ใช้กำหนดเองใน Settings)
   - สรุปเงินคิดเป็น "รอบ" เช่น 26 - 25 ของเดือนถัดไป (เลือกวันเริ่มรอบได้)

   รูปแบบข้อมูลที่เก็บ:
   {
     otPay: 500,                      // เงิน OT ต่อวัน (ทำ 3 ชม.)
     startDay: 26,                    // วันเริ่มรอบเงิน (1 - 28)
     records: {
       "2026-10-08": { status: "ot" },
       "2026-10-06": { status: "no" }
     }
   }
   ========================================================= */

'use strict';

/* ---------- ค่าคงที่ ---------- */
const STORAGE_KEY = 'ot-tracker-v1';
const OT_HOURS = 3;           // ทำ OT 1 วัน = 3 ชม.
const DEFAULT_PAY = 500;      // ค่าเริ่มต้น แก้ได้ในหน้า Settings
const DEFAULT_START_DAY = 26; // รอบเงินเริ่มวันที่ 26

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/* ---------- ตัวช่วยเลือก element ---------- */
const $ = (id) => document.getElementById(id);

/* ---------- state ---------- */
let state = loadState();

// เดือนที่กำลังดูในปฏิทิน
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();

// รอบเงินที่กำลังดูในส่วนสรุป (เก็บเป็น "เดือนที่รอบนั้นเริ่ม")
let sumYear, sumMonth;
resetSummaryToCurrent();

// ข้อมูลของหน้าต่างแก้ไข
let editKey = null;        // วันที่ที่กำลังแก้ ("YYYY-MM-DD")
let editStatus = 'ot';     // 'ot' หรือ 'no'

// การกระทำที่รอผู้ใช้กดยืนยัน (เช่น ลบ)
let confirmAction = null;

/* =========================================================
   1) localStorage
   ========================================================= */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);

      // เงิน OT ต่อวัน (ข้อมูลเวอร์ชันเก่าเก็บเป็น "ต่อชั่วโมง" -> แปลงเป็นต่อวัน)
      let pay = Number(data.otPay);
      if (data.otPay === undefined || !(pay >= 0)) {
        pay = data.rate !== undefined && Number(data.rate) >= 0
          ? Number(data.rate) * OT_HOURS
          : DEFAULT_PAY;
      }

      let startDay = Math.round(Number(data.startDay));
      if (!(startDay >= 1 && startDay <= 28)) startDay = DEFAULT_START_DAY;

      return {
        otPay: pay,
        startDay: startDay,
        records: data.records && typeof data.records === 'object' ? data.records : {},
      };
    }
  } catch (err) {
    console.warn('อ่านข้อมูลไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', err);
  }
  return { otPay: DEFAULT_PAY, startDay: DEFAULT_START_DAY, records: {} };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // เช่น โหมดส่วนตัวบางเบราว์เซอร์ที่ไม่ให้เขียน
    showToast('บันทึกไม่สำเร็จ');
  }
}

/* =========================================================
   2) ตัวช่วยเรื่องวันที่
   ========================================================= */

const pad = (n) => String(n).padStart(2, '0');

// Date -> "YYYY-MM-DD" (ใช้เวลาท้องถิ่น ไม่ใช่ UTC กันวันเพี้ยน)
function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "YYYY-MM-DD" -> Date
function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "8 ต.ค." (ถ้าไม่ใช่ปีนี้ จะต่อท้ายด้วยปี)
function formatShort(key) {
  const d = fromKey(key);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

// "8 ต.ค. 2026"
function formatFull(key) {
  const d = fromKey(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const formatNumber = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/* =========================================================
   3) รอบเงิน (เช่น 26 - 25 ของเดือนถัดไป)
   ========================================================= */

// รอบเงินที่ "เริ่ม" ในเดือน (y, m) -> วันเริ่ม และ วันสิ้นสุด
// เช่น startDay = 26, เดือน ก.ย. 2026 -> 26 ก.ย. ถึง 25 ต.ค.
function periodRange(y, m) {
  const start = new Date(y, m, state.startDay);
  const end = new Date(y, m + 1, state.startDay - 1);  // วันก่อนวันเริ่มของเดือนถัดไป
  return { start, end };
}

// วันที่ที่กำหนดอยู่ในรอบที่เริ่มเดือนไหน
function periodStartMonthOf(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  // ถ้ายังไม่ถึงวันเริ่มรอบของเดือนนี้ แปลว่าอยู่ในรอบที่เริ่มเดือนก่อน
  if (date.getDate() < state.startDay) first.setMonth(first.getMonth() - 1);
  return first;
}

function resetSummaryToCurrent() {
  const p = periodStartMonthOf(new Date());
  sumYear = p.getFullYear();
  sumMonth = p.getMonth();
}

// "26 ก.ย. – 25 ต.ค. 2026"
function formatRange(start, end) {
  const s = `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]}`;
  const e = `${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
  if (start.getFullYear() === end.getFullYear()) return `${s} – ${e} ${end.getFullYear()}`;
  return `${s} ${start.getFullYear()} – ${e} ${end.getFullYear()}`;
}

/* =========================================================
   4) การบันทึก / ลบ
   ========================================================= */

function setRecord(key, status) {
  state.records[key] = { status: status };   // 'ot' หรือ 'no'
  saveState();
  renderAll();
}

function deleteRecord(key) {
  delete state.records[key];
  saveState();
  renderAll();
}

/* =========================================================
   5) แสดงผล (render)
   ========================================================= */

function renderAll() {
  renderToday();
  renderSummary();
  renderCalendar();
  renderHistory();
}

/* ---- หน้าแรก: เดือน/วันที่ปัจจุบัน + สถานะวันนี้ ---- */
function renderToday() {
  const today = new Date();
  const key = toKey(today);

  $('today-month').textContent = `${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  $('today-date').textContent = formatFull(key);

  const rec = state.records[key];
  let text = 'ยังไม่ได้บันทึกวันนี้';
  if (rec) {
    text = rec.status === 'ot'
      ? `บันทึกแล้ว: ✅ OT ${OT_HOURS} ชม.`
      : 'บันทึกแล้ว: ❌ ไม่ทำ OT';
  }
  $('today-status').textContent = text;
}

/* ---- สรุปของรอบเงินที่เปิดอยู่ ---- */
function renderSummary() {
  const { start, end } = periodRange(sumYear, sumMonth);
  const from = toKey(start);
  const to = toKey(end);

  let otDays = 0, noDays = 0;
  for (const [key, rec] of Object.entries(state.records)) {
    if (key < from || key > to) continue;      // นอกรอบนี้ (เทียบข้อความ YYYY-MM-DD ได้เลย)
    if (rec.status === 'ot') otDays++;
    else noDays++;
  }

  // ถ้าเป็นรอบปัจจุบัน เขียนว่า "สรุปรอบนี้"
  const cur = periodStartMonthOf(new Date());
  const isCurrent = cur.getFullYear() === sumYear && cur.getMonth() === sumMonth;
  $('summary-title').textContent = isCurrent ? 'สรุปรอบนี้' : 'สรุปรอบเงิน';
  $('summary-range').textContent = formatRange(start, end);

  $('stat-days').textContent = otDays;
  $('stat-hours').textContent = formatNumber(otDays * OT_HOURS);
  $('stat-money').textContent = formatNumber(otDays * state.otPay);
  $('stat-no').textContent = noDays;
}

/* ---- ปฏิทิน ---- */
function renderCalendar() {
  $('cal-title').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const grid = $('cal-grid');
  grid.innerHTML = '';

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();      // 0 = อาทิตย์
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayKey = toKey(new Date());

  // ช่องว่างก่อนวันที่ 1
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('span');
    blank.className = 'day empty';
    grid.appendChild(blank);
  }

  // วันที่ 1 ... สิ้นเดือน
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    const rec = state.records[key];

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day';
    if (rec) cell.classList.add(rec.status);   // ot / no
    if (key === todayKey) cell.classList.add('today');
    cell.dataset.key = key;

    const mark = rec ? (rec.status === 'ot' ? '✅' : '❌') : '';
    cell.innerHTML = `<span class="num">${day}</span><span class="mark">${mark}</span>`;
    grid.appendChild(cell);
  }
}

/* ---- ประวัติ (ใหม่ -> เก่า) ---- */
function renderHistory() {
  const list = $('history');
  list.innerHTML = '';

  const keys = Object.keys(state.records).sort().reverse();  // YYYY-MM-DD เรียงตัวอักษรได้เลย

  if (keys.length === 0) {
    list.innerHTML = '<li class="empty-text">ยังไม่มีประวัติ กด “ทำ OT” หรือ “ไม่ทำ” ด้านบนได้เลย</li>';
    return;
  }

  for (const key of keys) {
    const rec = state.records[key];
    const result = rec.status === 'ot'
      ? `<span class="result ot">✅ OT ${OT_HOURS} ชม.</span>`
      : '<span class="result no">❌ ไม่ทำ OT</span>';

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="info"><span class="date">${formatShort(key)}</span> — ${result}</div>
      <button type="button" class="mini-btn" data-action="edit" data-key="${key}">แก้ไข</button>
      <button type="button" class="mini-btn del" data-action="delete" data-key="${key}">ลบ</button>
    `;
    list.appendChild(li);
  }
}

/* =========================================================
   6) ข้อความ "บันทึกแล้ว ✓"
   ========================================================= */

let toastTimer = null;
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

/* =========================================================
   7) หน้าต่างยืนยัน (แทน confirm() ซึ่งบางหน้าจอ/เบราว์เซอร์ไม่ยอมให้ใช้)
   ========================================================= */

function askConfirm(message, yesLabel, action) {
  $('confirm-text').textContent = message;
  $('confirm-yes').textContent = yesLabel;
  confirmAction = action;
  $('modal-confirm').hidden = false;
}

function closeConfirm() {
  $('modal-confirm').hidden = true;
  confirmAction = null;
}

// ขอลบรายการของวันที่ key
function askDelete(key, alsoCloseEdit) {
  askConfirm(`ลบรายการ ${formatFull(key)} ?`, 'ลบ', () => {
    deleteRecord(key);
    if (alsoCloseEdit) closeModals();
    showToast('ลบแล้ว');
  });
}

/* =========================================================
   8) หน้าต่างแก้ไข
   ========================================================= */

function openEdit(key) {
  editKey = key;
  const rec = state.records[key];

  $('edit-title').textContent = `${rec ? 'แก้ไข' : 'เพิ่ม'} ${formatFull(key)}`;
  $('edit-delete').hidden = !rec;                       // วันที่ยังไม่มีข้อมูล ไม่ต้องมีปุ่มลบ
  setEditStatus(rec ? rec.status : 'ot');

  $('modal-edit').hidden = false;
}

// สลับปุ่ม ทำ OT / ไม่ทำ ในหน้าต่างแก้ไข
function setEditStatus(status) {
  editStatus = status;
  $('seg-ot').classList.toggle('active', status === 'ot');
  $('seg-no').classList.toggle('active', status === 'no');
}

function saveEdit() {
  setRecord(editKey, editStatus);
  closeModals();
  showToast('บันทึกแล้ว ✓');
}

/* =========================================================
   9) หน้าต่างตั้งค่า
   ========================================================= */

// สร้างตัวเลือกวันเริ่มรอบ 1 - 28 (จำกัดไว้ที่ 28 เพื่อให้ทุกเดือนมีวันนั้น)
function buildStartDayOptions() {
  const select = $('setting-start');
  for (let d = 1; d <= 28; d++) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `วันที่ ${d}`;
    select.appendChild(opt);
  }
}

// ข้อความอธิบายรอบเงิน เช่น "นับจากวันที่ 26 ถึงวันที่ 25 ของเดือนถัดไป"
function updateCycleNote() {
  const s = Number($('setting-start').value);
  $('setting-cycle-note').textContent = s === 1
    ? 'นับตามเดือนปกติ (วันที่ 1 ถึงสิ้นเดือน)'
    : `นับจากวันที่ ${s} ถึงวันที่ ${s - 1} ของเดือนถัดไป`;
}

function openSettings() {
  $('setting-pay').value = state.otPay;
  $('setting-start').value = state.startDay;
  updateCycleNote();
  $('modal-settings').hidden = false;
}

function saveSettings() {
  const raw = $('setting-pay').value.trim();
  const pay = Number(raw);
  if (raw === '' || !(pay >= 0)) {
    showToast('ใส่จำนวนเงินให้ถูกต้อง');
    return;
  }
  state.otPay = pay;
  state.startDay = Number($('setting-start').value);
  saveState();
  resetSummaryToCurrent();   // เปลี่ยนวันเริ่มรอบแล้ว กลับไปดูรอบปัจจุบัน
  renderAll();
  closeModals();
  showToast('บันทึกแล้ว ✓');
}

function closeModals() {
  $('modal-edit').hidden = true;
  $('modal-settings').hidden = true;
  closeConfirm();
}

/* =========================================================
   10) ผูกเหตุการณ์ (events)
   ========================================================= */

// ปุ่มใหญ่หน้าแรก: บันทึกของ "วันนี้" ทันที
$('btn-ot').addEventListener('click', () => {
  setRecord(toKey(new Date()), 'ot');
  showToast('บันทึกแล้ว ✓');
});

$('btn-no').addEventListener('click', () => {
  setRecord(toKey(new Date()), 'no');
  showToast('บันทึกแล้ว ✓');
});

// เปลี่ยนรอบเงินในส่วนสรุป
$('sum-prev').addEventListener('click', () => changeSummary(-1));
$('sum-next').addEventListener('click', () => changeSummary(1));

function changeSummary(delta) {
  const d = new Date(sumYear, sumMonth + delta, 1);
  sumYear = d.getFullYear();
  sumMonth = d.getMonth();
  renderSummary();
}

// เปลี่ยนเดือนในปฏิทิน
$('cal-prev').addEventListener('click', () => changeMonth(-1));
$('cal-next').addEventListener('click', () => changeMonth(1));

function changeMonth(delta) {
  const d = new Date(viewYear, viewMonth + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  renderCalendar();
}

// แตะวันในปฏิทิน -> เปิดหน้าต่างแก้ไข/เพิ่ม
$('cal-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('.day[data-key]');
  if (cell) openEdit(cell.dataset.key);
});

// ปุ่มแก้ไข / ลบ ในประวัติ (event delegation)
$('history').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const key = btn.dataset.key;

  if (btn.dataset.action === 'edit') openEdit(key);
  else if (btn.dataset.action === 'delete') askDelete(key, false);
});

// หน้าต่างแก้ไข
$('seg-ot').addEventListener('click', () => setEditStatus('ot'));
$('seg-no').addEventListener('click', () => setEditStatus('no'));
$('edit-save').addEventListener('click', saveEdit);
$('edit-cancel').addEventListener('click', closeModals);
$('edit-delete').addEventListener('click', () => askDelete(editKey, true));

// หน้าต่างตั้งค่า
$('btn-settings').addEventListener('click', openSettings);
$('settings-save').addEventListener('click', saveSettings);
$('settings-cancel').addEventListener('click', closeModals);
$('setting-start').addEventListener('change', updateCycleNote);

// หน้าต่างยืนยัน
$('confirm-no').addEventListener('click', closeConfirm);
$('confirm-yes').addEventListener('click', () => {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
});

// แตะพื้นหลังมืดเพื่อปิดหน้าต่าง (หน้าต่างยืนยันปิดเฉพาะตัวมันเอง)
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target !== modal) return;
    if (modal.id === 'modal-confirm') closeConfirm();
    else closeModals();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('modal-confirm').hidden) closeConfirm();
  else closeModals();
});

// ถ้าเปิดแอปค้างข้ามเที่ยงคืน แล้วกลับมาที่หน้าเว็บ ให้อัปเดตวันที่ใหม่
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderAll();
});

/* =========================================================
   11) เริ่มทำงาน
   ========================================================= */
buildStartDayOptions();
renderAll();
