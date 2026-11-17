// 轻量任务系统:内存任务 + 日志,前端轮询
'use strict';

const jobs = new Map();
let seq = 0;

function create(type) {
  const id = `${type}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  const job = {
    id, type,
    status: 'running',       // running | done | error
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

function get(id) { return jobs.get(id); }

function summary(job) {
  return {
    id: job.id, type: job.type, status: job.status,
    logs: job.logs.slice(-100), result: job.result,
    error: job.error, startedAt: job.startedAt, endedAt: job.endedAt,
  };
}

module.exports = { create, log, done, fail, run, get, summary };
