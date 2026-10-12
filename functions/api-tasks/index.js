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
//   POST /api/tasks/restore?id=N → 恢复软删除（撤销删除用，幂等）
//   POST /api/tasks/reorder      → 批量重排 position（拖拽排序用，body {order:[id...]})
//
// 契约（路径 / 字段 / 返回形状）见 api-contract.md，重构不许动它。

const http = require('http');
const db = require('./db'); // 数据访问层（Day 19 拆出）：query / insert / COLUMNS

// 统一 JSON 响应
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 服务端日志（Day 18 余力加练引入；Day 23 升级为统一请求日志）：
// 每条请求结束时记「时间 方法 路径 → 状态码」。排查用 `tcb fn log api-tasks` 看。
// 注意：这里的日志只有服务端能看，用户永远只会收到下面定义的中文提示。
function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// 读请求体（POST/PATCH 的 body 要手动读流）。
// 代码审查 #2：限制请求体大小（10KB 对本业务绰绰有余），
// 超限返回 null，由调用方回 413——防止超大 body 打爆云函数内存。
const BODY_LIMIT = 10 * 1024;
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > BODY_LIMIT) {
      // 注意：不能在这里 req.destroy()——销毁流会让 for-await 抛未捕获异常
      // 把进程带走（实测 ret 200406）。正确做法：停止累积、直接返回，
      // 让调用方回 413 后由网关关闭连接。
      return null;
    }
  }
  return raw;
}

// 代码审查 #1：共享密钥鉴权。令牌放在 .env（APP_ACCESS_TOKEN），
// 前端请求带 X-App-Token 头。这是用户系统上线前的过渡方案——
// 值在前端 JS 里可见，只能挡住扫 URL 的脚本，挡不住存心看源码的人。
const APP_TOKEN = process.env.APP_ACCESS_TOKEN || '';

// 校验请求头里的令牌；不匹配（或服务端没配）一律 401，宁紧勿松
function authorized(req) {
  if (!APP_TOKEN) return false; // 环境变量没注入时直接拒绝，fail closed
  return req.headers['x-app-token'] === APP_TOKEN;
}

// 代码审查 #6：id 必须是正整数字符串，垃圾值不打网关、直接 404
function validId(id) {
  return typeof id === 'string' && /^\d+$/.test(id);
}

// 代码审查 #5：字段类型校验。返回错误文案（null = 合法）。
function validateFieldTypes(patch) {
  if (patch.done !== undefined && typeof patch.done !== 'boolean') {
    return 'done 必须是 true 或 false';
  }
  if (patch.due !== undefined && patch.due !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) {
      return 'due 的格式应为 YYYY-MM-DD';
    }
    // Day 24：格式对了还要是真实日历日期（如 2026-99-99 会骗过正则，
    // 落库时被 PG date 列拒绝 → 500 兜底）。用 UTC 构造后回读比对。
    const d = new Date(patch.due + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== patch.due) {
      return 'due 不是真实存在的日期';
    }
  }
  if (
    patch.estimate !== undefined &&
    patch.estimate !== null &&
    (!Number.isInteger(patch.estimate) || patch.estimate < 0)
  ) {
    return 'estimate 应为不小于 0 的整数（分钟）';
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  // 路由是前缀匹配 /api/tasks，所以 /api/tasks、/api/tasks/first 都会进到这里。
  // 网关可能保留完整路径、也可能剥离前缀，因此只判断「结尾是否是 /first」。
  const path = (req.url || '/').split('?')[0];
  const isFirst = path.endsWith('/first');
  const isFirstRestore = path.endsWith('/restore'); // POST /api/tasks/restore
  const isFirstReorder = path.endsWith('/reorder'); // POST /api/tasks/reorder

  // Day 23 余力加练：统一请求日志——响应真正发出时记「方法 路径 → 状态码」
  res.on('finish', () => {
    log('请求', `${req.method} ${path}`, `→ ${res.statusCode}`);
  });

  try {
    // ---------------- 鉴权（代码审查 #1） ----------------
    if (!authorized(req)) {
      log('鉴权失败：缺少或错误的 X-App-Token');
      send(res, 401, { ok: false, error: '访问未授权' });
      return;
    }

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
      // 代码审查 #8：默认只取 100 条，显式 limit 也封顶 100——防全量拉取拖慢加载
      let n = 100;
      if (rawLimit) n = Math.max(1, Math.min(100, parseInt(rawLimit, 10) || 20));
      // 契约对齐：/api/tasks 和 /api/tasks/first 以外的 GET 路径一律 404。
      // 网关传来的 path 形态有变异（可能剥前缀、可能带尾斜杠），所以：
      // 只在「明确指向别处」时才 404，根路径 / 或空串视为基路径放行。
      const cleanPath = path.replace(/\/+$/, '');
      if (!isFirst && !cleanPath.endsWith('/tasks') && cleanPath !== '' && cleanPath !== '/') {
        log('GET 路径不存在', path);
        send(res, 404, { ok: false, error: '路径不存在' });
        return;
      }
      const data = await db.query(
        `/tasks?select=${db.COLUMNS}&deleted_at=is.null&order=position.asc&limit=${n}`
      );
      send(res, 200, { ok: true, data });
      return;
    }

    // ---------------- POST 新增任务（Day 18） ----------------
    // 注意：restore / reorder 也走 POST，已在上面分流，这里只处理「新增」
    if (req.method === 'POST' && !isFirstRestore && !isFirstReorder) {
      log('收到 POST /api/tasks');

      // 1. 读并解析请求体（超限 → 413）
      const raw = await readBody(req);
      if (raw === null) {
        log('请求体超过大小限制');
        send(res, 413, { ok: false, error: '请求内容太大了' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        log('请求体不是合法 JSON');
        send(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
        return;
      }

      // 2. 校验必填字段 text（防「错误输入」：空文本）；顺带限制长度，防写进超长文本
      // Day 24 补充测试：先剥掉零宽/不可见字符（\u200B 等能骗过 trim 造出隐形任务）
      const text = (typeof payload.text === 'string' ? payload.text : '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
      if (!text) {
        log('校验失败：任务内容为空');
        send(res, 400, { ok: false, error: '任务内容不能为空' });
        return;
      }
      if (text.length > 500) {
        send(res, 400, { ok: false, error: '任务内容不能超过 500 个字' });
        return;
      }
      // Day 24 补充测试：控制字符（\u0000 等）会让 PG 拒收整个事务 → 500 兜底。
      // 入口直接拒，别把脏数据带给数据库。（\t\n\r 允许，其余控制字符拒绝）
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
        log('校验失败：任务内容含控制字符');
        send(res, 400, { ok: false, error: '任务内容不能包含特殊控制字符' });
        return;
      }

      // 3. 可选字段类型校验（代码审查 #5：due/estimate 不再无脑透传）
      const typeErr = validateFieldTypes(payload);
      if (typeErr) {
        log('校验失败：', typeErr);
        send(res, 400, { ok: false, error: typeErr });
        return;
      }

      // 4~5. 查重 + 取 position + 插入，整体重试。
      //     Day 24 补充测试发现：10 个并发 POST 有 3 个 500——根因是并发下
      //     并行查询阶段就可能被网关拒（旧代码只重试了 insert，查询炸了没人接），
      //     且 CloudBase 网关唯一冲突错误码是 DATABASE_23505。
      //     现在把「读+写」当一整段重试；重试时 position 加随机抖动，
      //     避免多个失败者第 2 次又读到同一个 max 再次互撞。
      let inserted = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const [dup, maxRow] = await Promise.all([
            db.query(`/tasks?select=id&text=eq.${encodeURIComponent(text)}&deleted_at=is.null`),
            db.query(`/tasks?select=position&order=position.desc&limit=1`),
          ]);
          if (dup.length > 0) {
            log('校验失败：重复提交', text);
            send(res, 409, { ok: false, error: '这个任务已经存在了' });
            return;
          }
          // 抖动：第 2 次起在 max+1 基础上随机 +0~3，把并发的失败者错开
          const jitter = attempt === 1 ? 0 : Math.floor(Math.random() * 4);
          const position = (maxRow.length > 0 ? maxRow[0].position : 0) + 1 + jitter;
          inserted = await db.insert(
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
          break; // 插入成功，跳出重试循环
        } catch (e) {
          // position 撞唯一索引（多人同时新增）或网关瞬时拒绝，都值得重试
          const retryable = /23505|unique|网关|5\d\d|fetch|ECONN|timeout/i.test(e.message);
          if (retryable && attempt < 5) {
            log('并发/瞬时错误，退避重试', `attempt=${attempt}`, e.message.slice(0, 120));
            await new Promise(r => setTimeout(r, 50 * attempt)); // 线性退避
            continue;
          }
          throw e;
        }
      }
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

    // ---------------- POST 恢复软删除任务（撤销删除用） ----------------
    // 用法：POST /api/tasks/restore?id=<id>。把 deleted_at 清空（Day 22 软删除留的口子），
    // 并写 restored 事件。对未删除的任务重复调用是幂等的（直接返回 200）。
    if (req.method === 'POST' && isFirstRestore) {
      log('收到 POST /api/tasks/restore');

      const u = new URL(req.url, 'http://localhost');
      const id = u.searchParams.get('id');
      if (!validId(id)) {
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }

      // 1. 找这一行（不过滤 deleted_at，被删的也能找到）
      const found = await db.query(
        `/tasks?select=id,deleted_at&id=eq.${encodeURIComponent(id)}`
      );
      if (found.length === 0) {
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }

      // 2. 已是未删除状态 → 幂等返回；否则清空 deleted_at
      if (found[0].deleted_at == null) {
        const active = await db.query(
          `/tasks?select=${db.COLUMNS}&id=eq.${encodeURIComponent(id)}`
        );
        send(res, 200, { ok: true, data: active[0] || null, message: '任务本来就在，无需恢复' });
        return;
      }
      const updated = await db.update('tasks', id, { deleted_at: null }, db.COLUMNS);
      if (updated.length === 0) {
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }
      log('恢复成功', `id=${id}`);

      // 3. 写 restored 事件，失败不阻断
      try {
        await db.insert('task_events', { task_id: Number(id), event_type: 'restored' });
      } catch (e) {
        log('事件记录失败（主流程已成功）', e.message);
      }

      send(res, 200, { ok: true, data: updated[0] });
      return;
    }

    // ---------------- POST 批量重排（拖拽排序用） ----------------
    // 用法：POST /api/tasks/reorder，body { "order": [id, id, ...] }，
    // order 是任务 id 的完整顺序数组，后端按数组下标写 position（第 1 位 = position 1）。
    // 两段式写入（先临时负数再归位），避开部分唯一索引的「交换冲突」。
    if (req.method === 'POST' && isFirstReorder) {
      log('收到 POST /api/tasks/reorder');

      const raw = await readBody(req);
      if (raw === null) {
        send(res, 413, { ok: false, error: '请求内容太大了' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        send(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
        return;
      }
      const order = Array.isArray(payload.order) ? payload.order : [];
      if (order.length === 0 || !order.every((x) => /^\d+$/.test(String(x)))) {
        send(res, 400, { ok: false, error: 'order 必须是非空的任务 id 数组' });
        return;
      }

      // 1. 现存未删除任务里，校验 order 覆盖了全部（不覆盖的话重排会漏任务）
      const existing = await db.query(`/tasks?select=id&deleted_at=is.null`);
      const existingIds = existing.map((r) => String(r.id)).sort().join(',');
      const orderIds = order.map(String).sort().join(',');
      if (orderIds !== existingIds) {
        log('reorder 列表与现有任务不一致');
        send(res, 409, { ok: false, error: 'order 列表和现有任务对不上，请刷新后重试' });
        return;
      }

      // 2. 两段式写入：先全部挪到 10000+i 的临时高位（Day 16 约束 position >= 1，
      //    负数会撞 CHECK；高位互不相同也不与现有 1~99 冲突），再按下标归位 1,2,3...
      for (let i = 0; i < order.length; i++) {
        await db.update('tasks', order[i], { position: 10000 + i }, 'id');
      }
      const changed = [];
      for (let i = 0; i < order.length; i++) {
        const updated = await db.update('tasks', order[i], { position: i + 1 }, 'id');
        if (updated.length > 0) changed.push(Number(order[i]));
      }
      log('重排完成', `count=${changed.length}`);

      // 3. 每个被挪动的任务写一条 reordered 事件（best-effort）
      for (const tid of changed) {
        try {
          await db.insert('task_events', { task_id: tid, event_type: 'reordered' });
        } catch (e) {
          log('事件记录失败（主流程已成功）', e.message);
        }
      }

      send(res, 200, { ok: true, data: { reordered: changed.length } });
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
      if (!validId(id)) {
        send(res, 404, { ok: false, error: '任务不存在' });
        return;
      }

      // 1. 解析请求体（超限 → 413）
      const raw = await readBody(req);
      if (raw === null) {
        log('请求体超过大小限制');
        send(res, 413, { ok: false, error: '请求内容太大了' });
        return;
      }
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

      // 2.5 字段类型校验（代码审查 #5）
      const typeErr = validateFieldTypes(patch);
      if (typeErr) {
        log('校验失败：', typeErr);
        send(res, 400, { ok: false, error: typeErr });
        return;
      }

      // 3. 改 text 的话：不能为空（长度同 POST 限 500），且不能和其他未删除任务重名
      if (patch.text !== undefined) {
        patch.text = typeof patch.text === 'string' ? patch.text.trim() : '';
        if (!patch.text) {
          log('校验失败：任务内容为空');
          send(res, 400, { ok: false, error: '任务内容不能为空' });
          return;
        }
        if (patch.text.length > 500) {
          send(res, 400, { ok: false, error: '任务内容不能超过 500 个字' });
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
      if (!validId(id)) {
        send(res, 404, { ok: false, error: '任务不存在' });
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
    // Day 23「把裸报错改成人话」：改前直接回传 e.message（可能是
    // 「网关写入错误 401: {"message":...}」这类英文/内部细节，暴露技术栈）；
    // 改后用户只看到一句中文，完整报错留在上面的服务端日志里。
    log('异常（用户已收到中文提示，以下为细节）', e.message);
    send(res, 500, { ok: false, error: '服务器开小差了，请稍后再试' });
  }
});

server.listen(9000);
