# Day 17 · GET 读接口（/api/tasks + /api/tasks/first）

> 记录时间：2026-10-05。
> 今日主任务：GET 读接口部署并验证。**不写业务写入接口**（Day 18）、不改表结构。

## 一｜先答「今天要掌握」的问题

> 接口返回的数据里，哪一项和你建的表对不上？怎么发现的？

**课程模板的 `/api/hot` 返回的是「热搜」数据**（标题 + 热度值），而我 Day 16 建的是 `tasks` 表（`text` 任务文字 + `position` 优先级 + `done` 完成态）。

两者几乎全对不上——一个记「新闻多热」，一个记「先做哪件」。

**发现方法**：把接口返回的 JSON 逐字段和 `db/schema.sql` 的列名对照，就会看到热搜的 `title/hotValue` 和任务的 `text/position` 语义完全不同。

**映射到本项目后**（今天定的）：读接口字段和 `tasks` 表严格对齐，这个问题就不存在了。课程的两个接口 `/api/hot`、`/api/favorites` 对应换成 `/api/tasks`、`/api/tasks/first`。

## 二｜接口设计

| 课程模板 | 本项目 | 读什么 |
| --- | --- | --- |
| `GET /api/hot` | `GET /api/tasks` | 全部未删除任务，`ORDER BY position` |
| `GET /api/favorites` | `GET /api/tasks/first` | 「第一件事」：第 1 位未完成、未删除 |

统一返回 `{ ok: true, data: ... }`。余力加练：`/api/tasks?limit=N` 限制条数。

## 三｜技术关键（今天踩出来的路，复用价值高）

### 个人版（免费体验版）不支持 TCP 直连 PostgreSQL

云函数里不能用 `pg` 库 + 连接串（内网/VPC 不支持、公网直连开关开不了）。

**正确路径**：通过 CloudBase 的 **PostgREST 网关**用 HTTP 读数据：

```
https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/tasks?select=...&...
```

- 裸表名（不带 `public` 前缀），`/v1/rdb/rest/tasks` ✅
- 带 `public/tasks` 前缀会 404（`DATABASE_PGRST125`）

### 鉴权用服务端 API Key

HTTP 云函数**不会自动注入凭据**（普通事件函数才会），必须显式配。

- 创建：`tcb api tcb CreateApiKey --body '{"EnvId":"...","KeyType":"api_key","KeyName":"..."}'`
- **明文只在创建时返回一次**，妥善保存
- 代码里 `process.env.CLOUDBASE_APIKEY` 读
- 云函数环境变量通过 `cloudbaserc.json` 的 `envVariables` + `{{env.XXX}}` 引用 `.env`，明文不进 Git

### 为什么不用 node-sdk 的 app.rdb()

`rdb().from('tasks')` 在本环境会把环境 ID 误当 schema，报 `DATABASE_PGRST106 Invalid schema: yuanjian-...`。

**REST 网关 + 原生 fetch 反而稳定**（Node 20 内置 fetch，零依赖）。

### PostgREST 查询语法（实测有效）

| 需求 | 写法 |
| --- | --- |
| 选列 | `select=id,text,position,done,due,estimate` |
| 过滤 null | `deleted_at=is.null` |
| 过滤 false | `done=is.false` |
| 排序 | `order=position.asc` |
| 限制条数 | `limit=3` |

## 四｜验证结果（全部实测）

| 验证项 | 结果 |
| --- | --- |
| `GET /api/tasks` | `{ok:true}`，7 行，position 1–7 升序 |
| 软删除过滤 | 第 8 条「临时记一下要买酱油」被正确排除（`deleted_at IS NULL` 生效） |
| 返回字段 | 恰好 6 个：`id/text/position/done/due/estimate`（不含 deleted_at/时间戳） |
| `GET /api/tasks?limit=3` | 3 行（余力加练） |
| `GET /api/tasks/first` | 返回「复习高数第三章」 |
| **改数据刷新跟着变** | `UPDATE` 把 id=2 estimate 15→99，接口立即返回 99；已改回 15 |
| 路由类型 | `/api/tasks` 已修正为 `WEB_SCF`（`--path` 默认错写成 SCF） |

公网地址：
- `https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks`
- `https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks/first`

## 五｜入库文件

| 文件 | 归属 |
| --- | --- |
| `functions/api-tasks/index.js` | Day 17 新增（读接口实现） |
| `functions/api-tasks/package.json` | Day 17 新增 |
| `functions/api-tasks/scf_bootstrap` | Day 17 新增 |
| `cloudbaserc.json` | Day 17 改（加 api-tasks 函数 + envVariables 引用） |
| `api-contract.md` | Day 17 改（补两个读接口的契约） |

## 六｜安全红线（本次执行遵守）

- API Key 明文只存在本地 `.env`（已被 `.gitignore` 忽略，**不进 Git**）
- `cloudbaserc.json` 里只写 `{{env.CLOUDBASE_APIKEY}}` 引用，无明文
- 代码里不硬编码密钥，只从环境变量读
- API Key 名称 `day17-read-api`，KeyId `skRnc7wiQNysk4Ib7x6vsA`（如泄露可在控制台删除重建）

## 七｜Day 18 接手须知

- 写接口（收藏/添加/完成/删除）会走同样的 REST 网关，只是 HTTP 方法换成 POST/PATCH/DELETE
- 写接口要同时写 `task_events`（Day 16 建的事件表）
- 拖拽改 `position` 时注意「部分唯一索引」的临时冲突（Day 16 已记录）
- 两表目前无 RLS，多用户前必须补（Day 16 第八节）
