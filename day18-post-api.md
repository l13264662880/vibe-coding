# Day 18 · POST 写接口（新增任务）

> 记录时间：2026-10-06。
> 今日主任务：POST 接口部署 + 一次真实写入 + 读回验证。**不写 PATCH/DELETE（第 4 周）、不写批量写入**。

## 一｜先答「今天要掌握」的问题

> 你防了哪一种重复提交或错误输入？怎么测的？

防了**两种**，都是**应用层校验**（`tasks` 表没有这两条约束，靠云函数拦）：

| 防什么 | 判定规则 | 返回 |
| --- | --- | --- |
| 错误输入 | `text` 缺失或 `trim()` 后是空串 | `400` `{"ok":false,"error":"任务内容不能为空"}` |
| 重复提交 | 相同 `text` 的**未删除**任务已存在（`deleted_at IS NULL`） | `409` `{"ok":false,"error":"这个任务已经存在了"}` |

**怎么测的**（本地 + 公网各一遍）：
1. `POST {"text":"   "}` → 400 中文提示
2. `POST {"text":"复习高数第三章"}`（seed 里已有）→ 409 中文提示
3. `POST {"text":"给爸爸买生日礼物",...}` → 200 `{ok:true,data:{...}}`

## 二｜接口设计（已补进 api-contract.md 第 4 节）

```
POST /api/tasks
请求体：{"text": "...", "due": "YYYY-MM-DD"?, "estimate": N?}
成功：{ "ok": true, "data": {新任务对象, 含 id/position} }
失败：{ "ok": false, "error": "中文提示" }
```

`position` 自动取「当前最大 position + 1」，新任务加到列表末尾。

## 三｜技术关键（Day 18 新踩的，复用价值高）

### PostgREST 网关的 POST 插入（Day 17 只验证了 GET）

```js
fetch(`${GATEWAY}/tasks?select=${COLUMNS}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',   // 关键：让 PostgREST 返回插入后的行（含自增 id）
    'Authorization': `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({ text, position, done: false, due, estimate }),
});
```

- 返回 `201` + 插入行的数组（即使插一行也是数组，取 `[0]`）
- 不带 `Prefer: return=representation` 时返回空体，拿不到自增 id
- 带 `?select=...` 可指定返回字段（否则返回全部字段含 deleted_at/created_at）

### 查重与 max position（都走 GET）

```
GET /tasks?select=id&text=eq.<urlencoded>&deleted_at=is.null     → 查重
GET /tasks?select=position&order=position.desc&limit=1           → max position
```

### 云函数读 POST body

Node 原生 http 要手动读流：`for await (const chunk of req) raw += chunk`。

### 部署坑：路径已存在

第二次部署带 `--path /api/tasks` 会报 `Path '/api/tasks' is used`。**重新部署时去掉 `--path`**（路由 Day 17 已建好），只保留 `--httpFn --force`。

### 服务端日志（余力加练）

云函数里 `console.log` 关键节点（收到请求、校验结果、插入结果），用 `tcb fn log api-tasks` 排查。

## 四｜验证结果（全实测）

| 验证项 | 结果 |
| --- | --- |
| 空 text | `400` `任务内容不能为空` ✅ |
| 重复 text | `409` `这个任务已经存在了` ✅ |
| 正常 POST | `200` `{ok:true,data:{id:13,position:9,...}}` ✅ |
| 数据库多一行 | 8 → 9 行 ✅ |
| task_events 同步写 | `created` 事件（task_id=13）✅ |
| GET 读回 | 列表末尾能看到新任务 ✅ |

公网地址：`POST https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks`

## 五｜入库文件

| 文件 | 归属 |
| --- | --- |
| `functions/api-tasks/index.js` | Day 18 改（加 POST 分支 + 校验 + 日志） |
| `api-contract.md` | Day 18 改（补第 4 节 POST 契约、第 5 节错误约定） |

## 六｜Day 19+ 接手须知

- PATCH（编辑/完成/拖拽）、DELETE（删除）第 4 周做，走同样的 REST 网关（PUT/PATCH/DELETE 方法）
- 拖拽改 `position` 时，注意「部分唯一索引」的临时冲突（Day 16 已记录）
- 写接口要同时写 `task_events`（本次 POST 已示范：插入 tasks 后同步写 created 事件）
- 两表无 RLS，多用户前必须配（Day 16 第八节）
- 前端还没接 POST（本日只做接口），前端「添加任务」走真实接口留到 Day 19/20
