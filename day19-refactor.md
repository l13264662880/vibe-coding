# Day 19 · 重构：拆出数据访问层

> 记录时间：2026-10-09。
> 今日主任务：完成一次完整重构 + 全接口回归验证。**不动接口路径和字段名（契约不许动）、不加新功能**。

## 一｜先答「今天要掌握」的问题

> 拆完之后，「查数据库」这段代码从哪移到了哪？

**从 `index.js`（HTTP 处理层）移到了新建的 `db.js`（数据访问层）。**

移过去的三块代码：

| 代码 | 原来 | 现在 |
| --- | --- | --- |
| `queryRdb(path)`（fetch 网关查） | index.js | db.js 的 `query(path)` |
| `insertRdb(table, body, select)`（fetch 网关写） | index.js | db.js 的 `insert(table, body, select)` |
| `ENV_ID` / `GATEWAY` / `API_KEY` / `COLUMNS` 常量 | index.js | db.js |

拆完后 `index.js` 只剩「收请求 → 校验 → 调 db → 回响应」，不再直接碰 fetch、网关地址和 API Key。

## 二｜分层思路（为什么拆）

两类代码**变化的原因完全不同**：

| 职责 | 什么时候会改 |
| --- | --- |
| HTTP 层（index.js）：路由、校验、组装响应 | 加新接口（PATCH/DELETE）、改校验规则、改返回形状 |
| 数据访问层（db.js）：fetch 网关、查询串、API Key | 换数据库、换网关方式、改字段映射 |

拆开后互不影响：换数据库只改 `db.js`，HTTP 逻辑一行不动；加新接口只改 `index.js`，不碰数据库细节。这就是「关注点分离」。

## 三｜分层示意图（余力加练）

```
        浏览器 / 前端页面
              │  HTTP 请求
              ▼
┌─────────────────────────────────┐
│  index.js（HTTP 层）             │
│  路由 / 校验 text / 组装 {ok,data} │
└────────────┬────────────────────┘
             │  db.query() / db.insert()
             ▼
┌─────────────────────────────────┐
│  db.js（数据访问层）← Day 19 拆出 │
│  fetch 网关 / 查询串 / API Key    │
└────────────┬────────────────────┘
             │  HTTPS
             ▼
┌─────────────────────────────────┐
│  CloudBase PostgREST 网关        │
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  PostgreSQL（tasks / task_events）│
└─────────────────────────────────┘
```

## 四｜拆分前后对比

```
functions/api-tasks/
├── index.js       拆分前：182 行，HTTP 层 + 数据访问层混在一起
├── index.js       拆分后：HTTP 层（require './db'，只调 db.query / db.insert）
├── db.js          拆分后：数据访问层（query / insert / COLUMNS）← 新增
├── package.json
└── scf_bootstrap
```

`index.js` 里的具体改动：
- `const db = require('./db')`
- `queryRdb(...)` → `db.query(...)`
- `insertRdb(...)` → `db.insert(...)`
- `COLUMNS` → `db.COLUMNS`

**契约零改动**：接口路径（`/api/tasks`）、字段名（`id/text/position/done/due/estimate`）、返回形状（`{ok,data}` / `{ok,error}`）全部不变——这是重构的底线。

## 五｜回归验证结果（本地 6 项 + 公网 6 项，全过）

### 本地回归（拆完立即测）

| # | 测试 | 结果 |
| --- | --- | --- |
| 1 | GET /api/tasks | `{ok:true}` 9 行 ✅ |
| 2 | GET /api/tasks/first | `{ok:true,data:{id:1,...}}` ✅ |
| 3 | GET /api/tasks?limit=3 | 3 行 ✅ |
| 4 | POST 空 text | 400 `任务内容不能为空` ✅ |
| 5 | POST 重复 text | 409 `这个任务已经存在了` ✅ |
| 6 | POST 正常新增 | 200 `{id:15,position:10}`（测后已清理）✅ |

### 公网回归（部署后测）

| # | 测试 | 结果 |
| --- | --- | --- |
| 1 | GET /api/tasks | `{ok:true}` 9 行 ✅ |
| 2 | GET /api/tasks/first | `{ok:true,data:{id:1,...}}` ✅ |
| 3 | GET /api/tasks?limit=3 | 3 行 ✅ |
| 4 | POST 空 text | 400 中文 ✅ |
| 5 | POST 重复 text | 409 中文 ✅ |
| 6 | POST 正常新增 | 200 `{id:16,position:10}`（测后已清理）✅ |

回归后数据库回到 tasks 9 行 / task_events 13 行（与 Day 18 交付时一致）。

## 六｜入库文件

| 文件 | 归属 |
| --- | --- |
| `functions/api-tasks/db.js` | Day 19 新增（数据访问层） |
| `functions/api-tasks/index.js` | Day 19 改（require db，去掉 fetch 逻辑） |

## 七｜Day 20 接手须知

- PATCH（编辑/完成/拖拽）、DELETE（删除）第 4 周做：新逻辑加在 `index.js` 的路由里，数据库操作全部走 `db.query` / `db.insert`，**不要在 index.js 里直接写 fetch**
- `db.js` 以后可以继续扩：加 `update()` / `remove()` 等，HTTP 层无感知
- 前端写操作（增删改同步后端）还是 Day 19/20 的事，前端目前只有读接了真实接口
