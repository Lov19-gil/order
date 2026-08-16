const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { getStore, save } = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- 工具函数 ----------------
function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 根据设置生成每天的时间段
function generateSlots(settings) {
  const slots = [];
  const start = Number(settings.dailyStart);
  const end = Number(settings.dailyEnd);
  const dur = Number(settings.slotHours) || 1;
  for (let h = start; h + dur <= end; h += dur) {
    slots.push({
      start: pad(h) + ':00',
      end: pad(h + dur) + ':00'
    });
  }
  return slots;
}

function slotKey(date, start) {
  return date + '|' + start;
}

// 中国时区 (UTC+8) 辅助，避免服务器时区与用户不一致导致时间判断错乱
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

// 把 "YYYY-MM-DD" + "HH:MM" 解析为中国时间对应的真实 UTC 时间戳
function chinaTimestamp(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - CN_OFFSET_MS;
}

// ---------------- 公共接口 ----------------

// 公开设置 (不含敏感信息)
app.get('/api/settings', (req, res) => {
  const store = getStore();
  res.json({
    title: store.settings.title,
    games: store.settings.games,
    dailyStart: store.settings.dailyStart,
    dailyEnd: store.settings.dailyEnd,
    slotHours: store.settings.slotHours
  });
});

// 获取某天的时间段及状态
app.get('/api/slots', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: '缺少 date 参数' });
  const store = getStore();
  const slots = generateSlots(store.settings);
  const blockedSet = new Set(store.blocked.map(b => slotKey(b.date, b.start)));
  const bookingMap = {};
  for (const b of store.bookings) {
    bookingMap[slotKey(b.date, b.start)] = b;
  }
  const nowTs = Date.now();
  const result = slots.map(s => {
    const k = slotKey(date, s.start);
    let status = 'available';
    if (blockedSet.has(k)) status = 'blocked';
    else if (bookingMap[k]) status = 'booked';
    // 已过去的时间段（按中国时间判断）
    if (status === 'available' && chinaTimestamp(date, s.start) < nowTs) {
      status = 'past';
    }
    return { start: s.start, end: s.end, status, booking: bookingMap[k] || null };
  });
  res.json({ date, slots: result });
});

// 创建预约
app.post('/api/bookings', (req, res) => {
  const { date, start, name, contact, game, note } = req.body || {};
  if (!date || !start || !name || !contact || !game) {
    return res.status(400).json({ error: '请填写完整信息（日期、时间、昵称、联系方式、游戏）' });
  }
  const store = getStore();
  const slots = generateSlots(store.settings);
  const slot = slots.find(s => s.start === start);
  if (!slot) return res.status(400).json({ error: '无效的时间段' });

  const k = slotKey(date, start);
  if (store.blocked.some(b => slotKey(b.date, b.start) === k)) {
    return res.status(409).json({ error: '该时间段已被锁定，不可预约' });
  }
  if (store.bookings.some(b => slotKey(b.date, b.start) === k)) {
    return res.status(409).json({ error: '该时间段已被预约，请选择其他时间' });
  }
  // 禁止预约过去的时间（按中国时间判断，避免服务器时区偏差）
  if (chinaTimestamp(date, start) < Date.now()) {
    return res.status(400).json({ error: '不能预约过去的时间段' });
  }

  const booking = {
    id: genId(),
    date,
    start,
    end: slot.end,
    name: String(name).trim().slice(0, 50),
    contact: String(contact).trim().slice(0, 100),
    game: String(game).trim().slice(0, 50),
    note: String(note || '').trim().slice(0, 200),
    createdAt: new Date().toISOString()
  };
  store.bookings.push(booking);
  save();
  res.json({ ok: true, booking });
});

// ---------------- 管理员鉴权 ----------------
function adminAuth(req, res, next) {
  const pin = req.headers['x-admin-pin'];
  const store = getStore();
  if (!pin || pin !== store.settings.adminPin) {
    return res.status(401).json({ error: '管理员验证失败' });
  }
  next();
}

// 验证 PIN
app.get('/api/admin/verify', adminAuth, (req, res) => {
  res.json({ ok: true });
});

// 锁定时间段
app.post('/api/admin/block', adminAuth, (req, res) => {
  const { date, start } = req.body || {};
  if (!date || !start) return res.status(400).json({ error: '缺少参数' });
  const store = getStore();
  const k = slotKey(date, start);
  if (store.bookings.some(b => slotKey(b.date, b.start) === k)) {
    return res.status(409).json({ error: '该时间段已有预约，请先取消预约再锁定' });
  }
  if (!store.blocked.some(b => slotKey(b.date, b.start) === k)) {
    store.blocked.push({ date, start });
    save();
  }
  res.json({ ok: true });
});

// 解锁时间段
app.post('/api/admin/unblock', adminAuth, (req, res) => {
  const { date, start } = req.body || {};
  const store = getStore();
  const k = slotKey(date, start);
  store.blocked = store.blocked.filter(b => slotKey(b.date, b.start) !== k);
  save();
  res.json({ ok: true });
});

// 取消/删除预约
app.delete('/api/admin/bookings/:id', adminAuth, (req, res) => {
  const store = getStore();
  const before = store.bookings.length;
  store.bookings = store.bookings.filter(b => b.id !== req.params.id);
  save();
  res.json({ ok: true, removed: store.bookings.length < before });
});

// 获取所有预约 (可按日期过滤)
app.get('/api/admin/bookings', adminAuth, (req, res) => {
  const store = getStore();
  let bookings = store.bookings;
  if (req.query.date) bookings = bookings.filter(b => b.date === req.query.date);
  bookings = bookings.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
  );
  res.json({ bookings });
});

// 获取完整设置 (含 PIN，仅管理员)
app.get('/api/admin/settings', adminAuth, (req, res) => {
  const store = getStore();
  res.json({ ...store.settings });
});

// 更新设置
app.put('/api/admin/settings', adminAuth, (req, res) => {
  const store = getStore();
  const s = req.body || {};
  if (typeof s.title === 'string' && s.title.trim()) store.settings.title = s.title.trim().slice(0, 30);
  if (Array.isArray(s.games)) store.settings.games = s.games.map(g => String(g).trim()).filter(Boolean);
  if (Number.isInteger(s.dailyStart) && s.dailyStart >= 0 && s.dailyStart <= 23) store.settings.dailyStart = s.dailyStart;
  if (Number.isInteger(s.dailyEnd) && s.dailyEnd >= 1 && s.dailyEnd <= 24) store.settings.dailyEnd = s.dailyEnd;
  if (Number.isInteger(s.slotHours) && s.slotHours >= 1 && s.slotHours <= 8) store.settings.slotHours = s.slotHours;
  if (typeof s.adminPin === 'string' && s.adminPin.trim().length >= 4) store.settings.adminPin = s.adminPin.trim();
  // 校验时间段合理性
  if (store.settings.dailyStart + store.settings.slotHours > store.settings.dailyEnd) {
    return res.status(400).json({ error: '开始时间 + 时段长度不能超过结束时间' });
  }
  save();
  res.json({ ok: true, settings: { ...store.settings } });
});

// 兜底：其它路径返回首页
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎮 游戏预约系统已启动: http://localhost:${PORT}`);
});
