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

// 数值配置项:取整并限制范围,非法值用默认
const clampNum = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

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
      let rel;
      try { rel = decodeURIComponent(p === '/' ? '/index.html' : p); }
      catch { return send(res, 400, 'bad request', 'text/plain'); }
      const file = path.resolve(PUBLIC_DIR, '.' + rel);
      // 必须带路径分隔符做前缀检查,否则相邻目录名前缀相同时可被绕过
      if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
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
        sendDelaySec: cfg.sendDelaySec,
        jitterSec: cfg.jitterSec,
        autoCloseBrowser: cfg.autoCloseBrowser !== false,
        // 只回传"是否已配置",AI Key 本体不出服务端
        aiConfigured: !!(cfg.aiApiKey && cfg.aiBaseUrl),
      });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const body = await readJson(req);
      // 只更新请求里带了的字段(未带的保持原值),数值字段做范围限制
      const patch = {};
      if (body.browser !== undefined) patch.browser = String(body.browser).trim();
      if (body.sendDelaySec !== undefined) patch.sendDelaySec = clampNum(body.sendDelaySec, 1, 60, 4);
      if (body.jitterSec !== undefined) patch.jitterSec = clampNum(body.jitterSec, 0, 10, 2);
      if (body.autoCloseBrowser !== undefined) patch.autoCloseBrowser = !!body.autoCloseBrowser;
      if (body.aiBaseUrl !== undefined) patch.aiBaseUrl = String(body.aiBaseUrl).trim();
      if (body.aiApiKey) patch.aiApiKey = String(body.aiApiKey).trim(); // 留空 = 不修改已保存的 Key
      if (body.aiModel !== undefined) patch.aiModel = String(body.aiModel).trim();
      const cfg = config.save({ ...config.load(), ...patch });
      return ok(res, {
        browser: cfg.browser || cfg.edge || '',
        sendDelaySec: cfg.sendDelaySec,
        jitterSec: cfg.jitterSec,
        autoCloseBrowser: cfg.autoCloseBrowser !== false,
        aiConfigured: !!(cfg.aiApiKey && cfg.aiBaseUrl),
      });
    }

    /* ---------------- AI 润色(OpenAI 兼容接口,可选配置) ---------------- */
    if (p === '/api/ai/polish' && req.method === 'POST') {
      const { message } = await readJson(req, 128 * 1024);
      const text = String(message || '').trim();
      if (!text) throw new Error('消息内容为空');
      const cfg = config.load();
      if (!cfg.aiApiKey || !cfg.aiBaseUrl) throw new Error('请先在「⚙️ 设置」里配置 AI 接口(Base URL 和 API Key)');
      const base = String(cfg.aiBaseUrl).replace(/\/+$/, '');
      const model = cfg.aiModel || 'gpt-4o-mini';
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.aiApiKey },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          messages: [
            { role: 'system', content: '你是中文文案助手,帮用户润色即将群发到抖音群聊/好友私信的消息:在保持原意和关键信息(时间、地点、福利、链接等)不变的前提下,让语气更自然亲切、更有点开欲望;不要堆砌表情符号;直接输出润色后的消息正文,不要任何解释或前后缀。' },
            { role: 'user', content: text.slice(0, 2000) },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error('AI 接口返回 ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const d = await r.json();
      const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (!out) throw new Error('AI 接口返回格式异常');
      return ok(res, { message: String(out).replace(/^```[a-z]*\n?|```\s*$/g, '').trim() || String(out).trim() });
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

    /* ---------------- 任务查询 / 停止 ---------------- */
    if (p.match(/^\/api\/job\/([\w-]+)$/) && req.method === 'GET') {
      const job = jobs.get(RegExp.$1);
      if (!job) return bad(res, new Error('任务不存在'), 404);
      return ok(res, jobs.summary(job));
    }
    if (p.match(/^\/api\/job\/([\w-]+)\/cancel$/) && req.method === 'POST') {
      const job = jobs.get(RegExp.$1);
      if (!job) return bad(res, new Error('任务不存在'), 404);
      jobs.cancel(job);
      return ok(res, { cancelled: true, status: job.status });
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
