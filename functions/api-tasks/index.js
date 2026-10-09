// index.js —— HTTP 层：收请求 → 校验 → 调数据访问层 → 回响应
//
// Day 19 分层重构：
//   index.js（本文件）＝ HTTP 层。管路由、请求解析、字段校验、组装响应。
//   db.js（./db）      ＝ 数据访问层。管怎么读写数据库（fetch REST 网关）。
// 「查数据库」的代码已从本文件移到 db.js——以后换数据库只改 db.js，
// HTTP 逻辑一行不动；反过来加新接口只改本文件，不碰数据库细节。
//
// 一个云函数同时处理多个路径和方法（路由是前缀匹配，path=/api/tasks 匹配子路径）：
//   GET  /api/tasks         → 全部未删除任务，按 position 升序
//   GET  /api/tasks/first   → 「第一件事」：第 1 位未完成、未删除的任务
//   GET  /api/tasks?limit=N → 限制返回条数
//   POST /api/tasks         → 新增任务（Day 18）
//
// 契约（路径 / 字段 / 返回形状）见 api-contract.md，重构不许动它。

const http = require('http');
const db = require('./db'); // 数据访问层（Day 19 拆出）：query / insert / COLUMNS

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

const server = http.createServer(async (req, res) => {
  // 路由是前缀匹配 /api/tasks，所以 /api/tasks、/api/tasks/first 都会进到这里。
  // 网关可能保留完整路径、也可能剥离前缀，因此只判断「结尾是否是 /first」。
  const path = (req.url || '/').split('?')[0];
  const isFirst = path.endsWith('/first');

  try {
    // ---------------- GET 读（Day 17） ----------------
    if (req.method === 'GET') {
      if (isFirst) {
        const data = await db.query(
          `/tasks?select=${db.COLUMNS}&deleted_at=is.null&done=is.false&order=position.asc&limit=1`
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
      const data = await db.query(
        `/tasks?select=${db.COLUMNS}&deleted_at=is.null&order=position.asc${limitQ}`
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
      const dup = await db.query(
        `/tasks?select=id&text=eq.${encodeURIComponent(text)}&deleted_at=is.null`
      );
      if (dup.length > 0) {
        log('校验失败：重复提交', text);
        send(res, 409, { ok: false, error: '这个任务已经存在了' });
        return;
      }

      // 4. 算 position = 当前最大 position + 1（新任务加到列表末尾）
      const maxRow = await db.query(`/tasks?select=position&order=position.desc&limit=1`);
      const position = (maxRow.length > 0 ? maxRow[0].position : 0) + 1;

      // 5. 插入 tasks（due / estimate 可选，透传）
      const inserted = await db.insert(
        'tasks',
        {
          text,
          position,
          done: false,
          due: payload.due || null,
          estimate: payload.estimate != null ? payload.estimate : null,
        },
        db.COLUMNS
      );
      const newTask = inserted[0];
      log('插入成功', `id=${newTask.id}`, `position=${newTask.position}`, `text=${text}`);

      // 6. 写 task_events（created 事件），失败不阻断主流程、只记日志
      try {
        await db.insert('task_events', { task_id: newTask.id, event_type: 'created' });
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
