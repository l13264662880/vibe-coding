// Day 27 最高优先级 Bug 验证脚本（修复后）：合成 DragEvent 直打 App 拖拽处理器
// 浏览器原生拖拽链路已由 tools/probe_drag_diag.js 用真实鼠标手势实证到达处理器；
// 本脚本用合成事件确定性地走同一条处理器路径。fireDrag 即发即忘 + 轮询顺序变化
//（渲染器忙于同步 dispatch 时 CDP 响应可能迟迟不回，不能傻等）。
// 用例A：dragstart 行1 → dragover 行1自己下半 → drop → 顺序应不变（修复前：飞到末尾）
// 用例B：dragstart 行1 → dragover 行2下半 → drop → 前两条换序（回归）
// 用例C：dragstart 行1 → dragover 列表空白(UL) → drop → 到末尾（设计行为回归）
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\probe-profile-' + Date.now();
const PORT = 9345;
const URL = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
const API_HOST = 'yuanjian-d5gdhcntg91022662.service.tcloudbase.com';
// 访问令牌从 app.js 单一来源解析（不在测试工具里重复硬编码，过发布前检查的密钥扫描）
const TOKEN = (fs.readFileSync(__dirname + '/../app.js', 'utf8').match(/APP_TOKEN = '([^']+)'/) || [])[1];
if (!TOKEN) { console.error('未能在 app.js 中解析到 APP_TOKEN'); process.exit(1); }
const OUT_DIR = 'E:\\wordbuddy工作空间\\my-site\\evidence\\day27';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: API_HOST, path, method,
      headers: Object.assign({ 'X-App-Token': TOKEN }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      timeout: 30000,
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(d); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('api timeout')); });
    if (data) req.write(data);
    req.end();
  });
}
const cloudFull = async () => {
  const j = await apiCall('GET', '/api/tasks');
  return ((j && (j.tasks || j.data)) || []).map((t) => t.id);
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-cache', '--window-size=1680,1050', URL,
  ], { detached: false, stdio: 'ignore' });

  let passA = null, passB = null, passC = null;
  try {
    if (!await waitPort(40000)) throw new Error('端口未就绪');
    const ver = JSON.parse(await httpGet('/json/version'));
    const WebSocket = require('ws');
    const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0; const pend = new Map(); let sessionId = null;
    const send = (m, p) => new Promise((rs, rj) => {
      const i = ++id; pend.set(i, { rs, rj });
      const msg = { id: i, method: m, params: p || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
    // 即发即忘：不期待响应
    const sendFF = (m, p) => {
      const i = ++id;
      const msg = { id: i, method: m, params: p || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      pend.delete(i);
    };
    const failAll = (err) => { pend.forEach(({ rj }) => rj(err)); pend.clear(); };
    await new Promise((rs, rj) => { ws.on('open', rs); ws.on('error', rj); });
    ws.on('error', (e) => failAll(new Error('WS错误: ' + e.message)));
    ws.on('close', (c) => { console.log('  [WS] 连接关闭 code=' + c); failAll(new Error('WS关闭')); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const { rs, rj } = pend.get(m.id); pend.delete(m.id); m.error ? rj(new Error(m.error.message)) : rs(m.result); }
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
          console.log('  [evalJs 重试]', e.message);
          await sleep(1500);
        }
      }
    };

    const targets = JSON.parse(await httpGet('/json/list'));
    const pageT = targets.find((t) => t.type === 'page');
    const attachRes = await sendT('Target.attachToTarget', { targetId: pageT.id, flatten: true });
    sessionId = attachRes.sessionId;
    console.log('已 attach 到页面靶机');
    await sendT('Runtime.enable'); await sendT('Page.enable');

    await sleep(5000);
    const isMiddle = await evalJs(`(() => {
      const b = document.querySelector('#submitBtn') || [...document.querySelectorAll('button')].find(e => /确定访问/.test(e.textContent||''));
      return !!b && !b.disabled;
    })()`);
    if (isMiddle === true) {
      await evalJs(`(() => { const b=document.querySelector('#submitBtn')||[...document.querySelectorAll('button')].find(e=>/确定访问/.test(e.textContent||'')); b.click(); return 'ok'; })()`);
      await sleep(2500);
      await sendT('Page.reload', { ignoreCache: true });
      await sleep(3000);
      console.log('已通过中间页');
    }
    // 等 App 加载 + 列表渲染（行数 > 0 才算数）
    for (let i = 0; i < 30; i++) {
      const n = await evalJs(`document.querySelectorAll('#taskList li').length`);
      if (n && n > 0) { console.log(`列表已渲染（${n} 行）`); break; }
      await sleep(1000);
    }
    await evalJs(`location.hash = '#/todo'`);
    await sleep(1000);
    console.log('== 首页已渲染 ==');

    await evalJs(`(() => {
      window.__fireDrag = (srcIdx, targetIdx, after, useBlank) => {
        const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
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
      window.__order = () => [...document.querySelectorAll('#taskList li')].map(li => li.dataset.id);
      window.__openOrder = () => [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('is-done')).map(li => li.dataset.id);
      return 'ok';
    })()`);

    const original = await cloudFull();
    console.log('云端初始顺序:', JSON.stringify(original));

    const showOrder = async (label) => {
      const o = await evalJs(`window.__openOrder()`);
      console.log(`${label}: [${o.join(',')}]`);
      return o;
    };
    // 即发即忘地触发拖拽，然后轮询等顺序变化
    const fireAndWait = async (expr, before, label) => {
      sendFF('Runtime.evaluate', { expression: expr });
      const t0 = Date.now();
      let o = before;
      while (Date.now() - t0 < 10000) {
        await sleep(600);
        try {
          o = await evalJs(`window.__openOrder()`);
          if (JSON.stringify(o) !== JSON.stringify(before)) { await sleep(1200); break; } // 再等 1.2s 让云端同步发出
        } catch (_) {}
      }
      return o;
    };

    // ========== 用例A：松手落回自己身上 ==========
    {
      const before = await showOrder('A 前');
      const after = await fireAndWait(`window.__fireDrag(0, 0, true, false)`, before, 'A');
      passA = JSON.stringify(before) === JSON.stringify(after);
      console.log(passA ? '✅ A 通过：顺序未变（原地不动）' : '❌ A 失败：任务被挪走了');
      if (!passA) { await fireAndWait(`window.__fireDrag(${after.indexOf(before[0])}, 0, false, false)`, after, 'A-还原'); await showOrder('A 还原后'); }
    }

    // ========== 用例B：拖到第2条下半（正常换序） ==========
    {
      const before = await showOrder('B 前');
      const after = await fireAndWait(`window.__fireDrag(0, 1, true, false)`, before, 'B');
      passB = (after[0] === before[1] && after[1] === before[0]);
      console.log(passB ? '✅ B 通过：前两条已换序' : '❌ B 失败：正常换序不生效');
      if (passB) { await fireAndWait(`window.__fireDrag(0, 1, true, false)`, after, 'B-还原'); await showOrder('B 还原后'); }
    }

    // ========== 用例C：拖到列表空白区（设计行为：到未完成区末尾） ==========
    {
      const before = await showOrder('C 前');
      const after = await fireAndWait(`window.__fireDrag(0, 0, true, true)`, before, 'C');
      passC = (after[after.length - 1] === before[0]);
      console.log(passC ? '✅ C 通过：落到未完成区末尾（设计行为）' : '❌ C 失败：未落到末尾');
      if (passC) { await fireAndWait(`window.__fireDrag(${after.indexOf(before[0])}, 0, false, false)`, after, 'C-还原'); await showOrder('C 还原后'); }
    }

    await sleep(1500);
    const finalCloud = await cloudFull();
    console.log('\n收尾云端顺序:', JSON.stringify(finalCloud));
    const same = JSON.stringify(finalCloud.map(String)) === JSON.stringify(original.map(String));
    console.log(same ? '（与初始一致 ✅）' : '（⚠️ 与初始不一致）');
    if (!same) {
      const rs = await apiCall('POST', '/api/tasks/reorder', { order: original });
      console.log('已调用复位 API:', JSON.stringify(rs).slice(0, 80));
      const recheck = await cloudFull();
      console.log('复位后云端:', JSON.stringify(recheck));
    }

    await sendT('Page.captureScreenshot', {}).then((r) => { if (r && r.data) fs.writeFileSync(OUT_DIR + '\\day27-修复验证-拖拽三用例.png', Buffer.from(r.data, 'base64')); }).catch(() => {});

    console.log('\n===== 汇总 =====');
    console.log('A 自拖自放原地不动:', passA ? 'PASS' : 'FAIL');
    console.log('B 正常换序:', passB ? 'PASS' : 'FAIL');
    console.log('C 空白区到末尾:', passC ? 'PASS' : 'FAIL');

    try { ws.close(); } catch (_) {}
  } catch (e) {
    console.error('ERR:', e.message);
    try {
      const v = await httpGet('/json/version');
      console.log('  [诊断] 浏览器:', v.includes('Browser') ? '存活' : '异常');
    } catch (_) {}
  }
  finally { try { child.kill(); } catch (_) {} await sleep(1500); console.log('DONE'); process.exit(0); }
})();
