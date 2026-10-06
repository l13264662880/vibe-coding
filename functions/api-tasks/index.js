// HTTP 云函数：/api/tasks（Day 17 读接口 + Day 18 写接口）
//
// 一个函数同时处理多个路径和方法（路由是前缀匹配，path=/api/tasks 会匹配子路径）：
//   GET  /api/tasks         → 全部未删除任务，按 position 升序
//   GET  /api/tasks/first   → 「第一件事」：第 1 位未完成、未删除的任务
//   GET  /api/tasks?limit=N → 限制返回条数
//   POST /api/tasks         → 新增任务（Day 18）
//
// 数据从哪来：
//   个人版（免费体验版）不支持 TCP 直连 PostgreSQL，这里通过 CloudBase 的
//   PostgREST 网关用 HTTP 读写数据：
//     https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/tasks
//   鉴权用服务端 API Key（环境变量 CLOUDBASE_APIKEY，由 cloudbaserc.json 从 .env 注入）。
//
// 为什么不用 @cloudbase/node-sdk 的 app.rdb()：
//   rdb().from() 在本环境会把环境 ID 误当 schema 报 PGRST106，REST 网关的
//   裸表名写法反而稳定可靠（Day 17 实测）。

const http = require('http');

const ENV_ID = 'yuanjian-d5gdhcntg91022662';
const GATEWAY = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const API_KEY = process.env.CLOUDBASE_APIKEY || '';

// 返回给前端的字段（对齐 Day 16 tasks 表，不含 deleted_at/created_at/updated_at）
const COLUMNS = 'id,text,position,done,due,estimate';

// 统一 JSON 响应
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 服务端日志（Day 18 余力加练）：排查问题用 `tcb fn log api-tasks` 看
function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// 读请求体（POST 的 body 要手动读流）
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

// 通过 REST 网关查（GET），path 形如 `/tasks?select=...&...`
async function queryRdb(path) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`网关读取错误 ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// 通过 REST 网关写（POST），返回插入的行（数组）
async function insertRdb(table, body, select) {
  const url = `${GATEWAY}/${table}` + (select ? `?select=${select}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation', // 让 PostgREST 返回插入后的行（含自增 id）
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`网关写入错误 ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

const server = http.createServer(async (req, res) => {
  // 路由是前缀匹配 /api/tasks，所以 /api/tasks、/api/tasks/first 都会进到这里。
  // 网关可能保留完整路径、也可能剥离前缀，因此只判断「结尾是否是 /first」。
  const path = (req.url || '/').split('?')[0];
  const isFirst = path.endsWith('/first');

  try {
    // ---------------- GET 读（Day 17） ----------------
    if (req.method === 'GET') {
      if (isFirst) {
        const data = await queryRdb(
          `/tasks?select=${COLUMNS}&deleted_at=is.null&done=is.false&order=position.asc&limit=1`
        );
        send(res, 200, { ok: true, data: data[0] || null });
        return;
      }
      const u = new URL(req.url, 'http://localhost');
      const rawLimit = u.searchParams.get('limit');
      let limitQ = '';
      if (rawLimit) {
        const n = Math.max(1, parseInt(rawLimit, 10) || 20);
        limitQ = `&limit=${n}`;
      }
      const data = await queryRdb(
        `/tasks?select=${COLUMNS}&deleted_at=is.null&order=position.asc${limitQ}`
      );
      send(res, 200, { ok: true, data });
      return;
    }

    // ---------------- POST 新增任务（Day 18） ----------------
    if (req.method === 'POST') {
      log('收到 POST /api/tasks');

      // 1. 读并解析请求体
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        log('请求体不是合法 JSON');
        send(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
        return;
      }

      // 2. 校验必填字段 text（防「错误输入」：空文本）
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) {
        log('校验失败：任务内容为空');
        send(res, 400, { ok: false, error: '任务内容不能为空' });
        return;
      }

      // 3. 查重（防「重复提交」：相同 text 的未删除任务已存在）
      const dup = await queryRdb(
        `/tasks?select=id&text=eq.${encodeURIComponent(text)}&deleted_at=is.null`
      );
      if (dup.length > 0) {
        log('校验失败：重复提交', text);
        send(res, 409, { ok: false, error: '这个任务已经存在了' });
        return;
      }

      // 4. 算 position = 当前最大 position + 1（新任务加到列表末尾）
      const maxRow = await queryRdb(`/tasks?select=position&order=position.desc&limit=1`);
      const position = (maxRow.length > 0 ? maxRow[0].position : 0) + 1;

      // 5. 插入 tasks（due / estimate 可选，透传）
      const inserted = await insertRdb(
        'tasks',
        {
          text,
          position,
          done: false,
          due: payload.due || null,
          estimate: payload.estimate != null ? payload.estimate : null,
        },
        COLUMNS
      );
      const newTask = inserted[0];
      log('插入成功', `id=${newTask.id}`, `position=${newTask.position}`, `text=${text}`);

      // 6. 写 task_events（created 事件），失败不阻断主流程、只记日志
      try {
        await insertRdb('task_events', { task_id: newTask.id, event_type: 'created' });
        log('事件已记录 created', `task_id=${newTask.id}`);
      } catch (e) {
        log('事件记录失败（主流程已成功）', e.message);
      }

      // 7. 返回新任务（形状对齐 api-contract.md 的读接口）
      send(res, 200, { ok: true, data: newTask });
      return;
    }

    // 其他方法（PATCH / DELETE 第 4 周才做）
    send(res, 405, { ok: false, error: '只支持 GET 和 POST' });
  } catch (e) {
    log('异常', e.message);
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(9000);
