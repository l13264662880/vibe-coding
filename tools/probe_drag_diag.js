// Day 27 诊断探针：拖拽 drop 在哪些落点被拒绝？记录 target 元素 + defaultPrevented + elementFromPoint
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\probe-profile-' + Date.now();
const PORT = 9337;
const URL = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
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
    console.log('== 首页已渲染 ==');

    // 增强事件日志：target 元素 + defaultPrevented（bubble 阶段后）
    await evalJs(`(() => {
      window.__dragLog = [];
      const desc = (el) => el.tagName + (el.className && typeof el.className === 'string' ? '.' + String(el.className).trim().split(/\\s+/).join('.') : '');
      ['dragstart','dragenter','dragover','drop','dragend','dragleave'].forEach(t =>
        document.addEventListener(t, (e) => {
          window.__dragLog.push(t + '@' + Math.round(e.clientX||0) + ',' + Math.round(e.clientY||0) + ' t=' + desc(e.target));
        }, true));
      window.addEventListener('dragover', (e) => { window.__dragLog.push('  └ dragover后 defaultPrevented=' + e.defaultPrevented); });
      window.addEventListener('drop', (e) => { window.__dragLog.push('  └ drop后 defaultPrevented=' + e.defaultPrevented); });
      return 'ok';
    })()`);

    const grab = async () => await evalJs(`(() => {
      const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
      return lis.slice(0, 3).map(li => {
        const r = li.getBoundingClientRect();
        return { id: li.dataset.id, top: Math.round(r.top), bottom: Math.round(r.bottom), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      });
    })()`);
    const efp = async (x, y) => await evalJs(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return el.tagName + '.' + String(el.className || '').trim().split(/\\s+/).join('.') + ' [' + Math.round(r.top) + '-' + Math.round(r.bottom) + ']';
    })()`);

    const rows = await grab();
    console.log('前三条行:', JSON.stringify(rows));
    for (const off of [-40, 0, 40, 78]) {
      console.log(`落点 (row2.y+${off}) 处的元素:`, await efp(rows[1].x, rows[1].y + off));
    }

    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));
    const dragTo = async (from, toX, toY, label) => {
      await evalJs(`window.__dragLog = []`);
      await mouse('mousePressed', from.x, from.y, { buttons: 1 });
      await mouse('mouseMoved', from.x + 6, from.y, { buttons: 1 });
      await sleep(250);
      for (let s = 1; s <= 6; s++) {
        await mouse('mouseMoved', from.x + (toX - from.x) * s / 6, from.y + (toY - from.y) * s / 6, { buttons: 1 });
        await sleep(60);
      }
      await sleep(500); // 比 350ms 的 dragover 周期更长，确保 dragover 有机会触发
      const log = await evalJs(`window.__dragLog`);
      await mouse('mouseReleased', toX, toY, { buttons: 0 });
      await sleep(300);
      const log2 = await evalJs(`window.__dragLog`);
      await sleep(2200);
      const now = await grab();
      const dropped = log2.some((l) => /^drop@/.test(l));
      console.log(`\n【${label}】落点=(${toX},${toY}) drop事件=${dropped ? '✅有' : '❌无'} 顺序前2=[${now[0].id},${now[1].id}]`);
      console.log('  日志:', JSON.stringify(log2, null, 0));
      return { dropped, order: now.map((r) => r.id) };
    };

    // 依次测试：row2 的 -40 / 0 / +40 / +78 四个落点（每次都从 row1 发起）
    for (const off of [-40, 0, 40, 78]) {
      const r = await grab();
      await dragTo(r[0], r[1].x, r[1].y + off, 'row1→row2' + (off >= 0 ? '+' : '') + off);
      // 若顺序变了就拖回来，保持后续测试基线一致
      const r2 = await grab();
      if (r2[0].id !== r[0].id) {
        await dragTo(r2[0], r2[1].x, r2[1].y - 40, '还原(拖回row2上方)');
      }
    }

    ws.close();
  } catch (e) { console.error('ERR:', e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1500); console.log('DONE'); process.exit(0); }
})();
