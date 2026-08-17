const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { getStore, save, generateSlots, openStartsFor, cnDate, cnSlotTs } = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- 工具 ----------------
function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}
function slotKey(date, start) {
  return date + '|' + start;
}

// 计算某天某时段的状态。优先级：booked > closed > past > available
function slotStatus(store, date, slot, booking) {
  if (booking) return 'booked';
  if (!openStartsFor(store, date).includes(slot.start)) return 'closed';
  if (cnSlotTs(date, slot.start) < Date.now()) return 'past';
  return 'available';
}

// ---------------- 公共接口 ----------------

// 公开设置 + 中国今天日期（单一真相源）
app.get('/api/settings', (req, res) => {
  const store = getStore();
  res.json({
    title: store.settings.title,
    games: store.settings.games,
    dailyStart: store.settings.dailyStart,
    dailyEnd: store.settings.dailyEnd,
    slotHours: store.settings.slotHours,
    today: cnDate()
  });
});

// 某天时段状态列表
app.get('/api/slots', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: '缺少 date 参数' });
  const store = getStore();
  const slots = generateSlots(store.settings);
  const bookingMap = {};
  for (const b of store.bookings) bookingMap[slotKey(b.date, b.start)] = b;
  const result = slots.map(s => {
    const booking = bookingMap[slotKey(date, s.start)] || null;
    return { start: s.start, end: s.end, status: slotStatus(store, date, s, booking), booking };
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
  const slot = generateSlots(store.settings).find(s => s.start === start);
  if (!slot) return res.status(400).json({ error: '无效的时间段' });

  const k = slotKey(date, start);
  if (store.bookings.some(b => slotKey(b.date, b.start) === k)) {
    return res.status(409).json({ error: '该时间段已被预约' });
  }
  if (!openStartsFor(store, date).includes(start)) {
    return res.status(400).json({ error: '该时间段当天不开放' });
  }
  if (cnSlotTs(date, start) < Date.now()) {
    return res.status(400).json({ error: '不能预约过去的时间段' });
  }

  const booking = {
    id: genId(),
    date, start, end: slot.end,
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

app.get('/api/admin/verify', adminAuth, (req, res) => res.json({ ok: true }));

// 切换某天某时段开放/关闭（管理员网格快捷操作）
app.post('/api/admin/schedule/toggle', adminAuth, (req, res) => {
  const { date, start } = req.body || {};
  if (!date || !start) return res.status(400).json({ error: '缺少参数' });
  const store = getStore();
  if (store.bookings.some(b => slotKey(b.date, b.start) === slotKey(date, start))) {
    return res.status(409).json({ error: '该时段已有预约，无法关闭（请先取消预约）' });
  }
  const all = generateSlots(store.settings).map(s => s.start);
  if (!all.includes(start)) return res.status(400).json({ error: '无效时段' });
  if (!store.schedules[date]) store.schedules[date] = [...all];
  const i = store.schedules[date].indexOf(start);
  if (i >= 0) store.schedules[date].splice(i, 1);
  else store.schedules[date].push(start);
  save();
  res.json({ ok: true, opens: store.schedules[date] });
});

// 获取当日开放时段配置
app.get('/api/admin/schedule', adminAuth, (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: '缺少 date 参数' });
  const store = getStore();
  const configured = Object.prototype.hasOwnProperty.call(store.schedules, date);
  res.json({ date, configured, starts: configured ? store.schedules[date] : null });
});

// 设置当日开放时段（starts=null 恢复全局默认）
app.put('/api/admin/schedule', adminAuth, (req, res) => {
  const { date, starts } = req.body || {};
  if (!date) return res.status(400).json({ error: '缺少日期' });
  const store = getStore();
  if (starts == null) {
    delete store.schedules[date];
  } else if (Array.isArray(starts)) {
    const valid = new Set(generateSlots(store.settings).map(s => s.start));
    store.schedules[date] = starts.filter(s => valid.has(s));
  } else {
    return res.status(400).json({ error: '参数错误' });
  }
  save();
  res.json({ ok: true });
});

// 取消预约
app.delete('/api/admin/bookings/:id', adminAuth, (req, res) => {
  const store = getStore();
  const before = store.bookings.length;
  store.bookings = store.bookings.filter(b => b.id !== req.params.id);
  save();
  res.json({ ok: true, removed: store.bookings.length < before });
});

// 预约列表
app.get('/api/admin/bookings', adminAuth, (req, res) => {
  const store = getStore();
  let bookings = store.bookings;
  if (req.query.date) bookings = bookings.filter(b => b.date === req.query.date);
  bookings = bookings.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
  );
  res.json({ bookings });
});

// 完整设置
app.get('/api/admin/settings', adminAuth, (req, res) => {
  res.json({ ...getStore().settings });
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
  if (store.settings.dailyStart + store.settings.slotHours > store.settings.dailyEnd) {
    return res.status(400).json({ error: '开始时间 + 时段长度不能超过结束时间' });
  }
  save();
  res.json({ ok: true, settings: { ...store.settings } });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🎮 游戏预约系统已启动: http://localhost:${PORT}`);
});
