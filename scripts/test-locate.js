// 粉丝群发送定位回归测试:复现「发完第 1 个群后,抽屉停在聊天视图,第 2 个群找不到」的场景。
// 只做定位与导航,不输入、不发送任何消息。
// 用法:node scripts/test-locate.js [群1名] [群2名]
'use strict';
const jobs = require('../lib/jobs');
const fg = require('../lib/fangroup');
const { openIM, panelState } = fg.__test;

const G1 = process.argv[2] || '阿川和朋友们的AI交流群';
const G2 = process.argv[3] || '阿川和朋友们的AI交流群2️⃣';

(async () => {
  const job = jobs.create('locate-test');
  const { ctx, page } = await openIM(job);

  // 1) 列表视图:定位群 2(对照:此时应能找到)
  let st = await panelState(page, G2);
  console.log('[1] 列表视图定位群2:', JSON.stringify(st));

  // 2) 点开群 1 → 进入聊天视图(模拟已发送成功后的状态)
  const st1 = await panelState(page, G1);
  if (!st1.row) throw new Error('列表里找不到群1: ' + JSON.stringify(st1));
  await page.mouse.click(st1.row.x, st1.row.y);
  await page.waitForTimeout(2500);

  // 3) 聊天视图:定位群 2 → 应返回 {chat:true, back:{x,y}}
  st = await panelState(page, G2);
  console.log('[2] 聊天视图定位群2:', JSON.stringify(st));
  if (!st.chat || !st.back) throw new Error('聊天视图未返回返回按钮坐标');

  // 4) 真实点击返回按钮 → 应回到列表
  await page.mouse.click(st.back.x, st.back.y);
  await page.waitForTimeout(2000);

  // 5) 再次定位群 2 → 应找到会话行(线上失败点)
  st = await panelState(page, G2);
  console.log('[3] 返回列表后定位群2:', JSON.stringify(st));

  const pass = !!st.row;
  console.log(pass ? `✓ 通过:返回列表后能定位「${G2}」` : '✗ 失败:返回列表后仍未找到目标会话');

  await ctx.close().catch(() => { });
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试异常:', e.message); process.exit(2); });
