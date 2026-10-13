// Day 27 降级自试补充探针：第5步拖拽排序 + 第6步番茄钟（自动化未覆盖的两项）
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\probe-profile-' + Date.now();
const PORT = 9335;
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
    console.log('== 首页已渲染 ==');

    // ===== 第6步：番茄钟 =====
    await evalJs(`location.hash = '#/pomodoro'`);
    await sleep(1200);
    const t0 = await evalJs(`document.querySelector('#pomoTime').textContent`);
    const phase0 = await evalJs(`document.querySelector('#pomoPhase').textContent`);
    await evalJs(`document.querySelector('#pomoToggle').click()`);
    await sleep(4000);
    const t1 = await evalJs(`document.querySelector('#pomoTime').textContent`);
    const phase1 = await evalJs(`document.querySelector('#pomoPhase').textContent`);
    const toggleLabel = await evalJs(`document.querySelector('#pomoToggle').textContent`);
    console.log(`番茄钟: 初始 ${t0}/${phase0} → 点开始后 ${t1}/${phase1}（按钮文案「${toggleLabel}」）`);
    const pomoOk = t0 !== t1;
    console.log(pomoOk ? '✅ 番茄钟倒计时正常走动' : '❌ 番茄钟点了开始但时间不动');
    // 还原：重置
    await evalJs(`document.querySelector('#pomoReset').click()`);

    // ===== 第5步：拖拽排序（HTML5 DnD，CDP dispatchDragEvent）=====
    await evalJs(`location.hash = '#/todo'`);
    await sleep(1200);
    // 取前两条未完成任务的信息（id + 文本 + 位置）
    const before = await evalJs(`(() => {
      const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
      return lis.slice(0, 2).map(li => ({ id: li.dataset.id, text: (li.querySelector('.task-text')||{}).textContent || li.textContent.slice(0,10) }));
    })()`);
    console.log('拖拽前两条:', JSON.stringify(before));
    if (before.length >= 2) {
      // 用 CDP 拖拽事件序列把第 1 条拖到第 2 条后面
      const box = async (sel) => await send('DOM.getBoxModel', sel).catch(() => null);
      // 简化：用 JS 合成 HTML5 拖拽事件（dataTransfer 桩）——验证业务逻辑是否接得住
      const dragResult = await evalJs(`(() => {
        const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
        if (lis.length < 2) return 'less-than-2';
        const src = lis[0], dst = lis[1];
        const dt = new DataTransfer();
        const fire = (el, type, data) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
        fire(src, 'dragstart', dt);
        // 拖到目标下半部 → after=true
        const r = dst.getBoundingClientRect();
        Object.defineProperty(dst, 'getBoundingClientRect', { value: () => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width, x: r.x, y: r.bottom - 5 }) });
        fire(dst, 'dragover', dt);
        fire(dst, 'drop', dt);
        fire(src, 'dragend', dt);
        return 'fired';
      })()`);
      await sleep(2500); // 等云端同步
      const after = await evalJs(`(() => {
        const lis = [...document.querySelectorAll('#taskList li')].filter(li => !li.classList.contains('done'));
        return lis.slice(0, 2).map(li => ({ id: li.dataset.id, text: (li.querySelector('.task-text')||{}).textContent || li.textContent.slice(0,10) }));
      })()`);
      console.log('拖拽后两条:', JSON.stringify(after), '事件序列:', dragResult);
      const orderChanged = before[0].id !== after[0].id;
      console.log(orderChanged ? '✅ 拖拽排序生效（前两条顺序已变）' : '⚠️ 顺序未变——需人工复核（合成事件可能不触发真实拖拽）');
    }

    ws.close();
  } catch (e) { console.error('ERR:', e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1500); console.log('DONE'); process.exit(0); }
})();
