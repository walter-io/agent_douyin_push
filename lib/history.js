// 消息发送记录:data/history.json(最多保留 500 条,新记录追加在尾部)
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.DATA_DIR, 'history.json');

function list() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

// records: [{name, ok, error?, message, at}]
function append(records) {
  const cur = list();
  for (const r of records) {
    cur.push({
      id: 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      at: r.at || Date.now(),
      name: String(r.name || ''),
      message: String(r.message || ''),
      ok: !!r.ok,
      error: r.error ? String(r.error).slice(0, 160) : '',
    });
  }
  const trimmed = cur.slice(-500);
  fs.writeFileSync(FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

function clear() {
  fs.writeFileSync(FILE, '[]', 'utf8');
  return [];
}

module.exports = { list, append, clear };
