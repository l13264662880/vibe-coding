// HTTP 云函数：/api/theme（Day 18 · 主题跨端同步）
//
//   GET  /api/theme  → { ok, data: { theme: 'play' } }   无记录时返回默认 'play'
//   POST /api/theme  → body { theme: 'dark' }            upsert 后返回新值
//
// 用途：主题状态要在 网页版（云端域名）/ 桌面面板 / 桌面精灵 三端保持一致，
//   而三端互相不同源、localStorage 完全隔离，唯一公用的存储就是云端数据库。
//   存储走 PostgREST 网关的 app_state 表（key-value），模式与 api-tasks 一致。
//
// 为什么单独建一个函数而不是塞进 api-tasks：
//   任务和「应用设置」的生命周期、变更频率、校验规则都不同——
//   主题是低频单值写入，任务是多频多行操作，分开部署互不影响。

const http = require('http');

const ENV_ID = 'yuanjian-d5gdhcntg91022662';
const GATEWAY = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const API_KEY = process.env.CLOUDBASE_APIKEY || '';

// 7 套主题的合法 id（白名单校验，防止写进脏数据）
const VALID_THEMES = ['play', 'minimal', 'editorial', 'dark', 'nature', 'retro', 'luxe'];
const DEFAULT_THEME = 'play';

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

// PostgREST 网关请求的统一封装
async function rdb(path, options) {
  const opts = options || {};
  const res = await fetch(`${GATEWAY}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`网关错误 ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const server = http.createServer(async (req, res) => {
  try {
    // ---------------- GET：读当前主题 ----------------
    if (req.method === 'GET') {
      const rows = await rdb('/app_state?select=value&key=eq.theme&limit=1');
      const theme = rows.length > 0 ? rows[0].value : DEFAULT_THEME;
      send(res, 200, { ok: true, data: { theme } });
      return;
    }

    // ---------------- POST：写入当前主题（upsert） ----------------
    if (req.method === 'POST') {
      const raw = await readBody(req);
      let payload;
      try { payload = JSON.parse(raw || '{}'); } catch { payload = null; }

      const theme = payload && typeof payload.theme === 'string' ? payload.theme.trim() : '';
      if (!VALID_THEMES.includes(theme)) {
        log('校验失败：非法主题', theme || '(空)');
        send(res, 400, { ok: false, error: `theme 必须是：${VALID_THEMES.join(' / ')}` });
        return;
      }

      // upsert：主键 key='theme' 冲突时更新 value（PostgREST merge-duplicates）
      await rdb('/app_state?select=key,value', {
        method: 'POST',
        body: { key: 'theme', value: theme },
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      log('主题已更新 →', theme);
      send(res, 200, { ok: true, data: { theme } });
      return;
    }

    send(res, 405, { ok: false, error: '只支持 GET 和 POST' });
  } catch (e) {
    log('异常', e.message);
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(9000);
