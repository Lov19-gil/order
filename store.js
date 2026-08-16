// 基于 JSON 文件的数据存储层，避免原生依赖，简单可靠
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULTS = {
  settings: {
    title: '游戏预约',
    dailyStart: 9,   // 每天可预约的开始小时 (24h)
    dailyEnd: 23,    // 每天可预约的结束小时 (24h)
    slotHours: 1,    // 每个时间段的小时数
    adminPin: '1234',
    games: ['英雄联盟', '王者荣耀', '原神', '和平精英', '永劫无间', 'CS2', '其他']
  },
  blocked: [],   // 被锁定的时间段 { date, start }
  bookings: []   // 预约记录
};

let store = null;

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      store = JSON.parse(JSON.stringify(DEFAULTS));
      save();
    } else {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      store = JSON.parse(raw);
      // 合并默认值，兼容旧数据
      store.settings = { ...DEFAULTS.settings, ...store.settings };
      store.blocked = Array.isArray(store.blocked) ? store.blocked : [];
      store.bookings = Array.isArray(store.bookings) ? store.bookings : [];
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
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存数据失败:', e.message);
  }
}

function getStore() {
  if (!store) load();
  return store;
}

module.exports = { getStore, save, load };
