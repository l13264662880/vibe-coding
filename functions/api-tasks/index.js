// HTTP 云函数：/api/tasks 读接口（Day 17）
//
// 一个函数同时处理两个路径（路由是前缀匹配，path=/api/tasks 会匹配到子路径）：
//   GET /api/tasks        → 全部未删除任务，按 position 升序（顺序即优先级）
//   GET /api/tasks/first  → 「第一件事」：第 1 位未完成、未删除的任务
//   GET /api/tasks?limit=N → 余力加练：限制返回条数
//
// 数据从哪来：
//   个人版（免费体验版）不支持 TCP 直连 PostgreSQL，这里通过 CloudBase 的
//   PostgREST 网关用 HTTP 读数据：
//     https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/tasks?select=...&...
//   鉴权用服务端 API Key（环境变量 CLOUDBASE_APIKEY，由 cloudbaserc.json 从 .env 注入，
//   明文只存在 .env，不进代码、不进 Git）。
//
// 为什么不用 @cloudbase/node-sdk 的 app.rdb()：
//   rdb().from() 在本环境会把环境 ID 误当 schema 报 PGRST106，REST 网关的
//   裸表名写法反而稳定可靠（Day 17 实测）。

const http = require('http');

const ENV_ID = 'yuanjian-d5gdhcntg91022662';
const GATEWAY = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const API_KEY = process.env.CLOUDBASE_APIKEY || '';

// 返回给前端的字段（刻意对齐 Day 16 tasks 表，不含 deleted_at/created_at/updated_at）
const COLUMNS = 'id,text,position,done,due,estimate';

// 通过 REST 网关查 tasks 表，query 是 PostgREST 查询串
async function fetchTasks(query) {
  const res = await fetch(`${GATEWAY}/tasks?${query}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`网关错误 ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// 统一 JSON 响应
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  // 路由是前缀匹配 /api/tasks，所以 /api/tasks、/api/tasks/first 都会进到这里。
  // 网关可能保留完整路径、也可能剥离前缀，因此只判断「结尾是否是 /first」。
  const path = (req.url || '/').split('?')[0];
  const isFirst = path.endsWith('/first');

  try {
    if (req.method !== 'GET') {
      send(res, 405, { ok: false, error: '只支持 GET' });
      return;
    }

    if (isFirst) {
      // 第一件事：未删除 + 未完成，position 最小的那一条
      const data = await fetchTasks(
        `select=${COLUMNS}&deleted_at=is.null&done=is.false&order=position.asc&limit=1`
      );
      send(res, 200, { ok: true, data: data[0] || null });
      return;
    }

    // 全部任务：未删除，按 position 升序；支持 ?limit=N 限制条数
    const u = new URL(req.url, 'http://localhost');
    const rawLimit = u.searchParams.get('limit');
    let limitQ = '';
    if (rawLimit) {
      const n = Math.max(1, parseInt(rawLimit, 10) || 20);
      limitQ = `&limit=${n}`;
    }
    const data = await fetchTasks(
      `select=${COLUMNS}&deleted_at=is.null&order=position.asc${limitQ}`
    );
    send(res, 200, { ok: true, data });
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(9000);
