// 抖音粉丝群消息推送:网页版 IM 自动化
// 抖音没有面向个人的群消息 API,采用网页 IM RPA 方案:
// 登录态保存在本机 profile(data/profile-douyin),过程可视化、可人工接管。
//
// 已在真实登录态下验证的交互链路:
//   登录(douyin.com)→ 点顶栏"消息"LI(Playwright 真实点击,DOM .click() 不触发 SPA 处理器)
//   → 右侧 IM 抽屉(约 356px 宽)加载会话列表 → 行内首行=会话名 → 按名点击打开会话
//   → 抽屉底部 contenteditable 输入 → insertText → 发送 → 抽屉文本包含消息即成功
//   发完一条后抽屉停在聊天视图 → 返回列表必须真实鼠标点击返回按钮(DOM .click() 无效)
'use strict';
const fs = require('fs');
const path = require('path');
const browser = require('./browser');
const jobs = require('./jobs');
const config = require('./config');

const SHOT_DIR = path.join(config.DATA_DIR, 'screenshots');
const SEND_DELAY_MS = 4000; // 群与群之间的间隔,降低风控风险

let busy = false;

// 登录态:抖音首页右上角有用户头像(未登录时是"登录"按钮)
async function loggedIn(page) {
  try {
    return await page.evaluate(() => {
      if (/\/login/.test(location.href)) return false;
      return !!document.querySelector('[class*="avatar"] img, img[src*="avatar"], img[src*="aweme"]');
    });
  } catch { return false; }
}

// 打开首页并等待登录(未登录时留在可见窗口等扫码);登录后点顶栏"消息"打开 IM 抽屉
async function openIM(job) {
  const ctx = await browser.launchContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => { });
  await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
  await page.waitForTimeout(4000);
  if (!(await loggedIn(page))) {
    jobs.log(job, '未检测到登录态:请在弹出的 Chrome 窗口用抖音 App 扫码登录(最长等 5 分钟;登录后页面自动刷新为已登录)');
    const deadline = Date.now() + 5 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
      await page.waitForTimeout(2000);
      if (await loggedIn(page)) { ok = true; break; }
    }
    if (!ok) throw new Error('登录等待超时:请重试,并在弹出的窗口里完成扫码');
  }
  jobs.log(job, '✓ 登录态就绪,打开消息面板…');
  // 点顶栏"消息"(真实点击;精确匹配文本=消息 的 li)
  const li = page.locator('li', { hasText: '消息' }).filter({ hasText: /^消息$/ }).first();
  await li.click({ timeout: 8000 }).catch(async (e) => {
    jobs.log(job, '定位点击失败,退化坐标点击: ' + String(e.message || e).slice(0, 60));
    const box = await li.boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else throw new Error('找不到顶栏"消息"入口(抖音改版?)');
  });
  await page.waitForTimeout(2000); // 点击后 IM 抽屉异步加载会话列表
  // 等抽屉加载完成:右侧 300-420px 宽、高>500 的面板且会话行就绪(Chrome 下加载可能超过 10 秒,轮询等待)
  let panelOk = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    panelOk = await page.evaluate(() => {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width >= 280 && r.width <= 500 && r.height >= 400 && r.left > 800) {
          const t = (el.innerText || '').replace(/\s+/g, ' ');
          if (t.includes('消息') && t.length > 30) return true;
        }
      }
      return false;
    }).catch(() => false);
    if (panelOk) break;
  }
  if (!panelOk) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, 'fangroup-panel-missing.png') }).catch(() => { });
    throw new Error('消息面板未加载(截图已存 data/screenshots/):等了 30 秒仍未出现会话列表,可能是登录失效或抖音改版');
  }
  jobs.log(job, 'IM 消息面板就绪');
  return { ctx, page };
}

// 在 IM 抽屉里读取全部会话(群 + 好友/私信)。
// 列表是虚拟渲染(只渲染可视行),必须边滚动边累积;滚到底且连续无新会话即读完。
// 抽屉可能停在聊天视图 → 真实点击返回按钮回列表(DOM .click() 不触发 SPA 处理器)
async function readConversations(page, maxRows = 300) {
  const scanRows = () => page.evaluate(() => {
    let panel = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 500 && r.height >= 400 && r.left > 800 && (el.innerText || '').includes('消息')) { panel = el; break; }
    }
    if (!panel) return { panel: false, hasInput: false, rows: [], back: null, atBottom: true };
    const hasInput = !!panel.querySelector('[contenteditable=true]');
    const rows = [];
    const seenLocal = new Set();
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.height > 110 || r.width < 250) continue;
      const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length < 2 || !lines[0] || lines[0].length > 40) continue;
      const name = lines[0];
      if (seenLocal.has(name)) continue;
      if (/下载客户端/.test(name)) continue; // 面板顶部横幅,不是会话
      seenLocal.add(name);
      rows.push({ name, groupLike: /群|组/.test(name), lastMsg: (lines[2] || lines[1] || '').slice(0, 40) });
      if (rows.length >= 60) break; // 单屏最多几十行,防误抓容器
    }
    // 聊天视图的返回按钮坐标
    let back = null;
    if (hasInput) {
      const backEl = panel.querySelector('[class*="leftTitle"], [class*="back"]');
      const br = backEl ? backEl.getBoundingClientRect() : null;
      back = br && br.width > 0 ? { x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) } : null;
    }
    // 列表滚动容器状态(取最大的那个)
    let atBottom = true, scrollTop = 0;
    let best = null;
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (el.scrollHeight > el.clientHeight + 40 && r.height > 250 && /auto|scroll/.test(getComputedStyle(el).overflowY || '')) {
        if (!best || el.clientHeight > best.clientHeight) best = el;
      }
    }
    if (best) { scrollTop = best.scrollTop; atBottom = best.scrollTop + best.clientHeight >= best.scrollHeight - 10; }
    return { panel: true, hasInput, rows, back, atBottom, scrollTop };
  });

  const all = [];
  const seen = new Set();
  let noFreshAtBottom = false;
  for (let round = 0; round < 60 && all.length < maxRows; round++) {
    const st = await scanRows();
    if (!st.panel) break;
    // 抽屉停在聊天视图(有输入框但没有会话行)→ 真实点击左上角返回按钮回列表
    if (st.hasInput && !st.rows.length) {
      if (st.back) await page.mouse.click(st.back.x, st.back.y);
      await page.waitForTimeout(1500);
      continue;
    }
    let fresh = 0;
    for (const r of st.rows) {
      if (!seen.has(r.name)) { seen.add(r.name); all.push(r); fresh++; }
    }
    if (!fresh && st.atBottom) { noFreshAtBottom = true; break; } // 滚到底且没有新会话 → 读完
    const moved = await scrollConvList(page); // 向下滚一步;到底则回顶再扫一遍兜底
    if (!moved) break;                        // 列表不可滚动(全部会话都在可视区) → 读完
    await page.waitForTimeout(700);           // 等虚拟列表渲染新行
  }
  // 读完整数回顶,方便后续按名定位从列表头开始
  await page.evaluate(() => {
    let panel = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 500 && r.height >= 400 && r.left > 800 && (el.innerText || '').includes('消息')) { panel = el; break; }
    }
    if (!panel) return;
    let best = null;
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (el.scrollHeight > el.clientHeight + 40 && r.height > 250 && /auto|scroll/.test(getComputedStyle(el).overflowY || '')) {
        if (!best || el.clientHeight > best.clientHeight) best = el;
      }
    }
    if (best) best.scrollTop = 0;
  }).catch(() => { });
  return noFreshAtBottom || all.length
    ? { panel: true, hasInput: false, rows: all, back: null }
    : { panel: false, hasInput: false, rows: [], back: null };
}

/* ---------- 抽屉内定位工具(sendOne / 测试共用) ---------- */
// 探测 IM 抽屉当前状态:
//   列表视图 → 找目标会话行的真实点击坐标(精确相等优先,归一化相等兜底)
//   聊天视图 → 返回左上角返回按钮坐标(返回列表必须真实鼠标点击,DOM .click() 不触发 SPA 处理器)
// 归一化:抖音 innerText 可能吞掉 emoji 变体选择符(\uFE0F)和零宽字符,如「交流群2️⃣」
async function panelState(page, name) {
  return page.evaluate((target) => {
    const norm = (s) => String(s || '').replace(/\uFE0F/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').trim();
    let panel = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 500 && r.height >= 400 && r.left > 800 && (el.innerText || '').includes('消息')) { panel = el; break; }
    }
    if (!panel) return { panel: false };
    if (panel.querySelector('[contenteditable=true]')) {
      const backEl = panel.querySelector('[class*="leftTitle"], [class*="back"]');
      const br = backEl ? backEl.getBoundingClientRect() : null;
      return { panel: true, chat: true, back: br && br.width > 0 ? { x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) } : null };
    }
    const exact = [], fuzzy = [];
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.height > 110 || r.width < 250) continue; // 高度上限排除跨行大容器,保证命中的是单条会话行
      const lines = (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines[0] || lines[0].length > 40) continue;
      if (/下载客户端/.test(lines[0])) continue;
      const pt = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      if (lines[0] === target) { exact.push(pt); continue; }
      if (norm(lines[0]) === norm(target)) fuzzy.push(pt);
    }
    if (exact.length) return { panel: true, row: exact[0] };
    if (fuzzy.length === 1) return { panel: true, row: fuzzy[0] };
    if (fuzzy.length > 1) return { panel: true, ambiguous: true }; // 归一化后撞名,宁可中止也不发错群
    return { panel: true };
  }, name);
}

// 会话列表滚动一步(虚拟列表可能只渲染可视行,目标群排在下方时需要滚动才出现在 DOM)
async function scrollConvList(page) {
  return page.evaluate(() => {
    let panel = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 500 && r.height >= 400 && r.left > 800 && (el.innerText || '').includes('消息')) { panel = el; break; }
    }
    if (!panel) return false;
    let best = null;
    for (const el of panel.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (el.scrollHeight > el.clientHeight + 40 && r.height > 250 && /auto|scroll/.test(getComputedStyle(el).overflowY || '')) {
        if (!best || el.clientHeight > best.clientHeight) best = el;
      }
    }
    if (!best) return false;
    const atBottom = best.scrollTop + best.clientHeight >= best.scrollHeight - 10;
    best.scrollTop = atBottom ? 0 : best.scrollTop + Math.max(300, Math.round(best.clientHeight * 0.8)); // 到底则回顶再试
    return true;
  });
}

// 列出全部会话(群聊 groupLike=true;好友/私信/官方号 groupLike=false,发送时由用户勾选)
async function listConversations(job) {
  if (busy) throw new Error('已有任务进行中,请稍后再试');
  busy = true;
  try {
    const { ctx, page } = await openIM(job);
    const convs = await readConversations(page);
    if (!convs.panel || !convs.rows.length) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, 'fangroup-panel-empty.png') }).catch(() => { });
      jobs.log(job, '⚠️ 消息面板里没有读到会话行(可能没有会话,或抖音改版;截图已存 data/screenshots/)');
      await ctx.close().catch(() => { });
      return { groups: [], at: Date.now() };
    }
    const groups = convs.rows.filter((r) => r.groupLike).length;
    jobs.log(job, `读到 ${convs.rows.length} 个会话(群聊 ${groups} · 其他 ${convs.rows.length - groups}): ${convs.rows.map((r) => r.name).join('、')}`);
    await ctx.close().catch(() => { });
    // 缓存到文件,后续进页面直接显示,不用每次重读
    const cachePath = path.join(config.DATA_DIR, 'fangroup-cache.json');
    try { fs.writeFileSync(cachePath, JSON.stringify({ groups: convs.rows, at: Date.now() }), 'utf8'); } catch { }
    return { groups: convs.rows, at: Date.now(), fromCache: false };
  } finally { busy = false; }
}

// 对单个会话:按会话名在抽屉里点行 → 打开聊天 → 输入 → 发送 → 校验
async function sendOne(job, page, name, message) {
  // 1. 定位会话行(真实点击)。抽屉可能停在聊天视图(上一条刚发完)→ 真实点击返回按钮回列表;
  //    列表里没命中则滚动虚拟列表后重扫(共 6 轮)
  let row = null;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    if (attempt > 0) await page.waitForTimeout(1200);
    const st = await panelState(page, name).catch(() => ({ panel: false }));
    if (!st.panel) continue;
    if (st.chat) {
      if (!st.back) throw new Error('抽屉停在聊天视图且找不到返回按钮');
      jobs.log(job, '从聊天视图返回会话列表…');
      await page.mouse.click(st.back.x, st.back.y);
      await page.waitForTimeout(1500);
      continue;
    }
    if (st.row) { row = st.row; break; }
    if (st.ambiguous) throw new Error('会话「' + name + '」匹配到多个同名条目,已中止(避免发错群)');
    await scrollConvList(page); // 未命中:滚动列表后下一轮重扫
  }
  if (!row) throw new Error('会话列表里没有找到「' + name + '」(列表未加载、已改名或滚动加载失败)');
  await page.mouse.click(row.x, row.y);
  await page.waitForTimeout(2000);
  // 2. 输入框:抽屉里可见的 contenteditable
  const inputReady = await page.waitForSelector('[contenteditable="true"]:not([disabled])', { timeout: 12000 }).catch(() => null);
  if (!inputReady) throw new Error('聊天输入框未出现(点开的可能不是会话)');
  await page.click('[contenteditable="true"]');
  await page.waitForTimeout(300);
  await page.keyboard.insertText(message);
  await page.waitForTimeout(400);
  // 3. 发送:优先点"发送"按钮,退化按回车
  const sent = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, div[class*="btn"], span')]
      .find((b) => (b.innerText || '').trim() === '发送' && b.getBoundingClientRect().width > 0);
    if (btn) { btn.click(); return 'btn'; }
    return null;
  });
  if (!sent) await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  // 4. 校验:抽屉可见文本包含消息开头
  const confirmed = await page.evaluate((msg) => {
    const head = msg.slice(0, 12);
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 280 && r.width <= 500 && r.height >= 300 && r.left > 800) {
        if ((el.innerText || '').replace(/\s+/g, '').includes(head)) return true;
      }
    }
    return false;
  }, message).catch(() => false);
  if (!confirmed) throw new Error('发送后未在会话里确认到内容(可能被风控拦截或输入框未生效)');
}

// 向指定会话发送消息(逐个发送,间隔 4s;失败逐个记录,不影响后续;群聊/好友/私信通用)
async function sendMessages(job, { message, groups }) {
  if (busy) throw new Error('已有任务进行中,请稍后再试');
  if (!message || !String(message).trim()) throw new Error('消息内容为空');
  if (!Array.isArray(groups) || !groups.length) throw new Error('请至少勾选一个会话');
  if (String(message).length > 2000) throw new Error('消息过长(上限 2000 字)');
  busy = true;
  try {
    const { ctx, page } = await openIM(job);
    const results = [];
    for (const g of groups) {
      const name = typeof g === 'string' ? g : g.name;
      jobs.log(job, `→ 发送到「${name}」…`);
      try {
        await sendOne(job, page, name, String(message));
        results.push({ name, ok: true });
        jobs.log(job, `✓ 「${name}」发送成功`);
      } catch (e) {
        results.push({ name, ok: false, error: String(e.message || e).slice(0, 160) });
        jobs.log(job, `✗ 「${name}」发送失败: ${String(e.message || e).slice(0, 120)}(截图已存 data/screenshots/)`);
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SHOT_DIR, `fangroup-fail-${Date.now()}.png`) }).catch(() => { });
      }
      await page.waitForTimeout(SEND_DELAY_MS);
    }
    await ctx.close().catch(() => { });
    const okCount = results.filter((r) => r.ok).length;
    jobs.log(job, `完成:成功 ${okCount}/${results.length}`);
    return { results, ok: okCount, total: results.length };
  } finally { busy = false; }
}


/* ---------------- 消息模板(持久化 data/templates.json) ---------------- */
const templatePath = path.join(config.DATA_DIR, 'templates.json');

function listTemplates() {
  try { return JSON.parse(fs.readFileSync(templatePath, 'utf8')); } catch { return []; }
}
function saveTemplate(name, content) {
  const nameClean = String(name || '').trim().slice(0, 40);
  if (!nameClean) throw new Error('模板名不能为空');
  const contentClean = String(content || '').trim();
  if (!contentClean) throw new Error('模板内容不能为空');
  const list = listTemplates().filter((t) => t.name !== nameClean);
  list.push({ id: 'tpl-' + Date.now().toString(36), name: nameClean, content: contentClean, at: Date.now() });
  fs.writeFileSync(templatePath, JSON.stringify(list, null, 2), 'utf8');
  return { ok: true, templates: list };
}
function deleteTemplate(id) {
  const list = listTemplates().filter((t) => t.id !== id);
  fs.writeFileSync(templatePath, JSON.stringify(list, null, 2), 'utf8');
  return { ok: true, templates: list };
}

function getCached() {
  try {
    const cachePath = path.join(config.DATA_DIR, 'fangroup-cache.json');
    const d = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Array.isArray(d.groups) && d.groups.length) return d;
  } catch { }
  return { groups: [], at: null };
}

function isBusy() { return busy; }

module.exports = {
  listConversations, sendMessages, listTemplates, saveTemplate, deleteTemplate, getCached, isBusy,
  __test: { openIM, panelState, readConversations },
};
