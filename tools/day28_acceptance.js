#!/usr/bin/env node
/*
 * Day 28 结营验收官检测脚本（附录 J 可自动化项，一次跑出）
 * ---------------------------------------------------------------
 * 用法（在仓库根目录）：
 *   NODE_PATH="C:/Users/L1326/.workbuddy/binaries/node/workspace/node_modules" \
 *   "C:/Users/L1326/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" \
 *   tools/day28_acceptance.js [roundLabel]
 *
 * 产出：
 *   evidence/day28/day28-acceptance.log            （第一轮，无参数）
 *   evidence/day28/day28-acceptance-<round>.log    （第二轮起，如 round2）
 *   evidence/day28/day28-验收-公网首页.png           （仅第一轮截图）
 *   evidence/day28/day28-验收-写入与持久化.png
 *   evidence/day28/day28-验收-拖拽重排.png
 *
 * 设计要点（全部沿用 Day 27 已验证的模式，不重新发明）：
 *   - CDP 走浏览器端点（/json/version 的 webSocketDebuggerUrl）+ Target.attachToTarget(flatten)，
 *     直连 page 靶机在本机无响应；sessionId 非空才带（null 会被 Chrome 拒）。
 *   - location.reload()/重 dispatch 用即发即忘 + 轮询，渲染器忙时 CDP 响应会迟迟不回。
 *   - 访问令牌从 app.js 单一来源正则解析，不在测试工具里硬编码（过发布前检查的密钥扫描）。
 *   - 拖拽用合成 DragEvent 直打 App 处理器（Day 27 已实证与原生链路到达同一处理器），
 *     确定性强，不依赖视口落点。
 *   - 每个测试块自带清理：完成态改回、编辑改回、拖拽换回、删除撤销、探针删除，
 *     结束时云端顺序/内容与开跑前快照一致（不一致则调 reorder 接口复位并如实记录）。
 *
 * 覆盖：J1-J8 接口侧 + J9-J18 前端行为（PRD 10 条）+ 空态 + 番茄钟复测 + Console error 清点。
 * 人工项（J19-J24 工程交付、两张作业截图）不在本脚本范围，按附录 J 判定方法单独核。
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PORT = 9350;
const SITE = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
const API_HOST = 'yuanjian-d5gdhcntg91022662.service.tcloudbase.com';
const TOKEN = (fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').match(/APP_TOKEN = '([^']+)'/) || [])[1];
if (!TOKEN) { console.error('未能在 app.js 中解析到 APP_TOKEN'); process.exit(1); }

const ROUND = process.argv[2] || '';
const OUT_DIR = path.join(__dirname, '..', 'evidence', 'day28');
const LOG_NAME = 'day28-acceptance' + (ROUND ? '-' + ROUND : '') + '.log';
const TAKE_SHOTS = !ROUND; // 截图只第一轮拍，第二轮日志里指路
const TS = Date.now().toString(36);
const PROBE = 'Day28验收探针' + TS;          // 纯字母数字+汉字，避开 parse.js 全部关键词
const API_PROBE = 'Day28接口校验探针' + TS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logLines = [];
let LOG_PATH = null;
function log(s) {
  logLines.push(s);
  console.log(s);
  if (LOG_PATH) { try { fs.appendFileSync(LOG_PATH, s + '\n'); } catch (_) {} }
}
// 阶段心跳：硬杀（如沙箱 watchdog）时也能从日志看出死在哪个阶段
let phaseStart = Date.now();
function phase(name) { phaseStart = Date.now(); log('→ 阶段: ' + name); }
const heartbeat = setInterval(() => {
  if (LOG_PATH) {
    try { fs.appendFileSync(LOG_PATH, `  [心跳] ${((Date.now() - phaseStart) / 1000).toFixed(1)}s\n`); } catch (_) {}
  }
}, 5000);
process.on('SIGTERM', () => { log('!! 收到 SIGTERM（外部终止），当前阶段已奔跑 ' + ((Date.now() - phaseStart) / 1000).toFixed(1) + 's'); process.exit(3); });
process.on('SIGINT', () => { log('!! 收到 SIGINT'); process.exit(3); });

/* ---------------- 结果收集 ---------------- */
const results = [];
function report(jid, name, pass, detail) {
  results.push({ jid, name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${jid} ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---------------- HTTP 工具 ---------------- */
function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
async function waitPort(max) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    try { const v = await httpGet('/json/version'); if (v.includes('Browser')) return true; } catch (_) {}
    await sleep(500);
  }
  return false;
}
// 接口调用：resolve {status, json}
function apiCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = https.request({
      host: API_HOST, path: apiPath, method,
      headers: Object.assign({ 'X-App-Token': TOKEN },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      timeout: 30000,
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (_) {}
        resolve({ status: res.statusCode, json: j, raw: d });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('api timeout')); });
    if (data) req.write(data);
    req.end();
  });
}
// 站点首页 GET（走公网域名，验证静态托管本身）
function siteGet() {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: 'yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com', path: '/', timeout: 30000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('site timeout')); });
  });
}
const cloudTasks = async () => {
  const r = await apiCall('GET', '/api/tasks');
  return (r.json && r.json.data) || [];
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  LOG_PATH = path.join(OUT_DIR, LOG_NAME);
  fs.rmSync(LOG_PATH, { force: true });
  log('===== Day 28 结营验收官检测' + (ROUND ? '（' + ROUND + '）' : '') + ' =====');
  log('时间: ' + new Date().toLocaleString('zh-CN', { hour12: false }));
  log('站点: ' + SITE);
  log('探针: ' + PROBE + ' / ' + API_PROBE);
  log('');

  /* ================= A. 接口侧（Node 直连，不依赖浏览器） ================= */
  phase('A. 接口侧（J1/J2/J5/J6）');
  log('---- A. 公网与接口（J1/J2/J5/J6） ----');

  // J1 公网首页
  try {
    const r = await siteGet();
    const ok = r.status === 200 && r.body.includes('智伴 PriorityPal') && r.body.includes('taskList');
    report('J1', '公网首页可访问', ok, `GET / → ${r.status}，HTML ${r.body.length} 字节，含标题与 #taskList`);
  } catch (e) { report('J1', '公网首页可访问', false, '异常: ' + e.message); }

  // J2 健康接口
  try {
    const r = await apiCall('GET', '/api/health');
    const ok = r.status === 200 && r.json && r.json.status === 'ok';
    report('J2', '健康接口', ok, `GET /api/health → ${r.status} ${JSON.stringify(r.json).slice(0, 90)}`);
  } catch (e) { report('J2', '健康接口', false, '异常: ' + e.message); }

  // J5 读接口
  let initialCloud = [];
  try {
    const r = await apiCall('GET', '/api/tasks');
    initialCloud = (r.json && r.json.data) || [];
    const ok = r.status === 200 && r.json && r.json.ok === true && initialCloud.length >= 5;
    report('J5', '读接口 GET /api/tasks', ok, `→ ${r.status}，${initialCloud.length} 行真实任务（含 position/done 字段）`);
  } catch (e) { report('J5', '读接口 GET /api/tasks', false, '异常: ' + e.message); }

  // J6 输入校验：空文本 400 + 重复 409（用完即删，保持数据干净）
  try {
    const empty = await apiCall('POST', '/api/tasks', { text: '' });
    const okEmpty = empty.status === 400 && empty.json && /不能为空/.test(empty.json.error || '');
    const dup1 = await apiCall('POST', '/api/tasks', { text: API_PROBE });
    const okCreate = dup1.status === 200 && dup1.json && dup1.json.ok && dup1.json.data && dup1.json.data.id != null;
    const dup2 = await apiCall('POST', '/api/tasks', { text: API_PROBE });
    const okDup = dup2.status === 409 && dup2.json && /已经存在/.test(dup2.json.error || '');
    if (okCreate) await apiCall('DELETE', '/api/tasks?id=' + dup1.json.data.id); // 清理接口探针
    const afterClean = await cloudTasks();
    const cleanOk = !afterClean.some((t) => t.text === API_PROBE);
    report('J6', 'POST 输入校验', okEmpty && okCreate && okDup && cleanOk,
      `空文本 → ${empty.status}「${empty.json && empty.json.error}」；新建 → ${dup1.status} id=${dup1.json && dup1.json.data && dup1.json.data.id}；重复 → ${dup2.status}「${dup2.json && dup2.json.error}」；接口探针已删净: ${cleanOk}`);
  } catch (e) { report('J6', 'POST 输入校验', false, '异常: ' + e.message); }

  /* ================= B. 浏览器侧（CDP 真实浏览器） ================= */
  phase('B. 启动浏览器并打开站点');
  log('');
  log('---- B. 前端行为（J3/J4/J7-J18，真实浏览器自动化） ----');

  const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\probe-profile-d28-' + Date.now();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-cache', '--window-size=1680,1050', 'about:blank',
  ], { detached: false, stdio: 'ignore' });

  const consoleErrors = [];
  let ws = null;
  try {
    if (!await waitPort(40000)) throw new Error('CDP 端口未就绪');
    const ver = JSON.parse(await httpGet('/json/version'));
    const WebSocket = require('ws');
    ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0; const pend = new Map(); let sessionId = null;
    const send = (m, p) => new Promise((rs, rj) => {
      const i = ++id; pend.set(i, { rs, rj });
      const msg = { id: i, method: m, params: p || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
    const sendFF = (m, p) => { // 即发即忘：不期待响应
      const i = ++id;
      const msg = { id: i, method: m, params: p || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      pend.delete(i);
    };
    const failAll = (err) => { pend.forEach(({ rj }) => rj(err)); pend.clear(); };
    await new Promise((rs, rj) => { ws.on('open', rs); ws.on('error', rj); });
    ws.on('error', (e) => failAll(new Error('WS错误: ' + e.message)));
    ws.on('close', (c) => { log('  [WS] 连接关闭 code=' + c); failAll(new Error('WS关闭')); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      // Console error 级事件收集（应用代码报错 + 资源加载失败都记，末尾分类汇报）
      if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
        const txt = (m.params.args || []).map((a) => a.value || a.description || a.unserializableValue || '').join(' ');
        consoleErrors.push('console.error: ' + String(txt).slice(0, 160));
      }
      if (m.method === 'Runtime.exceptionThrown' && m.params) {
        const d = m.params.exceptionDetails || {};
        consoleErrors.push('未捕获异常: ' + String((d.exception && d.exception.description) || d.text || '').slice(0, 160));
      }
      if (m.id && pend.has(m.id)) {
        const { rs, rj } = pend.get(m.id); pend.delete(m.id);
        m.error ? rj(new Error(m.error.message)) : rs(m.result);
      }
    });
    const sendT = (m, p) => Promise.race([
      send(m, p),
      new Promise((_, rj) => setTimeout(() => rj(new Error('CDP超时: ' + m)), 30000)),
    ]);
    const evalJs = async (expr, retry = 2) => {
      for (let a = 0; a <= retry; a++) {
        try {
          const r = await sendT('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
          return r.result ? r.result.value : undefined;
        } catch (e) {
          if (a >= retry) throw e;
          await sleep(1500);
        }
      }
    };

    const targets = JSON.parse(await httpGet('/json/list'));
    const pageT = targets.find((t) => t.type === 'page');
    const attachRes = await sendT('Target.attachToTarget', { targetId: pageT.id, flatten: true });
    sessionId = attachRes.sessionId;
    log('已 attach 到页面靶机（browser 端点 + flatten）');
    await sendT('Runtime.enable'); await sendT('Page.enable');

    /* CloudBase 测试域名中间页（「风险提醒」）通过器：
       间歇性出现（同一脚本多次运行有的撞见有的撞不见），按钮文案不固定
       （见过「确定访问」「继续访问」两种），所以按页面特征识别 + 点主按钮 + 主动 reload。
       返回 true 表示本轮做了通过动作。 */
    let interstitialPasses = 0;
    async function passInterstitialIfAny() {
      if (interstitialPasses >= 4) return false; // 防死循环：最多点 4 次
      try {
        const warn = await evalJs(`(() => {
          if (document.getElementById('loadingState') || document.getElementById('taskList')) return null; // 是 App 页，不是中间页
          const txt = (document.title || '') + ' ' + ((document.body && document.body.innerText) || '').slice(0, 400);
          if (!/风险提醒|访问提示|测试域名|谨慎浏览/.test(txt)) return null;
          const btns = [...document.querySelectorAll('button, a')].filter((b) => b.offsetParent !== null);
          return JSON.stringify({ btns: btns.map((b) => (b.textContent || '').trim().slice(0, 24)).filter(Boolean).slice(0, 6) });
        })()`);
        if (!warn) return false;
        const info = JSON.parse(warn);
        log('  [中间页] 检测到 CloudBase 访问提醒页，可见按钮: ' + JSON.stringify(info.btns));
        const clicked = await evalJs(`(() => {
          const btns = [...document.querySelectorAll('button, a')].filter((b) => b.offsetParent !== null);
          const primary = btns.find((b) => /继续|确定|访问|同意|我已了解|进入/.test((b.textContent || ''))) || btns[btns.length - 1];
          if (!primary) return null;
          const label = (primary.textContent || '').trim().slice(0, 24);
          primary.click();
          return label;
        })()`);
        log('  [中间页] 已点击「' + (clicked || '无可点按钮') + '」');
        interstitialPasses++;
        await sleep(1500);
        await sendT('Page.reload', { ignoreCache: true }); // 点完主动刷新一次，带着放行 cookie 进 App
        await sleep(2500);
        return true;
      } catch (_) { return false; }
    }
    /* 打开站点，等到 App 就绪；超时打页面形态帮助定位 */
    async function gotoSite(url, readyExpr) {
      await sendT('Page.navigate', { url });
      await sleep(2000);
      for (let i = 0; i < 60; i++) {
        await passInterstitialIfAny();
        try { if (await evalJs(readyExpr)) { await injectHelpers(); return true; } } catch (_) {}
        await sleep(1000);
      }
      try {
        const diag = await evalJs(`JSON.stringify({ url: location.href, title: document.title, rows: document.querySelectorAll('#taskList li').length, loadingHidden: document.getElementById('loadingState') ? document.getElementById('loadingState').hidden : 'no-el', emptyHidden: document.getElementById('emptyHint') ? document.getElementById('emptyHint').hidden : 'no-el', body: document.body ? document.body.innerText.slice(0, 120) : '' })`);
        log('  [就绪超时诊断] ' + diag);
      } catch (_) {}
      return false;
    }
    /* 刷新并等 App 重渲染完成，然后重新注入页面辅助——
       Page.reload 会清掉 window.__d28 / __fireDrag（Day 28 实测：不重新注入则刷新后全部误报） */
    async function reloadAndReady() {
      await sendT('Page.reload', { ignoreCache: true });
      for (let i = 0; i < 40; i++) {
        await passInterstitialIfAny();
        try {
          if (await evalJs(READY_LIST)) { await injectHelpers(); return true; }
        } catch (_) {}
        await sleep(1000);
      }
      return false;
    }
    /* 页面内测试辅助（行文本取首个文本节点，避开 .task-meta 小标签）——每次导航/刷新后都要重新注入 */
    async function injectHelpers() {
      await evalJs(`(() => {
        window.__d28 = {
          rowText: (li) => { const t = li.querySelector('.task-text'); return t ? (t.childNodes[0] && t.childNodes[0].nodeType === 3 ? t.childNodes[0].textContent.trim() : t.textContent.trim()) : ''; },
          rows: () => [...document.querySelectorAll('#taskList li')],
          openRows: () => [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('is-done')),
          openTexts: () => window.__d28.openRows().map(li => window.__d28.rowText(li)),
          openIds: () => window.__d28.openRows().map(li => li.dataset.id),
          findRow: (kw) => window.__d28.rows().find(li => window.__d28.rowText(li).includes(kw)) || null,
        };
        window.__fireDrag = (srcIdx, targetIdx, after, useBlank) => {
          const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('is-done'));
          const src = lis[srcIdx];
          const dst = useBlank ? document.querySelector('#taskList') : lis[targetIdx];
          const dt = new DataTransfer();
          const ev = (type, x, y) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y });
          const r = dst.getBoundingClientRect();
          const y = after ? r.bottom - 4 : r.top + 4;
          const x = r.left + r.width / 2;
          src.dispatchEvent(ev('dragstart', x, y));
          dst.dispatchEvent(ev('dragover', x, y));
          dst.dispatchEvent(ev('drop', x, y));
          src.dispatchEvent(ev('dragend', x, y));
        };
        return 'ok';
      })()`);
    }
    const READY_LIST = `document.querySelectorAll('#taskList li').length > 0 && document.getElementById('loadingState').hidden`;
    const READY_EMPTY = `document.getElementById('loadingState').hidden && !document.getElementById('emptyHint').hidden && document.querySelectorAll('#taskList li').length === 0`;

    if (!await gotoSite(SITE, READY_LIST)) throw new Error('站点打开后列表未就绪');
    log('首页已渲染，列表有条目');

    const initialOpen = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
    log('页面初始未完成顺序: ' + JSON.stringify(initialOpen));
    if (TAKE_SHOTS) {
      const shot = await sendT('Page.captureScreenshot', {}).catch(() => null);
      if (shot && shot.data) fs.writeFileSync(path.join(OUT_DIR, 'day28-验收-公网首页.png'), Buffer.from(shot.data, 'base64'));
    }

    /* ---- 附：完成率统计展示（Day 28 余力加练，只读小字） ---- */
    try {
      const st = await evalJs(`(() => {
        const s = document.getElementById('statsLine');
        const rows = document.querySelectorAll('#taskList li');
        const done = document.querySelectorAll('#taskList li.is-done').length;
        return JSON.stringify({ hidden: s.hidden, text: s.textContent.trim(), total: rows.length, done });
      })()`).then(JSON.parse);
      const pct = Math.round((st.done / st.total) * 100);
      const expect = `共 ${st.total} 条 · 已完成 ${st.done} 条（${pct}%）`;
      const ok = !st.hidden && st.text === expect;
      report('附', '完成率统计展示（Day 28 加练）', ok, `#statsLine = 「${st.text}」，与页面实际（${st.total} 条 / ${st.done} 完成）自洽: ${ok}`);
    } catch (e) { report('附', '完成率统计展示（Day 28 加练）', false, '异常: ' + e.message); }

    /* ---- J3/J9：页面写入探针 → 接口落库 → 加到未完成区队尾 ---- */
    phase('J3/J9 页面写入探针');
    const waitCloud = async (cond, timeout = 20000) => {
      const t0 = Date.now(); let last = null;
      while (Date.now() - t0 < timeout) { last = await cloudTasks(); if (cond(last)) return last; await sleep(800); }
      return last;
    };
    try {
      await evalJs(`(() => { const f = document.getElementById('addForm'); const i = document.getElementById('taskInput'); i.value = ${JSON.stringify(PROBE)}; f.requestSubmit(); return 'ok'; })()`);
      // 等行出现（本地即时渲染）
      let rowOk = false;
      for (let i = 0; i < 20; i++) {
        const st = await evalJs(`(() => { const r = window.__d28.findRow(${JSON.stringify(PROBE)}); if (!r) return null; const open = window.__d28.openRows(); return JSON.stringify({last: open[open.length-1] === r, text: window.__d28.rowText(r)}); })()`);
        if (st) { rowOk = JSON.parse(st).last; break; }
        await sleep(600);
      }
      // 等云端落库
      const cloud = await waitCloud((ts) => ts.some((t) => t.text === PROBE));
      const cloudOk = cloud.some((t) => t.text === PROBE);
      report('J3', '一次线上写入（POST）', rowOk && cloudOk, `页面写入「${PROBE}」→ 行已渲染且位于未完成区队尾: ${rowOk}；云端已落库: ${cloudOk}`);
      report('J9', '回车加任务到队尾', rowOk, `未完成区顺序: ${JSON.stringify(await evalJs('JSON.stringify(window.__d28.openTexts())').then(JSON.parse))}`);
      if (TAKE_SHOTS) {
        const shot = await sendT('Page.captureScreenshot', {}).catch(() => null);
        if (shot && shot.data) fs.writeFileSync(path.join(OUT_DIR, 'day28-验收-写入与持久化.png'), Buffer.from(shot.data, 'base64'));
      }
    } catch (e) { report('J3', '一次线上写入（POST）', false, '异常: ' + e.message); report('J9', '回车加任务到队尾', false, '异常: ' + e.message); }

    /* ---- J4/J17：刷新后持久化 ---- */
    phase('J4/J17 刷新后持久化');
    try {
      const before = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      if (!await reloadAndReady()) throw new Error('刷新后页面未就绪');
      const after = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      const ok = JSON.stringify(after) === JSON.stringify(before) && after.includes(PROBE);
      report('J4', '刷新后持久化', !!ok, `刷新前 ${before.length} 条 / 刷新后 ${after.length} 条，顺序一致: ${ok}，探针仍在: ${after.includes(PROBE)}`);
      report('J17', '刷新/重开内容与顺序都在', !!ok, '刷新前后未完成区逐条比对（云端读回，localStorage 首屏双保）');
    } catch (e) { report('J4', '刷新后持久化', false, '异常: ' + e.message); report('J17', '刷新/重开内容与顺序都在', false, '异常: ' + e.message); }

    /* ---- J11：第 1 位全局唯一；J12：第一件事高亮 ---- */
    phase('J11/J12 第一件事唯一性');
    try {
      const st = await evalJs(`(() => {
        const rows = window.__d28.rows();
        const firsts = rows.filter(li => li.classList.contains('is-first'));
        const first = rows[0];
        const focus = document.getElementById('focusText');
        const openFirst = window.__d28.openRows()[0];
        return JSON.stringify({
          firstCount: firsts.length,
          firstIsRow0: firsts.length === 1 && first && first.classList.contains('is-first'),
          indexLabel: first ? first.querySelector('.task-index').textContent : '',
          focusText: focus.textContent.trim(),
          focusEmpty: focus.classList.contains('is-empty'),
          openFirstText: openFirst ? window.__d28.rowText(openFirst) : null,
        });
      })()`).then(JSON.parse);
      const ok11 = st.firstCount === 1 && st.firstIsRow0 && st.indexLabel === '一';
      report('J11', '每个位置只有一条任务，第 1 位全局唯一', ok11, `.is-first 共 ${st.firstCount} 个且落在首行，首行序号「${st.indexLabel}」`);
      const ok12 = !st.focusEmpty && st.openFirstText !== null && st.focusText === st.openFirstText;
      report('J12', '「第一件事」唯一高亮指向第 1 位未完成', ok12, `#focusText = 「${st.focusText}」= 首行未完成任务「${st.openFirstText}」`);
    } catch (e) { report('J11', '每个位置只有一条任务，第 1 位全局唯一', false, '异常: ' + e.message); report('J12', '「第一件事」唯一高亮指向第 1 位未完成', false, '异常: ' + e.message); }

    /* ---- J7a：PATCH 标记完成 → 划线沉底、退出第一件事、云端 done=true；再改回 ---- */
    phase('J7a/J16 标记完成');
    try {
      const before = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      const targetText = before[0];
      const statsBefore = await evalJs(`document.getElementById('statsLine').textContent`);
      // 点首行 ✓
      await evalJs(`window.__d28.openRows()[0].querySelector('.js-done').click()`);
      let st = null;
      for (let i = 0; i < 20; i++) {
        st = await evalJs(`(() => {
          const rows = window.__d28.rows();
          const row = rows.find(li => window.__d28.rowText(li) === ${JSON.stringify(targetText)});
          if (!row || !row.classList.contains('is-done')) return null;
          const open = window.__d28.openRows();
          const focus = document.getElementById('focusText').textContent.trim();
          // 沉底 = 落在所有未完成行之后（进入 done 区）。
          // 不断言「全表最后一行」：库里有更早的已完成任务时，稳定排序下新的完成行排在它前面，仍是沉底。
          const sunk = open.length === 0 || rows.indexOf(row) > rows.indexOf(open[open.length - 1]);
          return JSON.stringify({ sunk, openFirst: open[0] ? window.__d28.rowText(open[0]) : null, focus });
        })()`);
        if (st) { st = JSON.parse(st); break; }
        await sleep(600);
      }
      const cloudDone = await waitCloud((ts) => { const t = ts.find((x) => x.text === targetText); return t && t.done === true; });
      const cloudOk = cloudDone.some((t) => t.text === targetText && t.done === true);
      const okDone = !!st && st.sunk && st.openFirst === before[1] && st.focus === before[1] && cloudOk;
      report('J7', 'PATCH 修改（1/3 标记完成）', okDone, `「${targetText}」标记完成 → 沉入已完成区(所有未完成行之后): ${!!st && st.sunk}，第一件事换人: ${!!st && st.openFirst === before[1]}，云端 done=true: ${cloudOk}`);
      report('J16', '标记完成后划线沉底、不再出现在第一件事', okDone, '同上（沉底 + 第一件事换人 + 云端同步一次验证）');
      // 完成率统计联动（Day 28 加练）：标记完成后统计行完成数 +1、总数不变
      const statsAfter = await evalJs(`document.getElementById('statsLine').textContent`);
      const mB = (statsBefore || '').match(/共 (\d+) 条 · 已完成 (\d+) 条/);
      const mA = (statsAfter || '').match(/共 (\d+) 条 · 已完成 (\d+) 条/);
      const statsLinked = !!(mB && mA && mA[1] === mB[1] && Number(mA[2]) === Number(mB[2]) + 1);
      report('附', '完成率统计随操作联动（Day 28 加练）', statsLinked, `「${statsBefore}」→「${statsAfter}」，完成数 +1 且总数不变: ${statsLinked}`);
      // 再点 ↺ 改回未完成
      await evalJs(`(() => { const row = window.__d28.rows().find(li => window.__d28.rowText(li) === ${JSON.stringify(targetText)}); row.querySelector('.js-done').click(); return 'ok'; })()`);
      let backOk = false;
      for (let i = 0; i < 20; i++) {
        const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
        const now = JSON.parse(v);
        if (JSON.stringify(now) === JSON.stringify(before)) { backOk = true; break; }
        await sleep(600);
      }
      const cloudBack = await waitCloud((ts) => { const t = ts.find((x) => x.text === targetText); return t && t.done === false; });
      log('  完成态已改回未完成，顺序复原: ' + backOk + '，云端 done=false: ' + cloudBack.some((t) => t.text === targetText && t.done === false));
    } catch (e) { report('J7', 'PATCH 修改（1/3 标记完成）', false, '异常: ' + e.message); }

    /* ---- J7b/J15：PATCH 编辑文字 → 位置不变、云端 text 变；再改回 ---- */
    phase('J7b/J15 编辑文字');
    try {
      const before = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      const idx = 1; // 第 2 行，避开首行（首行还要留给别的用例）
      const oldText = before[idx];
      const newText = oldText + '（编辑验收）';
      await evalJs(`window.__d28.openRows()[${idx}].querySelector('.js-edit').click()`);
      // 等编辑框出现 → 改字 → 回车保存
      let editOk = false;
      for (let i = 0; i < 20; i++) {
        const has = await evalJs(`!!document.querySelector('.task-edit-input')`);
        if (has) { editOk = true; break; }
        await sleep(500);
      }
      await evalJs(`(() => { const box = document.querySelector('.task-edit-input'); box.value = ${JSON.stringify(newText)}; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 'ok'; })()`);
      let st = null;
      for (let i = 0; i < 20; i++) {
        const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
        const now = JSON.parse(v);
        if (now.includes(newText)) {
          st = { posSame: now[idx] === newText, len: now.length };
          break;
        }
        await sleep(600);
      }
      const cloudNew = await waitCloud((ts) => ts.some((t) => t.text === newText));
      const cloudOk = cloudNew.some((t) => t.text === newText);
      const okEdit = !!st && st.posSame && st.len === before.length && cloudOk;
      report('J7', 'PATCH 修改（2/3 编辑文字）', okEdit, `第 ${idx + 1} 行「${oldText}」→「${newText}」：位置不变: ${!!st && st.posSame}，条数不变: ${!!st && st.len === before.length}，云端已更新: ${cloudOk}`);
      report('J15', '编辑文字保存后位置不变', okEdit, '同上（第 2 行原地改字，前后位置索引一致）');
      // 改回原文
      await evalJs(`(() => { const row = window.__d28.rows().find(li => window.__d28.rowText(li).includes('（编辑验收）')); if (!row) return 'norow'; row.querySelector('.js-edit').click(); return 'ok'; })()`);
      for (let i = 0; i < 20; i++) {
        const has = await evalJs(`!!document.querySelector('.task-edit-input')`);
        if (has) break;
        await sleep(500);
      }
      await evalJs(`(() => { const box = document.querySelector('.task-edit-input'); box.value = ${JSON.stringify(oldText)}; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 'ok'; })()`);
      let backOk = false;
      for (let i = 0; i < 20; i++) {
        const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
        if (JSON.stringify(JSON.parse(v)) === JSON.stringify(before)) { backOk = true; break; }
        await sleep(600);
      }
      await waitCloud((ts) => ts.some((t) => t.text === oldText) && !ts.some((t) => t.text === newText));
      log('  编辑已改回原文，顺序复原: ' + backOk);
    } catch (e) { report('J7', 'PATCH 修改（2/3 编辑文字）', false, '异常: ' + e.message); report('J15', '编辑文字保存后位置不变', false, '异常: ' + e.message); }

    /* ---- J7c/J10：PATCH 拖拽重排（合成 DragEvent 直打处理器，Day 27 实证路径） ---- */
    phase('J7c/J10 拖拽重排');
    try {
      const before = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      const expect = [before[1], before[0], ...before.slice(2)];
      sendFF('Runtime.evaluate', { expression: `window.__fireDrag(0, 1, true, false)` });
      let domOk = false;
      for (let i = 0; i < 25; i++) {
        try {
          const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
          if (JSON.stringify(JSON.parse(v)) === JSON.stringify(expect)) { domOk = true; break; }
        } catch (_) {}
        await sleep(700);
      }
      const cloudSwapped = await waitCloud((ts) => {
        const ids = ts.map((t) => String(t.id));
        const t0 = ts.find((t) => t.text === before[0]);
        const t1 = ts.find((t) => t.text === before[1]);
        return t0 && t1 && ids.indexOf(String(t1.id)) < ids.indexOf(String(t0.id));
      });
      const cloudOk = cloudSwapped.some((t) => t.text === before[0]) && (() => {
        const t0 = cloudSwapped.find((t) => t.text === before[0]);
        const t1 = cloudSwapped.find((t) => t.text === before[1]);
        return t0 && t1 && cloudSwapped.map((t) => String(t.id)).indexOf(String(t1.id)) < cloudSwapped.map((t) => String(t.id)).indexOf(String(t0.id));
      })();
      const okDrag = domOk && cloudOk;
      report('J7', 'PATCH 修改（3/3 拖拽重排）', okDrag, `拖首行到第 2 行下半 → 前两条换序: DOM ${domOk} / 云端 ${cloudOk}`);
      report('J10', '拖拽任意任务到新位置，松手立即生效', okDrag, '同上（含 Day 27 修复的自拖自放防护，见 evidence/day27）');
      if (TAKE_SHOTS) {
        const shot = await sendT('Page.captureScreenshot', {}).catch(() => null);
        if (shot && shot.data) fs.writeFileSync(path.join(OUT_DIR, 'day28-验收-拖拽重排.png'), Buffer.from(shot.data, 'base64'));
      }
      // 拖回来复原
      sendFF('Runtime.evaluate', { expression: `window.__fireDrag(0, 1, true, false)` });
      let backOk = false;
      for (let i = 0; i < 25; i++) {
        try {
          const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
          if (JSON.stringify(JSON.parse(v)) === JSON.stringify(before)) { backOk = true; break; }
        } catch (_) {}
        await sleep(700);
      }
      await waitCloud((ts) => {
        const ids = ts.map((t) => String(t.id));
        const t0 = ts.find((t) => t.text === before[0]);
        const t1 = ts.find((t) => t.text === before[1]);
        return t0 && t1 && ids.indexOf(String(t0.id)) < ids.indexOf(String(t1.id));
      });
      log('  拖拽已换回原序，顺序复原: ' + backOk);
    } catch (e) { report('J7', 'PATCH 修改（3/3 拖拽重排）', false, '异常: ' + e.message); report('J10', '拖拽任意任务到新位置，松手立即生效', false, '异常: ' + e.message); }

    /* ---- J13/J14：删除补位 + 撤销回位 + 刷新后撤销消失 ---- */
    phase('J13/J14 删除补位与撤销');
    try {
      const before = await evalJs(`JSON.stringify(window.__d28.openTexts())`).then(JSON.parse);
      const delText = before[1];
      const expectAfterDel = before.filter((_, i) => i !== 1);
      await evalJs(`window.__d28.openRows()[1].querySelector('.js-del').click()`);
      // 等行消失（含退场动画 400ms 兜底）
      let delOk = false;
      for (let i = 0; i < 25; i++) {
        const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
        const now = JSON.parse(v);
        if (!now.includes(delText)) { delOk = JSON.stringify(now) === JSON.stringify(expectAfterDel); break; }
        await sleep(600);
      }
      report('J13', '删除后其余任务自动补位，相对顺序不变', delOk, `删第 2 行「${delText}」后顺序: ${JSON.stringify(expectAfterDel)}，实际一致: ${delOk}`);
      // 撤销条出现 → 点撤销 → 回位
      let undoBarOk = false;
      for (let i = 0; i < 15; i++) {
        undoBarOk = await evalJs(`!document.getElementById('undoBar').hidden && /已删除/.test(document.getElementById('undoText').textContent)`);
        if (undoBarOk) break;
        await sleep(500);
      }
      await evalJs(`document.getElementById('undoBtn').click()`);
      let undoOk = false;
      for (let i = 0; i < 25; i++) {
        const v = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
        if (JSON.stringify(JSON.parse(v)) === JSON.stringify(before)) { undoOk = true; break; }
        await sleep(600);
      }
      report('J14', '删除后可撤销，回到删除前位置', undoBarOk && undoOk, `撤销条出现: ${undoBarOk}；点撤销后回到第 ${2} 位: ${undoOk}`);
      // 先等云端 restore 落库，再刷新——否则刷新时云端还是软删除态，会假失败
      const cloudRestored = await waitCloud((ts) => ts.some((t) => t.text === delText));
      log('  云端已恢复被删任务: ' + cloudRestored.some((t) => t.text === delText));
      // 刷新后撤销入口消失
      if (!await reloadAndReady()) throw new Error('刷新后页面未就绪');
      const barHidden = await evalJs(`document.getElementById('undoBar').hidden`);
      const afterReload = await evalJs(`JSON.stringify(window.__d28.openTexts())`);
      const orderKept = JSON.stringify(JSON.parse(afterReload)) === JSON.stringify(before);
      report('J14', '刷新后撤销入口消失', barHidden === true && orderKept, `刷新后 undoBar.hidden: ${barHidden}；顺序保持: ${orderKept}`);
    } catch (e) { report('J13', '删除后其余任务自动补位，相对顺序不变', false, '异常: ' + e.message); report('J14', '删除后可撤销/刷新后撤销消失', false, '异常: ' + e.message); }

    /* ---- J8：DELETE 后云端 0 残留（删 UI 探针） ---- */
    phase('J8 删除 0 残留');
    try {
      await evalJs(`(() => { const row = window.__d28.findRow(${JSON.stringify(PROBE)}); if (!row) return 'norow'; row.querySelector('.js-del').click(); return 'ok'; })()`);
      let domGone = false;
      for (let i = 0; i < 25; i++) {
        const v = await evalJs(`!window.__d28.findRow(${JSON.stringify(PROBE)})`);
        if (v === true) { domGone = true; break; }
        await sleep(600);
      }
      const cloud = await waitCloud((ts) => !ts.some((t) => t.text === PROBE), 25000);
      const cloudGone = !cloud.some((t) => t.text === PROBE);
      const countBack = cloud.length === initialCloud.length;
      report('J8', 'DELETE 删除后云端 0 残留', domGone && cloudGone && countBack, `探针行从页面消失: ${domGone}；云端列表无探针: ${cloudGone}；云端条数回到初始 ${initialCloud.length}: ${countBack}（实测 ${cloud.length}）`);
    } catch (e) { report('J8', 'DELETE 删除后云端 0 残留', false, '异常: ' + e.message); }

    /* ---- J12 空态：?scenario=empty 引导文案 ---- */
    phase('J12 空态 ?scenario=empty');
    try {
      if (!await gotoSite(SITE + '?scenario=empty', READY_EMPTY)) throw new Error('空态页未就绪');
      const st = await evalJs(`(() => {
        const hint = document.getElementById('emptyHint');
        const focus = document.getElementById('focusText');
        return JSON.stringify({
          hintShown: !hint.hidden,
          hintText: hint.textContent.trim(),
          focusText: focus.textContent.trim(),
          focusEmpty: focus.classList.contains('is-empty'),
          rows: document.querySelectorAll('#taskList li').length,
          statsHidden: document.getElementById('statsLine').hidden,
        });
      })()`).then(JSON.parse);
      const ok = st.hintShown && /还没有任务/.test(st.hintText) && st.focusText === '先加一件事' && st.focusEmpty && st.rows === 0 && st.statsHidden === true;
      report('J12', '空列表显示引导文案（?scenario=empty）', ok, `emptyHint 显示: ${st.hintShown}「${st.hintText}」；#focusText: 「${st.focusText}」(is-empty: ${st.focusEmpty})；行数: ${st.rows}；统计行隐藏: ${st.statsHidden}`);
      await gotoSite(SITE, READY_LIST);
    } catch (e) { report('J12', '空列表显示引导文案（?scenario=empty）', false, '异常: ' + e.message); }

    /* ---- 番茄钟复测（Day 27 已验证，结营再确认一次） ---- */
    phase('番茄钟复测');
    try {
      await evalJs(`location.hash = '#/pomodoro'`);
      const t0 = await evalJs(`document.querySelector('#pomoTime').textContent`);
      const phase0 = await evalJs(`document.querySelector('#pomoPhase').textContent`);
      await evalJs(`document.querySelector('#pomoToggle').click()`);
      await sleep(2600);
      const t1 = await evalJs(`document.querySelector('#pomoTime').textContent`);
      const phase1 = await evalJs(`document.querySelector('#pomoPhase').textContent`);
      const label1 = await evalJs(`document.querySelector('#pomoToggle').textContent`);
      await evalJs(`document.querySelector('#pomoReset').click()`);
      const ok = t0 !== t1 && /暂停/.test(label1);
      report('附', '番茄钟启停（Day 13 功能复测）', ok, `${t0}/${phase0} → 开始后 ${t1}/${phase1}，按钮「${label1}」，已重置`);
      await evalJs(`location.hash = '#/todo'`);
    } catch (e) { report('附', '番茄钟启停（Day 13 功能复测）', false, '异常: ' + e.message); }

    /* ---- J18：范围自检（4.1/4.2 砍掉项无入口） ---- */
    phase('J18 范围自检');
    try {
      const found = await evalJs(`(() => {
        // 4.1/4.2 砍掉项关键词（智能排序=保留的预排序，不在此列；AI 录入=保留功能，也不在）
        const banned = ['登录','注册','账号','协作','共享','日历','提醒','四象限','导入','导出','多清单','分类','标签','数据库','AI代排','建议排序','代排'];
        const els = [...document.querySelectorAll('button, a, [aria-label], [title], .view-nav-item, .filter-tab, .sort-btn, .mood-btn, .pomo-btn, .theme-option')];
        const hits = [];
        for (const el of els) {
          const txt = (el.textContent || '') + '|' + (el.getAttribute('aria-label') || '') + '|' + (el.getAttribute('title') || '');
          for (const b of banned) if (txt.includes(b)) hits.push(b + ' ← ' + txt.trim().slice(0, 40));
        }
        return JSON.stringify({ scanned: els.length, hits });
      })()`).then(JSON.parse);
      report('J18', '范围自检：无 4.1/4.2 节功能入口', found.hits.length === 0, `扫描 ${found.scanned} 个可交互元素，砍掉项关键词命中 ${found.hits.length} 处${found.hits.length ? '：' + found.hits.join('；') : ''}`);
    } catch (e) { report('J18', '范围自检：无 4.1/4.2 节功能入口', false, '异常: ' + e.message); }

    /* ---- 收尾：云端状态核对（应与开跑前快照一致） ---- */
    phase('收态核对与 Console 清点');
    const finalCloud = await cloudTasks();
    const sameOrder = JSON.stringify(finalCloud.map((t) => String(t.id))) === JSON.stringify(initialCloud.map((t) => String(t.id)));
    const sameText = JSON.stringify(finalCloud.map((t) => t.text)) === JSON.stringify(initialCloud.map((t) => t.text));
    const sameDone = JSON.stringify(finalCloud.map((t) => !!t.done)) === JSON.stringify(initialCloud.map((t) => !!t.done));
    log('');
    log('---- 收态核对 ----');
    log(`云端顺序与初始一致: ${sameOrder}；文字一致: ${sameText}；完成态一致: ${sameDone}`);
    if (!sameOrder) {
      const rs = await apiCall('POST', '/api/tasks/reorder', { order: initialCloud.map((t) => t.id) });
      log('顺序不一致，已调用 reorder 复位: ' + JSON.stringify(rs.json || rs.raw).slice(0, 80));
      const recheck = await cloudTasks();
      log('复位后云端顺序: ' + JSON.stringify(recheck.map((t) => t.id)));
    }
    if (!sameText) log('⚠️ 文字与初始不一致（如有编辑残留，见上方日志）');
    if (!sameDone) log('⚠️ 完成态与初始不一致（如有完成残留，见上方日志）');

    /* ---- Console error 清点 ---- */
    log('');
    log('---- Console error 清点 ----');
    if (consoleErrors.length === 0) {
      log('全程 console error / 未捕获异常: 0 条');
    } else {
      log(`全程 console error / 未捕获异常: ${consoleErrors.length} 条`);
      consoleErrors.slice(0, 12).forEach((e) => log('  · ' + e));
    }

    /* ---- 汇总 ---- */
    const passN = results.filter((r) => r.pass).length;
    log('');
    log('===== 汇总 =====');
    results.forEach((r) => log(`${r.pass ? '✅' : '❌'} ${r.jid} ${r.name}`));
    log(`通过 ${passN} / ${results.length}`);
    log('云端终态: ' + JSON.stringify(finalCloud.map((t) => ({ id: t.id, done: t.done }))));

    try { ws.close(); } catch (_) {}
  } catch (e) {
    console.error('ERR:', e.message);
    log('运行异常: ' + e.message);
    try {
      const v = await httpGet('/json/version');
      log('  [诊断] 浏览器: ' + (v.includes('Browser') ? '存活' : '异常'));
    } catch (_) {}
  } finally {
    clearInterval(heartbeat);
    try { child.kill(); } catch (_) {}
    await sleep(1200);
    fs.rmSync(PROFILE, { recursive: true, force: true });
    const passN = results.filter((r) => r.pass).length;
    console.log('DONE  通过 ' + passN + ' / ' + results.length + '，日志: evidence/day28/' + LOG_NAME);
    process.exit(passN === results.length && results.length > 0 ? 0 : 1);
  }
})();
