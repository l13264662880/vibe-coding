// 最小 CDP 调试 v2：走 browser 级端点 + Target.attachToTarget(flatten)
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe';
const PROFILE = 'C:\\Users\\L1326\\.workbuddy\\dbg-profile-' + Date.now();
const PORT = 9342;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
(async () => {
  const child = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
    '--user-data-dir=' + PROFILE, '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-cache', '--window-size=1680,1050', 'about:blank',
  ], { detached: false, stdio: 'ignore' });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      try { const v = await httpGet('/json/version'); if (v.includes('Browser')) break; } catch (_) {}
      await sleep(500);
    }
    const ver = JSON.parse(await httpGet('/json/version'));
    console.log('browser ws:', ver.webSocketDebuggerUrl);
    const WebSocket = require('ws');
    const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((rs, rj) => { ws.on('open', rs); ws.on('error', rj); });
    console.log('browser WS 已连接');
    ws.on('message', (raw) => {
      const s = raw.toString();
      console.log('<= 帧:', s.slice(0, 400));
    });
    let id = 0;
    const send = (m, p, sessionId) => ws.send(JSON.stringify(sessionId ? { id: ++id, method: m, params: p || {}, sessionId } : { id: ++id, method: m, params: p || {} }));
    send('Target.getTargets');
    await sleep(3000);
    // attach 到第一个 page target
    const list = JSON.parse(await httpGet('/json/list'));
    const page = list.find((t) => t.type === 'page');
    console.log('attach 到 page target:', page.id, page.url.slice(0, 50));
    send('Target.attachToTarget', { targetId: page.id, flatten: true });
    await sleep(3000);
    // 上面 attach 的 sessionId 需要从响应里拿——简化：再发一次并用回调抓
    // 直接尝试：用 page 自己的 ws 但等 2 秒再发
    const ws2 = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((rs, rj) => { ws2.on('open', rs); ws2.on('error', rj); });
    ws2.on('message', (raw) => console.log('  [page-ws] <= 帧:', raw.toString().slice(0, 300)));
    ws2.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }));
    console.log('  [page-ws] => Runtime.enable 已发（等 6 秒）');
    await sleep(6000);
    ws2.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: '1+1', returnByValue: true } }));
    await sleep(5000);
    ws2.close(); ws.close();
  } catch (e) { console.error('ERR:', e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1000); console.log('DONE'); process.exit(0); }
})();
