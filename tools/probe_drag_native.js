// Day 27 降级自试补充探针 v2：第5步拖拽排序——真实鼠标手势（Input.dispatchMouseEvent）
// 目的：区分「浏览器没发起拖拽」vs「App 拖拽逻辑坏」。附事件捕获日志 + 云端落库核验 + 用完还原。
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\probe-profile-' + Date.now();
const PORT = 9336;
const URL = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-cache', '--window-size=1680,1050', URL,
  ], { detached: false, stdio: 'ignore' });

  try {
    if (!await waitPort(40000)) throw new Error('端口未就绪');
    const list = JSON.parse(await httpGet('/json/list'));
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const WebSocket = require('ws');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0; const pend = new Map();
    const send = (m, p) => new Promise((rs, rj) => { const i = ++id; pend.set(i, { rs, rj }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
    await new Promise((rs, rj) => { ws.on('open', rs); ws.on('error', rj); });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const { rs, rj } = pend.get(m.id); pend.delete(m.id); m.error ? rj(new Error(m.error.message)) : rs(m.result); }
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result ? r.result.value : undefined;
    };
    await send('Runtime.enable'); await send('Page.enable');

    // 中间页
    await sleep(5000);
    const isMiddle = await evalJs(`(() => {
      const b = document.querySelector('#submitBtn') || [...document.querySelectorAll('button')].find(e => /确定访问/.test(e.textContent||''));
      return !!b && !b.disabled;
    })()`);
    if (isMiddle === true) {
      await evalJs(`(() => { const b=document.querySelector('#submitBtn')||[...document.querySelectorAll('button')].find(e=>/确定访问/.test(e.textContent||'')); b.click(); return 'ok'; })()`);
      await sleep(2500);
      await send('Page.reload', { ignoreCache: true });
      console.log('已通过中间页');
    }
    for (let i = 0; i < 15; i++) {
      const t = await evalJs(`(document.body && document.body.innerText || '')`);
      if (t && t.includes('复习高数第三章')) break;
      await sleep(2000);
    }
    await evalJs(`location.hash = '#/todo'`);
    await sleep(1200);
    console.log('== 首页已渲染，切到 #/todo ==');

    // 安装事件捕获日志（不改 app.js，只在 document 上旁听）
    await evalJs(`(() => {
      window.__dragLog = [];
      ['dragstart','dragenter','dragover','drop','dragend'].forEach(t =>
        document.addEventListener(t, (e) => {
          window.__dragLog.push(t + '@' + Math.round(e.clientX||0) + ',' + Math.round(e.clientY||0));
        }, true));
      return 'ok';
    })()`);

    // 取前两条未完成任务
    const grab = async () => await evalJs(`(() => {
      const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
      const first = document.querySelector('#taskList li.is-first .task-text');
      return lis.slice(0, 2).map(li => {
        const r = li.getBoundingClientRect();
        return { id: li.dataset.id, text: (li.querySelector('.task-text')||{}).textContent.slice(0,12), x: r.left + r.width/2, y: r.top + r.height/2 };
      }).concat([{ firstThing: first ? first.textContent.slice(0,20) : null }]);
    })()`);
    const before = await grab();
    console.log('拖拽前:', JSON.stringify(before));

    // 云端顺序（带令牌直查，权威口径；令牌从 app.js 单一来源解析，不重复硬编码）
    const APP_TOKEN = (require('fs').readFileSync(__dirname + '/../app.js', 'utf8').match(/APP_TOKEN = '([^']+)'/) || [])[1];
    const cloudOrder = async () => await evalJs(`(async () => {
      const r = await fetch('https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks', { headers: { 'X-App-Token': '${APP_TOKEN}' } });
      const j = await r.json();
      return (j.tasks||j.data||[]).filter(t => !t.done).map(t => t.id);
    })()`);
    const cloudBefore = await cloudOrder();
    console.log('云端未完成顺序(前):', JSON.stringify(cloudBefore));

    const src = before[0], dst = before[1];
    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));

    // 真实鼠标手势：按下 → 微动发起拖拽 → 分步移到目标行下半部(after) → 松开
    const dragTo = async (from, to, dropOffsetY) => {
      await mouse('mousePressed', from.x, from.y, { buttons: 1 });
      await mouse('mouseMoved', from.x + 6, from.y, { buttons: 1 });
      await sleep(250);
      for (let s = 1; s <= 6; s++) {
        await mouse('mouseMoved', from.x + (to.x - from.x) * s / 6, from.y + (to.y + dropOffsetY - from.y) * s / 6, { buttons: 1 });
        await sleep(60);
      }
      await sleep(400);
      await mouse('mouseReleased', to.x, to.y + dropOffsetY, { buttons: 0 });
      await sleep(2500); // 等渲染 + 云端同步
    };
    await dragTo(src, dst, 40);

    const dragLog = await evalJs(`window.__dragLog.slice(0, 20)`);
    console.log('事件捕获日志:', JSON.stringify(dragLog));
    const after = await grab();
    console.log('拖拽后:', JSON.stringify(after));
    const cloudAfter = await cloudOrder();
    console.log('云端未完成顺序(后):', JSON.stringify(cloudAfter));

    const orderChanged = before[0].id !== after[0].id;
    console.log(orderChanged ? '✅ 拖拽排序生效（页面顺序已变）' : '❌ 页面顺序未变');
    const cloudChanged = JSON.stringify(cloudBefore) !== JSON.stringify(cloudAfter);
    console.log(cloudChanged ? '✅ 云端顺序已同步' : '⚠️ 云端顺序未变');

    await send('Page.captureScreenshot', {}).then((r) => {
      if (r && r.data) fs.writeFileSync(OUT_DIR + '\\day27-降级自试-拖拽排序验证.png', Buffer.from(r.data, 'base64'));
    }).catch(() => {});

    // 还原：把第一条拖回原位（放到第 2 行下半 → 插到它后面）
    if (orderChanged) {
      const now = await grab();
      await dragTo(now[0], now[1], 40);
      const restored = await grab();
      const cloudRestored = await cloudOrder();
      console.log('还原后:', JSON.stringify(restored));
      console.log('还原后云端:', JSON.stringify(cloudRestored));
      console.log(restored[0].id === before[0].id ? '✅ 已还原到原顺序' : '⚠️ 还原后顺序与原始不一致，需人工检查');
    }

    ws.close();
  } catch (e) { console.error('ERR:', e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1500); console.log('DONE'); process.exit(0); }
})();
