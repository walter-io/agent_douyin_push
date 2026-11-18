// 轻量任务系统:内存任务 + 日志,前端轮询
'use strict';

const jobs = new Map();
let seq = 0;

function create(type) {
  const id = `${type}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  const job = {
    id, type,
    status: 'running',       // running | done | error
    cancelled: false,        // 收到停止请求后置位,任务函数在检查点自行退出
    logs: [],
    result: null,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
  };
  jobs.set(id, job);
  // 只保留最近 30 个
  const list = [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  for (const old of list.slice(30)) jobs.delete(old.id);
  return job;
}

function log(job, line) {
  job.logs.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`);
  if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
}

function done(job, result) {
  job.status = 'done';
  job.result = result || null;
  job.endedAt = Date.now();
}

function fail(job, err) {
  job.status = 'error';
  job.error = String((err && err.message) || err);
  job.endedAt = Date.now();
  log(job, '❌ ' + job.error);
}

function run(job, fn) {
  Promise.resolve()
    .then(fn)
    .then((r) => done(job, r))
    .catch((e) => fail(job, e));
}

// 请求停止任务:只置标志,由任务函数在检查点(waitWithCancel / 各循环)尽快退出
function cancel(job) {
  if (job.status === 'running' && !job.cancelled) {
    job.cancelled = true;
    log(job, '⏹ 收到停止请求,将在当前步骤完成后尽快停止…');
  }
}

function isCancelled(job) { return !!job.cancelled; }

function get(id) { return jobs.get(id); }

function summary(job) {
  return {
    id: job.id, type: job.type, status: job.status,
    cancelled: !!job.cancelled,
    logs: job.logs.slice(-100), result: job.result,
    error: job.error, startedAt: job.startedAt, endedAt: job.endedAt,
  };
}

module.exports = { create, log, done, fail, run, cancel, isCancelled, get, summary };
