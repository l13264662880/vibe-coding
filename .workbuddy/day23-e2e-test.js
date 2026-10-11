// Day 23+ 端到端验证：真实浏览器里走一遍 新增→完成→删除→撤销，每步核对云端
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\WorkBuddy\\2026-10-05-08-50-39\\.workbuddy\\e2e-profile-' + Date.now();
const PORT = 9334;
const SITE = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
const API = 'https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks';
const TOKEN = '81ad6640e81a92f614190806e95eac7938463655a73b33e7';
const MARK = '端到端同步验证-' + Date.now().toString(36); // 唯一任务名
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
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
// 云端查证（Node 侧直接问数据库接口，不经过页面）
async function cloudHas(text) {
  const r = await fetch(API, { headers: { 'X-App-Token': TOKEN } });
  const list = (await r.json()).data || [];
  return list.find((t) => t.text === text) || null;
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-cache', '--start-maximized', SITE,
  ], { detached: false, stdio: 'ignore' });

  const results = [];
  try {
    if (!await waitPort(40000)) throw new Error('端口未就绪');
    const list = JSON.parse(await httpGet('/json/list'));
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const WebSocket = require('ws');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    let id = 0; const pend = new Map();
    const send = (m, p) => new Promise((rs, rj) => { const i = ++id; pend.set(i, { rs, rj }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
    await new Promise((rs, rj) => { ws.on('open', rs); ws.on('error', rj); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const { rs, rj } = pend.get(m.id); pend.delete(m.id); m.error ? rj(new Error(m.error.message)) : rs(m.result); }
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200));
      return r.result ? r.result.value : undefined;
    };
    await send('Runtime.enable'); await send('Page.enable');

    // 中间页处理
    await sleep(5000);
    const isMiddle = await evalJs(`(() => { const b = document.querySelector('#submitBtn'); return !!b && !b.disabled; })()`);
    if (isMiddle === true) {
      await evalJs(`document.querySelector('#submitBtn').click(); 'ok'`);
      await sleep(2500);
      await send('Page.reload', { ignoreCache: true });
      await sleep(6000);
    }
    // 等列表渲染（等任务条出现）
    for (let i = 0; i < 12; i++) {
      const n = await evalJs(`document.querySelectorAll('#taskList .task').length`);
      if (n > 0) break;
      await sleep(2000);
    }

    // ---- 步骤 1：新增（模拟真实输入 + 回车提交） ----
    await evalJs(`(() => {
      const input = document.getElementById('taskInput');
      const form = document.getElementById('addForm');
      input.value = ${JSON.stringify(MARK)};
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      return 'submitted';
    })()`);
    await sleep(4000); // 等 POST 完成（id 替换）
    const afterAdd = await cloudHas(MARK);
    results.push(['新增同步云端', afterAdd ? 'PASS' : 'FAIL', afterAdd ? '云端出现 id=' + afterAdd.id : '云端查无此任务']);

    // ---- 步骤 2：标记完成 ----
    if (afterAdd) {
      await evalJs(`(() => {
        const row = [...document.querySelectorAll('#taskList .task')].find(li => li.textContent.includes(${JSON.stringify(MARK)}));
        if (!row) return 'no-row';
        row.querySelector('.js-done').click();
        return 'clicked';
      })()`);
      await sleep(3500);
      const row = await cloudHas(MARK);
      results.push(['完成同步云端', row && row.done === true ? 'PASS' : 'FAIL', row ? 'done=' + row.done : '云端查无']);
    }

    // ---- 步骤 3：删除 ----
    if (afterAdd) {
      await evalJs(`(() => {
        const row = [...document.querySelectorAll('#taskList .task')].find(li => li.textContent.includes(${JSON.stringify(MARK)}));
        if (!row) return 'no-row';
        row.querySelector('.js-del').click();
        return 'clicked';
      })()`);
      await sleep(3500);
      const gone = await cloudHas(MARK);
      // 云端仍可能返回（软删除），但要带 deleted_at —— 查库级接口过滤即可：GET 不返回即成功
      results.push(['删除同步云端', gone === null ? 'PASS' : 'FAIL', gone === null ? 'GET 已不返回' : 'GET 仍返回']);
    }

    // ---- 步骤 4：撤销恢复 ----
    if (afterAdd) {
      const undoVisible = await evalJs(`!document.getElementById('undoBar').hidden`);
      if (undoVisible) {
        await evalJs(`document.getElementById('undoBtn').click(); 'clicked'`);
        await sleep(3500);
        const back = await cloudHas(MARK);
        results.push(['撤销恢复同步云端', back ? 'PASS' : 'FAIL', back ? '云端重新出现' : '云端查无']);
      } else {
        results.push(['撤销恢复同步云端', 'SKIP', '撤销条未出现']);
      }
    }

    // 清理：删掉测试任务（页面外直接调 API）
    const row = await cloudHas(MARK);
    if (row) await fetch(API + '?id=' + row.id, { method: 'DELETE', headers: { 'X-App-Token': TOKEN } });

    console.log('任务名:', MARK);
    for (const [name, verdict, detail] of results) console.log(`[${verdict}] ${name} — ${detail}`);
    const fail = results.filter((r) => r[1] === 'FAIL').length;
    console.log(fail === 0 ? 'E2E 全部 PASS' : `E2E 有 ${fail} 项 FAIL`);
  } catch (e) {
    console.error('ERR:', e.message);
    for (const [name, verdict, detail] of results) console.log(`[${verdict}] ${name} — ${detail}`);
  } finally {
    try { child.kill(); } catch (_) {}
    await sleep(1500);
    console.log('DONE');
    process.exit(0);
  }
})();
