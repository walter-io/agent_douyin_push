# 抖音消息推送 · 独立工具

从自媒体工作台抽取出来的独立小工具：给抖音**群聊和好友/私信**批量推送消息，支持搜索、模板、发送记录。

## 启动

双击 `start.bat`（或命令行 `node server.js`），自动打开 http://127.0.0.1:5220/

## 使用

1. **读取会话列表** — 打开抖音消息中心，滚动加载**全部会话**（群聊 + 好友私信，最多 300 个）。未登录会弹出 Chrome 窗口扫码（只需一次，登录态保存在 `data/profile-douyin`）。结果缓存到本机，进页面直接显示，手动点「读取会话列表」才刷新。
2. **搜索** — 列表上方搜索框按名称筛选；「全选」只选中筛选结果。
3. **勾选 → 填写消息 → 推送** — 逐个会话发送（间隔 4 秒），实时日志，失败的会话不影响其他。
4. **模板** — 常用消息存成模板，下次选择直接填入。
5. **消息记录** — 每次推送的每条消息（成功/失败）都落库（`data/history.json`，最多 500 条），页面可按名称/内容搜索；点击记录可把内容填回输入框重新编辑；可一键清空。

## 注意

- 浏览器自动化用的是干净 Chrome（无自动化标志，无风控弹窗），路径可在页面底部设置里修改（留空自动检测）。
- 弹出的 Chrome 是自动化浏览器，只占用本工具的 profile，不影响你自己开的 Chrome。
- 发送失败会截图存到 `data/screenshots/`，方便排查。
- 端口 5220；CDP 调试端口 9341（与工作台 5210/9331 错开，可同时运行）。

## 结构

```
server.js           HTTP 服务(零依赖,仅 playwright-core)
lib/browser.js      Chrome 拉起 + CDP 连接
lib/fangroup.js     消息中心 RPA(读全量会话/发送/模板)
lib/history.js      消息发送记录(data/history.json)
lib/jobs.js         轻量任务系统(前端轮询)
public/index.html   操作界面
data/               profile-douyin(登录态) / templates.json / fangroup-cache.json / history.json
scripts/test-locate.js        多会话定位回归测试(不发消息)
scripts/test-killpattern.js   查杀匹配模式验证(KILL=1 执行真实查杀)
```

