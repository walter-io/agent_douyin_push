// 浏览器拉起:干净 Chrome(无任何自动化标志)+ CDP 调试协议连接操控。
// playwright 启动器自带的标志会触发抖音风控,所以用命令行启动 + connectOverCDP。
// 登录态保存在本机 profile(data/profile-douyin),过程可视化、可人工接管。
'use strict';
const { chromium } = require('playwright-core');
const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PROFILE_DIR = path.join(config.DATA_DIR, 'profile-douyin');
const CDP_PORT = 9341; // 与工作台(9331)错开,两边可同时用

function browserPath() {
  const cfg = config.load();
  return cfg.browser || cfg.edge || '';
}

// 只查杀占用本工具 profile 的自动化浏览器(不影响用户自己的浏览器)
// 注意:命令行里路径可能是正斜杠或反斜杠,必须用 -match 正则同时匹配
// (-like 通配符把 \ 转义成 \\ 后永远匹配不上,曾导致旧进程杀不掉、profile 被锁)
const PROFILE_RX = 'douyin_push' + '[/\\\\]' + 'data' + '[/\\\\]' + 'profile-douyin';

function psKillCommand(exe) {
  return `Get-CimInstance Win32_Process -Filter \\"Name='${exe}'\\" | Where-Object { $_.CommandLine -match '${PROFILE_RX}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
}

// 同步版:launchContext 启动前确保 profile 未被旧进程占用
function killProfileBrowser() {
  for (const exe of ['chrome.exe', 'msedge.exe']) {
    try {
      execSync(`powershell -NoProfile -Command "${psKillCommand(exe)}"`, { timeout: 20000, stdio: 'ignore' });
    } catch { /* ignore */ }
  }
}

// 异步版:任务结束后清理残留进程,不阻塞 Node 事件循环(PowerShell 启动要 1-3 秒)
function killProfileBrowserAsync() {
  return Promise.all(['chrome.exe', 'msedge.exe'].map((exe) => new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${psKillCommand(exe)}"`, { timeout: 20000 }, () => resolve());
  })));
}

function clearProfileLocks() {
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch { /* ignore */ }
  }
}

async function waitHttp(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// 启动浏览器并返回 Playwright Context(首团页面)
async function launchContext() {
  killProfileBrowser();
  clearProfileLocks();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const exe = browserPath();
  if (!exe || !fs.existsSync(exe)) throw new Error('未找到 Chrome/Edge 浏览器,请在页面底部设置里填写浏览器完整路径');
  spawn(exe, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  if (!(await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 30000))) {
    throw new Error('浏览器启动失败(调试端口未就绪),请重试一次');
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 30000 });
  return browser.contexts()[0] || await browser.newContext();
}

module.exports = { launchContext, killProfileBrowser, killProfileBrowserAsync, PROFILE_DIR, CDP_PORT };
