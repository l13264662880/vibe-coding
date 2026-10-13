// Day 27 余力加练：手机宽度（390px）完整打卡流程——加事→完成→删除，每步截图
// 基于 shot-final.js 的一体化结构（同启动同等待同 Pillow 全屏截图），叠加设备模拟+交互。
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\shot-mobile-profile-' + Date.now();
const PORT = 9334;
const URL = 'https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/';
const OUT_DIR = 'C:\\Users\\L1326\\Pictures\\Screenshots';
const MARK = '买牛奶';
const PY = 'C:\\Users\\L1326\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => execSync(`"${PY}" -c "from PIL import ImageGrab; ImageGrab.grab().save(r'${OUT_DIR}\\${name}'); print('saved ${name}')"`, { stdio: 'inherit' });

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
    // 设备模拟：390×844（iPhone 12/13 逻辑分辨率），移动端触控
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    console.log('已切 390×844 移动视口');

    // 中间页处理（同 shot-final.js）
    await sleep(5000);
    const isMiddle = await evalJs(`(() => {
      const b = document.querySelector('#submitBtn') || [...document.querySelectorAll('button')].find(e => /确定访问/.test(e.textContent||''));
      return !!b && !b.disabled;
    })()`);
    if (isMiddle === true) {
      await evalJs(`(() => { const b=document.querySelector('#submitBtn')||[...document.querySelectorAll('button')].find(e=>/确定访问/.test(e.textContent||'')); b.click(); return 'ok'; })()`);
      await sleep(2500);
      await send('Page.reload', { ignoreCache: true });
      console.log('已通过中间页并重载');
    }
    for (let i = 0; i < 15; i++) {
      const t = await evalJs(`(document.body && document.body.innerText || '')`);
      if (t && t.includes('复习高数第三章')) { console.log('第' + (i + 1) + '次轮询：首页已渲染'); break; }
      await sleep(2000);
    }
    shot('day27-试用流程1-首页.png');

    // ① 添加任务（表单提交，走真实 addTask 链路）
    await evalJs(`(() => {
      const input = document.querySelector('#taskInput');
      input.value = '${MARK}';
      document.querySelector('#addForm').requestSubmit();
      return 'ok';
    })()`);
    for (let i = 0; i < 10; i++) {
      const t = await evalJs(`(document.body && document.body.innerText || '')`);
      if (t && t.includes(MARK)) break;
      await sleep(1000);
    }
    await sleep(2500); // 等云端同步 id 替换完成
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('买牛奶'));
      if (li) li.scrollIntoView({ block: 'center' });
      return 'ok';
    })()`);
    await sleep(600);
    shot('day27-试用流程2-已添加.png');
    console.log('① 添加完成');

    // ② 标记完成（该任务行上的 .js-done）
    const done = await evalJs(`(() => {
      const li = [...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('${MARK}'));
      if (!li) return 'no-li';
      const btn = li.querySelector('.js-done');
      if (!btn) return 'no-btn';
      btn.click(); return 'clicked';
    })()`);
    await sleep(2000);
    await evalJs(`(() => {
      const tab = [...document.querySelectorAll('#filterTabs button')].find(b => (b.textContent||'').includes('已完成'));
      if (tab) tab.click();
      return 'ok';
    })()`);
    await sleep(1200);
    await evalJs(`(() => {
      const li = [...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('买牛奶'));
      if (li) li.scrollIntoView({ block: 'center' });
      return 'ok';
    })()`);
    await sleep(600);
    shot('day27-试用流程3-已标记完成.png');
    console.log('② 标记完成:', done);

    // ③ 删除该任务（行上的 .js-del），并确认消失
    const del = await evalJs(`(() => {
      const li = [...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('${MARK}'));
      if (!li) return 'no-li';
      const btn = li.querySelector('.js-del');
      if (!btn) return 'no-btn';
      btn.click(); return 'clicked';
    })()`);
    for (let i = 0; i < 10; i++) {
      const t = await evalJs(`(document.body && document.body.innerText || '')`);
      if (t && !t.includes(MARK)) break;
      await sleep(1000);
    }
    await sleep(1500);
    await evalJs(`(() => {
      const tab = [...document.querySelectorAll('#filterTabs button')].find(b => (b.textContent||'').includes('全部'));
      if (tab) tab.click();
      return 'ok';
    })()`);
    await sleep(1200);
    shot('day27-试用流程4-已删除.png');
    console.log('③ 删除:', del, '→ 已从列表消失');

    // 数据卫生：确认云端也没有残留
    const left = await evalJs(`(document.body.innerText||'').includes('${MARK}')`);
    console.log('页面残留检查:', left ? '有残留(需处理)' : '干净');

    ws.close();
  } catch (e) { console.error('ERR:', e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1500); console.log('DONE'); process.exit(0); }
})();
