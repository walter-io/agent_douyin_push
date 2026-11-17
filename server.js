// 抖音粉丝群消息推送 · 独立工具服务端(零依赖,仅 playwright-core)
// 启动:node server.js  → http://127.0.0.1:5220/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const jobs = require('./lib/jobs');
const fangroup = require('./lib/fangroup');
const history = require('./lib/history');

const PORT = 5220;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const ok = (res, data) => send(res, 200, { ok: true, data });
const bad = (res, e, code = 400) => send(res, code, { ok: false, error: String((e && e.message) || e) });

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON 解析失败: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    /* ---------------- 静态页面 ---------------- */
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      let rel = p === '/' ? '/index.html' : p;
      const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(rel));
      if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');
      return fs.readFile(file, (err, buf) => {
        if (err) return send(res, 404, '404 Not Found', 'text/plain; charset=utf-8');
        send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      });
    }

    /* ---------------- 状态 / 配置 ---------------- */
    if (p === '/api/state' && req.method === 'GET') {
      const cfg = config.load();
      return ok(res, {
        groups: fangroup.getCached(),
        templates: fangroup.listTemplates(),
        history: history.list(),
        busy: fangroup.isBusy(),
        browser: cfg.browser || cfg.edge || '',
      });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const { browser } = await readJson(req);
      const cfg = config.save({ ...config.load(), browser: String(browser || '').trim() });
      return ok(res, { browser: cfg.browser });
    }

    /* ---------------- 会话/群 ---------------- */
    if (p === '/api/refresh' && req.method === 'POST') {
      const job = jobs.create('refresh');
      jobs.log(job, '打开抖音消息中心,读取会话列表(群聊 + 好友私信;未登录会弹出窗口扫码)');
      jobs.run(job, () => fangroup.listConversations(job));
      return ok(res, { jobId: job.id });
    }
    if (p === '/api/send' && req.method === 'POST') {
      const body = await readJson(req, 512 * 1024);
      const job = jobs.create('send');
      jobs.log(job, `开始消息推送: ${(body.groups || []).length} 个会话`);
      jobs.run(job, async () => {
        const r = await fangroup.sendMessages(job, { message: body.message, groups: body.groups });
        // 每条发送结果落库(成功/失败都记),供消息列表查询
        const at = Date.now();
        history.append((r.results || []).map((x) => ({ at, name: x.name, message: body.message, ok: x.ok, error: x.error })));
        return r;
      });
      return ok(res, { jobId: job.id });
    }

    /* ---------------- 消息模板 ---------------- */
    if (p === '/api/templates' && req.method === 'GET') {
      return ok(res, { templates: fangroup.listTemplates() });
    }
    if (p === '/api/templates' && req.method === 'POST') {
      const { name, content } = await readJson(req);
      return ok(res, fangroup.saveTemplate(name, content));
    }
    if (p === '/api/templates/delete' && req.method === 'POST') {
      const { id } = await readJson(req);
      return ok(res, fangroup.deleteTemplate(id));
    }

    /* ---------------- 消息记录 ---------------- */
    if (p === '/api/history' && req.method === 'GET') {
      return ok(res, { records: history.list() });
    }
    if (p === '/api/history/clear' && req.method === 'POST') {
      return ok(res, { records: history.clear() });
    }

    /* ---------------- 任务查询 ---------------- */
    if (p.match(/^\/api\/job\/([\w-]+)$/) && req.method === 'GET') {
      const job = jobs.get(RegExp.$1);
      if (!job) return bad(res, new Error('任务不存在'), 404);
      return ok(res, jobs.summary(job));
    }

    return send(res, 404, { ok: false, error: 'not found: ' + p });
  } catch (e) {
    return bad(res, e, 500);
  }
});

config.ensureDirs();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`抖音粉丝群消息推送工具已启动: http://127.0.0.1:${PORT}/`);
});
