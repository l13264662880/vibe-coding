// Day 28：附录 J 验收清单截图（双路输出）。
//  ① CDP 全页高清图（撑满宽度、原尺寸、完整 24 项）→ argv[3]，
//     同时存 evidence/day28/附录J-验收清单-全页.png —— 作业主图，逐项打勾最清晰。
//  ② Pillow 全屏截图（含浏览器地址栏，证明「当场在浏览器打开」）→ argv[4]，
//     默认 evidence/day28/附录J-验收清单-浏览器窗口.png。
// 注：本机 125% 缩放下 --start-maximized / user32 最大化均不稳定，窗口截图改为
// 按比例缩放保证 24 项一屏可见；全页图不受窗口状态影响。
// 用法: node tools/day28_shot_doc.js <html路径> <全页输出png> [窗口截图png] [标记文本]
const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");

const CHROME = "C:\\Users\\L1326\\.agent-browser\\browsers\\chrome-154.0.8037.92\\chrome.exe";
const PROFILE = "C:\\Users\\L1326\\WorkBuddy\\2026-10-05-08-50-39\\.workbuddy\\shot-doc-profile-" + Date.now();
const PORT = 9334;
const HTML = process.argv[2];
const OUT_PNG = process.argv[3];
const WIN_PNG = process.argv[4] || path.join(__dirname, "..", "evidence", "day28", "附录J-验收清单-浏览器窗口.png");
const MARKER = process.argv[5] || "汇总";
const EVIDENCE_PNG = path.join(__dirname, "..", "evidence", "day28", "附录J-验收清单-全页.png");
const PY = "C:\\Users\\L1326\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: p, timeout: 20000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}
async function waitPort(max) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    try { const v = await httpGet("/json/version"); if (v.includes("Browser")) return true; } catch (_) {}
    await sleep(500);
  }
  return false;
}

(async () => {
  const fileUrl = "file:///" + path.resolve(HTML).replace(/\\/g, "/");
  console.log("打开:", fileUrl);
  fs_rm(PROFILE);
  const child = spawn(CHROME, [
    "--remote-debugging-port=" + PORT, "--remote-allow-origins=*",
    "--user-data-dir=" + PROFILE, "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--disable-cache", "--start-maximized", fileUrl,
  ], { detached: false, stdio: "ignore" });

  try {
    if (!await waitPort(40000)) throw new Error("端口未就绪");
    const list = JSON.parse(await httpGet("/json/list"));
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) throw new Error("无页面");

    const WebSocket = require("ws");
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0; const pend = new Map();
    const send = (m, p) => new Promise((rs, rj) => { const i = ++id; pend.set(i, { rs, rj }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
    await new Promise((rs, rj) => { ws.on("open", rs); ws.on("error", rj); });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const { rs, rj } = pend.get(m.id); pend.delete(m.id); m.error ? rj(new Error(m.error.message)) : rs(m.result); }
    });
    const evalJs = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result ? r.result.value : undefined;
    };

    await send("Runtime.enable"); await send("Page.enable");

    // 1. 等渲染（标记文本出现）
    let rendered = false;
    for (let i = 0; i < 15; i++) {
      const t = await evalJs(`(document.body && document.body.innerText || '')`);
      if (t && t.includes(MARKER)) { rendered = true; break; }
      await sleep(500);
    }
    if (!rendered) throw new Error("清单未渲染（标记文本未出现）");
    await sleep(400);

    // 1.5 最大化窗口：--start-maximized 偶发不生效，且启动期外部置窗会被 Chrome 覆盖，
    // 所以在页面渲染稳定后用 user32 ShowWindow 强制最大化 + 置顶，并验证重试。
    {
      const ps = [
        "$sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
        "$t = Add-Type -MemberDefinition $sig -Name W32Shot -Namespace Win32 -PassThru",
        "$p = Get-Process chrome | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1",
        "if ($p) { $t::SetForegroundWindow($p.MainWindowHandle); $t::ShowWindow($p.MainWindowHandle, 3) }",
      ].join("; ");
      const psCmd = "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand " +
        Buffer.from(ps, "utf16le").toString("base64");
      for (let attempt = 0; attempt < 3; attempt++) {
        const vh = await evalJs("window.innerHeight");
        if (vh && vh > 800) break; // 125% 缩放的 1080p 逻辑桌面约 864，最大化后视口约 810+
        try { execSync(psCmd, { stdio: "ignore" }); } catch (e) { console.log("最大化命令失败:", e.message); }
        await sleep(900);
        console.log(`PowerShell 最大化（第 ${attempt + 1} 次）`);
      }
    }
    const vhFinal = await evalJs("window.innerHeight");
    const vwFinal = await evalJs("window.innerWidth");
    console.log(`窗口视口: ${vwFinal}x${vhFinal}`);

    // 2. CDP 全页高清备份（缩放前原尺寸，无浏览器界面，完整 24 项）。
    // 同时作为作业主图：撑满窗口宽度去掉两侧灰边，文字最大最清晰。
    try {
      await evalJs(`(() => { const p = document.querySelector('.page'); if (p) p.style.maxWidth = 'none'; return 'ok'; })()`);
      await sleep(250);
      const metrics = await send("Page.getLayoutMetrics");
      const cs = metrics.cssContentSize || metrics.contentSize;
      const shot = await send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true, fromSurface: true,
        clip: { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 },
      });
      require("fs").writeFileSync(OUT_PNG, Buffer.from(shot.data, "base64"));
      require("fs").copyFileSync(OUT_PNG, EVIDENCE_PNG);
      console.log("全页图已存:", OUT_PNG, `与 ${EVIDENCE_PNG}`, `${cs.width}x${cs.height}`);
    } catch (e) { console.log("全页图失败:", e.message); }

    // 3. 自适应缩放：内容超出一屏时按比例缩小并撑满宽度（浏览器窗口截图用）
    const m1 = await evalJs(`(() => {
      const page = document.querySelector('.page');
      return { h: document.documentElement.scrollHeight, vh: window.innerHeight, vw: window.innerWidth,
               zoom: page ? getComputedStyle(page).zoom : '1' };
    })()`);
    console.log(`初始: 内容高 ${m1.h}px / 视口高 ${m1.vh}px / 视口宽 ${m1.vw}px`);
    let scale = 1;
    const avail = m1.vh - 10;
    if (m1.h > avail) {
      scale = Math.max(0.45, Math.min(1, avail / m1.h));
      await evalJs(`(() => {
        const p = document.querySelector('.page');
        p.style.zoom = '${scale}';
        p.style.maxWidth = '${Math.round(m1.vw / scale)}px';
        return 'ok';
      })()`);
      await sleep(300);
      // 缩窄后重排可能仍略高，做一次修正
      const m2 = await evalJs(`(() => ({ h: document.documentElement.scrollHeight, vh: window.innerHeight }))()`);
      if (m2.h > m2.vh - 8) {
        const fix = Math.max(0.4, (m2.vh - 12) / m2.h);
        await evalJs(`(() => { const p=document.querySelector('.page'); p.style.zoom = String(${scale} * ${fix}); return 'ok'; })()`);
        await sleep(300);
        console.log(`二次修正: zoom = ${(scale * fix).toFixed(3)}`);
      }
      const m3 = await evalJs(`(() => ({ h: document.documentElement.scrollHeight, vh: window.innerHeight }))()`);
      console.log(`缩放后: 内容高 ${m3.h}px / 视口高 ${m3.vh}px（zoom ${scale.toFixed(3)}）`);
    }

    // 4. Pillow 全屏截图（含地址栏，证明「当场在浏览器打开」）
    await sleep(600);
    execSync(`"${PY}" -c "from PIL import ImageGrab; ImageGrab.grab().save(r'${WIN_PNG}'); print('saved')"`, { stdio: "inherit" });

    ws.close();
  } catch (e) { console.error("ERR:", e.message); }
  finally { try { child.kill(); } catch (_) {} await sleep(1200); console.log("DONE"); process.exit(0); }
})();

function fs_rm(p) { try { require("fs").rmSync(p, { recursive: true, force: true }); } catch (_) {} }
