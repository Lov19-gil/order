// ============ 游戏预约系统 - 前端 ============
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const state = {
  mode: 'user',
  settings: null,
  today: null,         // 中国今天日期（后端单一真相源）
  dates: [],           // 未来 14 天
  selectedDate: null,
  userSlots: [],
  adminSlots: [],
  adminAuthed: false,
  adminPin: ''
};

// ---------- 工具 ----------
function pad(n) { return String(n).padStart(2, '0'); }

async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.adminPin) headers['x-admin-pin'] = state.adminPin;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function toast(msg, type = 'ok', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
window.closeModal = closeModal;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 基于后端返回的中国今天，生成未来 n 天
function buildDates(todayStr, n) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const arr = [];
  for (let i = 0; i < n; i++) {
    const x = new Date(base + i * 86400000);
    arr.push({
      value: `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`,
      weekday: WEEKDAYS[x.getUTCDay()],
      md: `${x.getUTCMonth() + 1}/${x.getUTCDate()}`,
      isToday: i === 0
    });
  }
  return arr;
}

// 我的预约（用 booking id 本地记忆，用于醒目标识）
function getMyBookings() { try { return JSON.parse(localStorage.getItem('myBookings') || '[]'); } catch { return []; } }
function addMyBooking(id) {
  const m = getMyBookings();
  if (!m.includes(id)) { m.push(id); try { localStorage.setItem('myBookings', JSON.stringify(m)); } catch {} }
}

// ---------- 初始化 ----------
async function init() {
  bindEvents();
  try {
    state.settings = await api('/api/settings');
  } catch (e) {
    toast('加载失败：' + e.message, 'err', 4000);
    return;
  }
  state.today = state.settings.today;
  document.getElementById('brandTitle').textContent = state.settings.title || '游戏预约';
  document.title = (state.settings.title || '游戏预约') + ' - 预约系统';
  state.dates = buildDates(state.today, 14);
  state.selectedDate = state.dates[0].value;
  renderDateRow('dateRow');
  renderDateRow('adminDateRow');
  updateSlotTitles();
  await loadUserSlots();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  document.getElementById('pinSubmit').addEventListener('click', adminLogin);
  document.getElementById('pinInput').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  document.getElementById('openSettings').addEventListener('click', openSettingsModal);
  document.getElementById('openDayOpen').addEventListener('click', openScheduleModal);
}

function switchMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('userView').classList.toggle('hidden', mode !== 'user');
  document.getElementById('adminView').classList.toggle('hidden', mode !== 'admin');
  if (mode === 'admin' && state.adminAuthed) loadAdminSlots();
}

function selectDate(date) {
  state.selectedDate = date;
  renderDateRow('dateRow');
  renderDateRow('adminDateRow');
  updateSlotTitles();
  if (state.mode === 'user') loadUserSlots();
  else if (state.adminAuthed) loadAdminSlots();
}

function updateSlotTitles() {
  document.getElementById('slotDateTitle').textContent = '时间段 · ' + state.selectedDate;
  document.getElementById('adminSlotTitle').textContent = '时间段 · ' + state.selectedDate;
}

// ---------- 日期行 ----------
function renderDateRow(containerId) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.innerHTML = '';
  const mine = containerId === 'dateRow' ? new Set(getMyBookings()) : null;
  state.dates.forEach(d => {
    const chip = document.createElement('div');
    chip.className = 'date-chip' + (d.value === state.selectedDate ? ' active' : '');
    chip.innerHTML = `
      <div class="wd">${d.weekday}</div>
      <div class="md">${d.md}</div>
      <div class="today">${d.isToday ? '今天' : ''}</div>`;
    chip.addEventListener('click', () => selectDate(d.value));
    row.appendChild(chip);
  });
}

// ---------- 用户端 ----------
async function loadUserSlots() {
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await api(`/api/slots?date=${state.selectedDate}`);
    state.userSlots = data.slots;
    renderUserSlots();
  } catch (e) {
    grid.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function renderUserSlots() {
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '';
  if (!state.userSlots.length) { grid.innerHTML = '<div class="empty">当天没有可预约时段</div>'; return; }
  const mine = new Set(getMyBookings());
  state.userSlots.forEach(s => {
    const isMine = s.booking && mine.has(s.booking.id);
    const el = document.createElement('div');
    el.className = `slot slot-${s.status}` + (isMine ? ' slot-mine' : '');
    let label;
    if (isMine) label = '⭐ 我的预约';
    else if (s.status === 'booked') label = '已约满';
    else if (s.status === 'closed') label = '不开放';
    else if (s.status === 'past') label = '已过时';
    else label = '可预约';
    el.innerHTML = `<div class="time">${s.start}–${s.end}</div><div class="st">${label}</div>`;
    if (s.status === 'available') el.addEventListener('click', () => openBookingModal(s));
    grid.appendChild(el);
  });
}

function openBookingModal(slot) {
  const games = (state.settings && state.settings.games) || [];
  const gameOptions = games.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>预约时间段</h3>
        <div class="sub">${state.selectedDate} · ${slot.start}–${slot.end}</div>
        <form id="bookingForm">
          <div class="field"><label>你的昵称 *</label><input name="name" required maxlength="50" placeholder="如何称呼你"></div>
          <div class="field"><label>联系方式 *</label><input name="contact" required maxlength="100" placeholder="微信 / QQ / 手机号"></div>
          <div class="field"><label>想玩的游戏 *</label><select name="game" required>${gameOptions}</select></div>
          <div class="field"><label>备注（选填）</label><textarea name="note" maxlength="200" placeholder="段位要求、特殊说明等"></textarea></div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" onclick="closeModal()">取消</button>
            <button type="submit" class="btn primary">确认预约</button>
          </div>
        </form>
      </div>
    </div>`;
  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      date: state.selectedDate, start: slot.start,
      name: fd.get('name'), contact: fd.get('contact'),
      game: fd.get('game'), note: fd.get('note')
    };
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const res = await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
      addMyBooking(res.booking.id);
      closeModal();
      toast('预约成功！期待一起开黑 🎮', 'ok');
      renderDateRow('dateRow');
      await loadUserSlots();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = '确认预约';
    }
  });
}

// ---------- 管理端：登录 ----------
async function adminLogin() {
  const pin = document.getElementById('pinInput').value.trim();
  if (!pin) return;
  state.adminPin = pin;
  try {
    await api('/api/admin/verify');
    state.adminAuthed = true;
    document.getElementById('adminLock').classList.add('hidden');
    document.getElementById('adminContent').classList.remove('hidden');
    toast('已进入管理后台', 'ok');
    await loadAdminSlots();
  } catch (e) {
    state.adminPin = '';
    document.getElementById('pinErr').textContent = 'PIN 错误，请重试';
  }
}

// ---------- 管理端：时段网格 ----------
async function loadAdminSlots() {
  if (!state.adminAuthed) return;
  const grid = document.getElementById('adminSlotGrid');
  grid.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await api(`/api/slots?date=${state.selectedDate}`);
    state.adminSlots = data.slots;
    renderAdminSlots();
  } catch (e) {
    grid.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function renderAdminSlots() {
  const grid = document.getElementById('adminSlotGrid');
  grid.innerHTML = '';
  if (!state.adminSlots.length) { grid.innerHTML = '<div class="empty">当天没有时段</div>'; return; }
  state.adminSlots.forEach(s => {
    const el = document.createElement('div');
    el.className = `slot slot-${s.status}`;
    let label;
    if (s.status === 'booked') label = '已预约';
    else if (s.status === 'closed') label = '已关闭';
    else if (s.status === 'past') label = '已过时';
    else label = '空闲';
    el.innerHTML = `<div class="time">${s.start}–${s.end}</div><div class="st">${label}</div>`;
    if (s.status === 'available') {
      el.addEventListener('click', () => toggleSlot(s, '关闭该时段？关闭后用户无法预约。'));
    } else if (s.status === 'closed') {
      el.addEventListener('click', () => toggleSlot(s, '开放该时段？'));
    } else if (s.status === 'booked') {
      el.addEventListener('click', () => openBookingDetailModal(s));
    }
    grid.appendChild(el);
  });
}

async function toggleSlot(slot, confirmMsg) {
  if (!confirm(confirmMsg)) return;
  try {
    await api('/api/admin/schedule/toggle', {
      method: 'POST', body: JSON.stringify({ date: state.selectedDate, start: slot.start })
    });
    await loadAdminSlots();
  } catch (e) { toast(e.message, 'err'); }
}

function openBookingDetailModal(slot) {
  const b = slot.booking;
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>预约详情</h3>
        <div class="sub">${b.date} · ${b.start}–${b.end}</div>
        <div class="detail-row"><span class="k">昵称</span><span class="v">${escapeHtml(b.name)}</span></div>
        <div class="detail-row"><span class="k">联系方式</span><span class="v">${escapeHtml(b.contact)}</span></div>
        <div class="detail-row"><span class="k">游戏</span><span class="v">${escapeHtml(b.game)}</span></div>
        <div class="detail-row"><span class="k">备注</span><span class="v">${escapeHtml(b.note || '—')}</span></div>
        <div class="detail-row"><span class="k">预约时间</span><span class="v">${new Date(b.createdAt).toLocaleString('zh-CN')}</span></div>
        <div class="modal-actions">
          <button class="btn ghost" onclick="closeModal()">关闭</button>
          <button class="btn danger" id="cancelBooking">取消此预约</button>
        </div>
      </div>
    </div>`;
  document.getElementById('cancelBooking').addEventListener('click', async () => {
    if (!confirm('确定取消该预约吗？')) return;
    try {
      await api(`/api/admin/bookings/${b.id}`, { method: 'DELETE' });
      closeModal(); toast('已取消预约', 'ok'); await loadAdminSlots();
    } catch (e) { toast(e.message, 'err'); }
  });
}

// ---------- 管理端：每日开放时段（批量编辑） ----------
async function openScheduleModal() {
  const date = state.selectedDate;
  let cfg, slotsData;
  try {
    [cfg, slotsData] = await Promise.all([
      api('/api/admin/schedule?date=' + date),
      api('/api/slots?date=' + date)
    ]);
  } catch (e) { return toast(e.message, 'err'); }

  const slots = slotsData.slots;
  const initial = new Set(cfg.configured ? cfg.starts : slots.map(s => s.start));
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:520px">
        <h3>当日开放时段</h3>
        <div class="sub">${date} · 勾选该天可预约的时段，未勾选的将不开放</div>
        <div class="dayopen-tools">
          <button type="button" class="btn ghost" id="schAll">全选</button>
          <button type="button" class="btn ghost" id="schNone">全不选</button>
          <button type="button" class="btn ghost" id="schReset">恢复默认(全部开放)</button>
        </div>
        <div class="dayopen-list">
          ${slots.map(s => {
            const tag = s.status === 'booked' ? '<em class="do-tag do-booked">已约</em>' : '';
            return `<label class="dayopen-item">
              <input type="checkbox" value="${s.start}" ${initial.has(s.start) ? 'checked' : ''}>
              <span class="do-time">${s.start}–${s.end}</span>${tag}
            </label>`;
          }).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" onclick="closeModal()">取消</button>
          <button type="button" class="btn primary" id="saveSch">保存</button>
        </div>
      </div>
    </div>`;

  const boxes = () => [...root.querySelectorAll('.dayopen-list input[type=checkbox]')];
  document.getElementById('schAll').addEventListener('click', () => boxes().forEach(c => c.checked = true));
  document.getElementById('schNone').addEventListener('click', () => boxes().forEach(c => c.checked = false));
  document.getElementById('schReset').addEventListener('click', async () => {
    try {
      await api('/api/admin/schedule', { method: 'PUT', body: JSON.stringify({ date, starts: null }) });
      closeModal(); toast('已恢复默认（全部开放）', 'ok'); await loadAdminSlots();
    } catch (e) { toast(e.message, 'err'); }
  });
  document.getElementById('saveSch').addEventListener('click', async () => {
    const btn = document.getElementById('saveSch');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const starts = boxes().filter(c => c.checked).map(c => c.value);
      await api('/api/admin/schedule', { method: 'PUT', body: JSON.stringify({ date, starts }) });
      closeModal(); toast('已保存当日开放时段', 'ok'); await loadAdminSlots();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false; btn.textContent = '保存';
    }
  });
}

// ---------- 管理端：设置 ----------
async function openSettingsModal() {
  let s;
  try { s = await api('/api/admin/settings'); }
  catch (e) { return toast(e.message, 'err'); }

  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-mask" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>系统设置</h3>
        <div class="sub">配置可预约时间、游戏列表与管理 PIN</div>
        <form id="settingsForm">
          <div class="field"><label>系统标题</label><input name="title" value="${escapeHtml(s.title)}" maxlength="30"></div>
          <div class="field"><label>每日开始时间（0-23 点）</label><input type="number" name="dailyStart" min="0" max="23" value="${s.dailyStart}"></div>
          <div class="field"><label>每日结束时间（1-24 点）</label><input type="number" name="dailyEnd" min="1" max="24" value="${s.dailyEnd}"></div>
          <div class="field"><label>每个时段长度（小时，1-8）</label><input type="number" name="slotHours" min="1" max="8" value="${s.slotHours}"></div>
          <div class="field"><label>游戏列表（每行一个）</label><textarea name="games" rows="5">${escapeHtml(s.games.join('\n'))}</textarea></div>
          <div class="field"><label>管理 PIN（至少 4 位，留空则不修改）</label><input type="text" name="adminPin" placeholder="••••" maxlength="20"></div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" onclick="closeModal()">取消</button>
            <button type="submit" class="btn primary">保存</button>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      dailyStart: Number(fd.get('dailyStart')),
      dailyEnd: Number(fd.get('dailyEnd')),
      slotHours: Number(fd.get('slotHours')),
      games: fd.get('games').split('\n').map(x => x.trim()).filter(Boolean),
      adminPin: fd.get('adminPin') || undefined
    };
    try {
      const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      state.settings = await api('/api/settings');
      state.today = state.settings.today;
      document.getElementById('brandTitle').textContent = state.settings.title;
      if (res.settings && res.settings.adminPin) state.adminPin = res.settings.adminPin;
      closeModal(); toast('设置已保存', 'ok');
      await loadAdminSlots();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// 启动
init();
