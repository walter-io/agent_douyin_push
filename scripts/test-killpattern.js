// 验证 killProfileEdge/killProfileBrowser 的匹配模式:
// 只应命中自动化 profile 的浏览器进程,绝不能命中用户自己的 Chrome。
// 加 KILL=1 参数执行真实查杀(复用 browser.js 同一条命令)。
'use strict';
const { execSync } = require('child_process');

function listMatches(rx, exe) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='${exe}'\\" | Where-Object { $_.CommandLine -match '${rx}' } | ForEach-Object { Write-Output $_.ProcessId }"`,
      { timeout: 20000, encoding: 'utf8' }
    );
    return out.trim().split(/\s+/).filter(Boolean);
  } catch { return []; }
}

// 工作台 douyin 的模式(publish[/\]profile-douyin)
const wb = 'publish' + '[/\\\\]' + 'profile-douyin';
// 独立工具的模式(douyin_push[/\]data[/\]profile-douyin)
const tool = 'douyin_push' + '[/\\\\]' + 'data' + '[/\\\\]' + 'profile-douyin';

if (process.env.KILL === '1') {
  const rx = tool;
  for (const exe of ['chrome.exe', 'msedge.exe']) {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='${exe}'\\" | Where-Object { $_.CommandLine -match '${rx}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { timeout: 20000, stdio: 'ignore' }
    );
  }
  const left = listMatches(rx, 'chrome.exe');
  console.log('查杀后残留:', left.length ? left.join(',') : '无 ✓');
} else {
  console.log('工作台模式 rx:', wb);
  console.log('  命中 chrome:', listMatches(wb, 'chrome.exe').join(',') || '(无)');
  console.log('工具模式 rx:', tool);
  console.log('  命中 chrome:', listMatches(tool, 'chrome.exe').join(',') || '(无)');
  console.log('(KILL=1 node scripts/test-killpattern.js 执行真实查杀)');
}

