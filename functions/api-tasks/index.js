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
//   PATCH /api/tasks?id=N   → 修改任务字段（Day 22，白名单 text/done/due/estimate）
//   DELETE /api/tasks?id=N  → 软删除任务（Day 22，置 deleted_at，可找回）
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

    // ---------------- PATCH 修改任务（Day 22） ----------------
    // 用法：PATCH /api/tasks?id=<id>，请求体为要改的字段。
    // 白名单字段：text / done / due / estimate。
    // position 不在白名单里——排序走专门的 reorder 逻辑（今天不做），
    // 不让「改个名字的请求」顺手挪动别人的优先级。
    if (req.method === 'PATCH') {
      log('收到 PATCH /api/tasks');

      const u = new URL(req.url, 'http://localhost');
      const id = u.searchParams.get('id');
      if (!id) {
        send(res, 400, { ok: false, error: '缺少任务 id，用法：PATCH /api/tasks?id=<id>' });
        return;
      }

      // 1. 解析请求体
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        log('请求体不是合法 JSON');
        send(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
        return;
      }

      // 2. 白名单过滤：只收 text / done / due / estimate
      const patch = {};
      if (payload.text !== undefined) patch.text = payload.text;
      if (payload.done !== undefined) patch.done = payload.done;
      if (payload.due !== undefined) patch.due = payload.due;
      if (payload.estimate !== undefined) patch.estimate = payload.estimate;
      if (Object.keys(patch).length === 0) {
        log('校验失败：没有可修改的字段');
        send(res, 400, {
          ok: false,
          error: '没有可修改的字段（只支持 text / done / due / estimate）',
        });
        return;
      }

      // 3. 改 text 的话：不能为空，且不能和其他未删除任务重名
      if (patch.text !== undefined) {
        patch.text = typeof patch.text === 'string' ? patch.text.trim() : '';
        if (!patch.text) {
          log('校验失败：任务内容为空');
          send(res, 400, { ok: false, error: '任务内容不能为空' });
          return;
        }
        const dup = await db.query(
          `/tasks?select=id&text=eq.${encodeURIComponent(patch.text)}&deleted_at=is.null&id=neq.${encodeURIComponent(id)}`
        );
        if (dup.length > 0) {
          log('校验失败：改成了已有任务的文字', patch.text);
          send(res, 409, { ok: false, error: '这个任务已经存在了' });
          return;
        }
      }

      // 4. 执行更新；更新不到行 = 这个 id 不存在（或已删除）→ 404
      const updated = await db.update('tasks', id, patch, db.COLUMNS);
      if (updated.length === 0) {
        log('未找到任务', `id=${id}`);
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }
      const row = updated[0];
      log('更新成功', `id=${id}`, `fields=${Object.keys(patch).join(',')}`);

      // 5. 写事件（done 改动记 done/undone，其余记 edited），失败不阻断
      const eventType =
        patch.done === true ? 'done' : patch.done === false ? 'undone' : 'edited';
      try {
        await db.insert('task_events', { task_id: row.id, event_type: eventType });
      } catch (e) {
        log('事件记录失败（主流程已成功）', e.message);
      }

      send(res, 200, { ok: true, data: row });
      return;
    }

    // ---------------- DELETE 删除任务（Day 22，软删除） ----------------
    // 用法：DELETE /api/tasks?id=<id>。
    // 删除为什么比新增容易出事？因为不可逆、触发条件太随意。所以这里不真删：
    // 只把 deleted_at 置为当前时间（Day 16 schema 就有这列，读接口全带
    // deleted_at=is.null 过滤，行自然「消失」），删错了把 deleted_at 清空即可找回。
    if (req.method === 'DELETE') {
      log('收到 DELETE /api/tasks');

      const u = new URL(req.url, 'http://localhost');
      const id = u.searchParams.get('id');
      if (!id) {
        send(res, 400, { ok: false, error: '缺少任务 id，用法：DELETE /api/tasks?id=<id>' });
        return;
      }

      // 1. 先找到这一行（顺便拿删除前的 position 给事件用）；找不到 → 404
      const found = await db.query(
        `/tasks?select=${db.COLUMNS}&id=eq.${encodeURIComponent(id)}&deleted_at=is.null`
      );
      if (found.length === 0) {
        log('未找到任务（或已删除）', `id=${id}`);
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }
      const before = found[0];

      // 2. 软删除：置 deleted_at（PostgREST 对 timestamptz 传 ISO 字符串即可）
      const updated = await db.update(
        'tasks',
        id,
        { deleted_at: new Date().toISOString() },
        db.COLUMNS
      );
      log('软删除成功', `id=${id}`, `text=${before.text}`, `position=${before.position}`);

      // 3. 写 deleted 事件（to_position 记删除前的位置，恢复时用），失败不阻断
      try {
        await db.insert('task_events', {
          task_id: Number(id),
          event_type: 'deleted',
          to_position: before.position,
        });
      } catch (e) {
        log('事件记录失败（主流程已成功）', e.message);
      }

      send(res, 200, { ok: true, data: updated[0] || before });
      return;
    }

    // 其他方法
    send(res, 405, { ok: false, error: '只支持 GET、POST、PATCH 和 DELETE' });
  } catch (e) {
    log('异常', e.message);
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(9000);
