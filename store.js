// 基于 JSON 文件的数据存储层
// 设计：schedules 统一表达"每日开放时段"，未配置的日期按全局默认全部开放
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULTS = {
  settings: {
    title: '游戏预约',
    dailyStart: 9,   // 每天可预约开始小时 (24h)
    dailyEnd: 23,    // 每天可预约结束小时 (24h)
    slotHours: 1,    // 每个时段小时数
    adminPin: '1234',
    games: ['英雄联盟', '王者荣耀', '原神', '和平精英', '永劫无间', 'CS2', '其他']
  },
  schedules: {}, // { "YYYY-MM-DD": ["09:00","10:00",...] } 未配置 = 全局默认全开
  bookings: []  // { id, date, start, end, name, contact, game, note, createdAt }
};

// ============ 时区工具（统一中国时间 UTC+8）============
const CN_OFFSET = 8 * 3600 * 1000;

function pad(n) { return String(n).padStart(2, '0'); }

// 中国当前日期 "YYYY-MM-DD"
function cnDate(d = new Date()) {
  const x = new Date(d.getTime() + CN_OFFSET);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

// 根据全局设置生成时段列表 [{start,end}]
function generateSlots(settings) {
  const slots = [];
  const start = Number(settings.dailyStart);
  const end = Number(settings.dailyEnd);
  const dur = Number(settings.slotHours) || 1;
  for (let h = start; h + dur <= end; h += dur) {
    slots.push({ start: pad(h) + ':00', end: pad(h + dur) + ':00' });
  }
  return slots;
}

// 某天开放的时段 start 列表（考虑 schedules 配置，未配置则全部）
function openStartsFor(store, date) {
  const all = generateSlots(store.settings).map(s => s.start);
  const cfg = store.schedules[date];
  if (cfg) return cfg.filter(s => all.includes(s));
  return all;
}

// 中国日期 + 时段 → 真实时间戳（用于判断是否已过去）
function cnSlotTs(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - CN_OFFSET;
}

// ============ 存储 ============
let store = null;

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      store = JSON.parse(JSON.stringify(DEFAULTS));
      save();
    } else {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      store = JSON.parse(raw);
      store.settings = { ...DEFAULTS.settings, ...store.settings };
      store.bookings = Array.isArray(store.bookings) ? store.bookings : [];
      store.schedules = (store.schedules && typeof store.schedules === 'object' && !Array.isArray(store.schedules)) ? store.schedules : {};
      // 迁移旧结构 blocked + dayOpen → schedules
      if (store.blocked || store.dayOpen) {
        const all = generateSlots(store.settings).map(s => s.start);
        if (store.dayOpen) Object.assign(store.schedules, store.dayOpen);
        (store.blocked || []).forEach(({ date, start }) => {
          if (!store.schedules[date]) store.schedules[date] = [...all];
          store.schedules[date] = store.schedules[date].filter(s => s !== start);
        });
        delete store.blocked;
        delete store.dayOpen;
        save();
      }
    }
  } catch (e) {
    console.error('加载数据失败，使用默认值:', e.message);
    store = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return store;
}

function save() {
  if (!store) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存数据失败:', e.message);
  }
}

function getStore() { if (!store) load(); return store; }

module.exports = { getStore, save, load, generateSlots, openStartsFor, cnDate, cnSlotTs, pad };
