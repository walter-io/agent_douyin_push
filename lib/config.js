// 配置读写:数据目录 + config.json(浏览器路径可改)
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  // 自动检测 Chrome;无 Chrome 用 Edge;都可在设置里手填
  browser: detectBrowser(),
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};

function detectBrowser() {
  const cands = [
    'C:/Users/' + (process.env.USERNAME || '') + '/AppData/Local/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch { } }
  return '';
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch || {})) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], patch[k]);
    } else if (patch[k] !== undefined) {
      out[k] = patch[k];
    }
  }
  return out;
}

function load() {
  try {
    return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(cfg) {
  ensureDirs();
  const merged = deepMerge(DEFAULTS, cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { DATA_DIR, CONFIG_PATH, ensureDirs, load, save };
