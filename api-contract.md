# 接口契约（api-contract）

> 本文档是「先做哪件」前端与后端之间的**唯一契约**：前端按这里定义的路径、方法、返回格式调用，后端按这里定义返回。两边任何改动都要先更新这份文档。
>
> 建立时间：Day 15（2026-10-04）。当前仅含健康检查接口，业务读写接口 Day 16–22 再补。

## 0. 通用约定

| 项 | 值 |
| --- | --- |
| 后端基址 | `https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com` |
| 数据格式 | JSON，响应头 `Content-Type: application/json; charset=utf-8` |
| 时间格式 | ISO 8601，UTC（例：`2026-10-04T10:49:46.987Z`） |
| 字符编码 | UTF-8 |

---

## 1. 健康检查 `GET /api/health`

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/health` |
| 鉴权 | 无（公开） |
| 请求参数 | 无（query / body 均不需要） |

**用途**：确认后端整条链路（公网域名 → 网关 → 云函数）是否可用。前端「检查后端是否在线」时调它。

### 1.1 成功响应（HTTP 200）

```json
{
  "status": "ok",
  "service": "先做哪件",
  "time": "2026-10-04T10:49:46.987Z"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 固定 `"ok"`，表示服务正常 |
| `service` | string | 产品标识，固定 `"先做哪件"` |
| `time` | string | 服务器当前时间（UTC，ISO 8601） |

### 1.2 错误约定

| 场景 | 状态码 | 说明 |
| --- | --- | --- |
| 路径不存在 | `404` | 请求了 `/api/health` 以外的路径 |
| 服务内部异常 | `500` | 云函数运行出错（本接口目前无业务错误码） |

> 本接口是无状态只读接口，不产生任何副作用，失败重试是安全的。

### 1.3 调用示例

```bash
curl "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/health"
```

返回：

```json
{"status":"ok","service":"先做哪件","time":"2026-10-04T10:49:46.987Z"}
```

---

## 2. 读任务列表 `GET /api/tasks`

> Day 17 新增。返回全部**未删除**任务，按 `position` 升序（顺序即优先级）。

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/tasks` |
| 鉴权 | 无（公开） |
| 查询参数 | `limit`（可选，整数，限制返回条数） |

### 2.1 成功响应（HTTP 200）

```json
{
  "ok": true,
  "data": [
    { "id": 1, "text": "复习高数第三章", "position": 1, "done": false, "due": "2026-10-08", "estimate": 90 },
    { "id": 8, "text": "写完 Day 16 的建表笔记", "position": 2, "done": false, "due": "2026-10-05", "estimate": 60 }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | 固定 `true` |
| `data` | array | 任务数组，每个元素含 `id` / `text` / `position` / `done` / `due` / `estimate` |

**字段映射（对 Day 16 建的 `tasks` 表）**：

| 返回字段 | 表字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 一致（表里是 bigint，这里返回数字） |
| `text` | `text` | 一致 |
| `position` | `position` | 一致，接口按它升序返回 |
| `done` | `done` | 一致 |
| `due` | `due` | 一致（可为 null） |
| `estimate` | `estimate` | 一致（可为 null） |
| — | `deleted_at` | **不返回**，接口只查 `deleted_at IS NULL` 的行 |
| — | `created_at` / `updated_at` | 不返回（前端用不到） |

### 2.2 调用示例

```bash
curl "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks"
curl "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks?limit=3"
```

---

## 3. 第一件事 `GET /api/tasks/first`

> Day 17 新增。返回「第一件事」：第 1 位**未完成**、未删除的任务（产品的核心问题「先做哪件」的答案）。

## /api/theme —— 主题跨端同步（Day 18 新增）

主题状态要在 网页版 / 桌面面板 / 桌面精灵 三端保持一致，而三端互相不同源、
localStorage 完全隔离，所以落在数据库 `app_state` 表（key-value，key='theme'）。

### GET /api/theme

读当前主题。`app_state` 无记录时返回默认值 `play`。

响应：
```json
{ "ok": true, "data": { "theme": "play" } }
```

### POST /api/theme

写入当前主题（upsert：`app_state` 主键 `key='theme'` 冲突时更新 value）。

请求体：
```json
{ "theme": "dark" }
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `theme` | string | 必填，7 套主题 id 之一：`play / minimal / editorial / dark / nature / retro / luxe`，其他值 400 |

响应：
```json
{ "ok": true, "data": { "theme": "dark" } }
```

### 同步语义

- 「最后写入者胜」：任何一端选择/换装主题 → 立即 POST 本接口
- 各端**启动时** GET 一次对齐（不做轮询——免费体验版的资源点扛不住轮询频率）；
  其他端变更后，本端刷新页面即可同步，实时推送是后续课题
- 云端不可达（离线）时静默失败，本地选择依然生效

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/tasks/first` |
| 鉴权 | 无（公开） |
| 查询参数 | 无 |

### 3.1 成功响应（HTTP 200）

```json
{
  "ok": true,
  "data": { "id": 1, "text": "复习高数第三章", "position": 1, "done": false, "due": "2026-10-08", "estimate": 90 }
}
```

`data` 是单个任务对象；若没有任何未完成的任务，`data` 为 `null`。

### 3.2 调用示例

```bash
curl "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks/first"
```

---

## 4. 新增任务 `POST /api/tasks`

> Day 18 新增。添加一条任务，返回新任务对象。

| 项 | 值 |
| --- | --- |
| 方法 | `POST` |
| 路径 | `/api/tasks` |
| 鉴权 | 无（公开） |
| 请求体 | JSON：`text`（必填）、`due`（可选）、`estimate`（可选） |

### 4.1 请求体

```json
{ "text": "给爸爸买生日礼物", "due": "2026-10-12", "estimate": 60 }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 是 | 任务文字，trim 后不能为空 |
| `due` | string (date) | 否 | 截止日期，`YYYY-MM-DD` |
| `estimate` | integer | 否 | 预估耗时（分钟），`>= 0` |

### 4.2 成功响应（HTTP 200）

```json
{
  "ok": true,
  "data": { "id": 13, "text": "给爸爸买生日礼物", "position": 9, "done": false, "due": "2026-10-12", "estimate": 60 }
}
```

`data` 是新任务对象，字段与读接口一致；`position` 自动取「当前最大 position + 1」（新任务加到列表末尾）。

### 4.3 错误响应

| 场景 | 状态码 | 返回 |
| --- | --- | --- |
| 缺 `text` / `text` 纯空白 | `400` | `{ "ok": false, "error": "任务内容不能为空" }` |
| 相同 `text` 的未删除任务已存在 | `409` | `{ "ok": false, "error": "这个任务已经存在了" }` |
| 请求体不是合法 JSON | `400` | `{ "ok": false, "error": "请求体不是合法的 JSON" }` |

### 4.4 调用示例

```bash
curl -X POST "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"text":"给爸爸买生日礼物","due":"2026-10-12","estimate":60}'
```

---

## 5. 修改任务 `PATCH /api/tasks?id=<id>`

> Day 22 新增。按 id 修改任务字段，返回修改后的任务对象。

| 项 | 值 |
| --- | --- |
| 方法 | `PATCH` |
| 路径 | `/api/tasks?id=<id>` |
| 鉴权 | 无（公开） |
| 请求体 | JSON：`text` / `done` / `due` / `estimate` 的任意组合（至少 1 个） |

### 5.1 可修改字段（白名单）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `text` | string | 任务文字，trim 后不能为空；改后不能与其他未删除任务重名 |
| `done` | boolean | 完成/未完成 |
| `due` | string (date) | 截止日期，可传 `null` 清空 |
| `estimate` | integer | 预估耗时（分钟），可传 `null` 清空 |

> `position` **不在白名单**：排序走专门的 reorder 逻辑（后续版本），不允许改字段时顺手挪优先级。

### 5.2 成功响应（HTTP 200）

```json
{ "ok": true, "data": { "id": 14, "text": "给爸爸买生日礼物", "position": 9, "done": false, "due": "2026-10-12", "estimate": 90 } }
```

### 5.3 错误响应

| 场景 | 状态码 | 返回 |
| --- | --- | --- |
| 缺 `id` 参数 | `400` | `{ "ok": false, "error": "缺少任务 id，用法：PATCH /api/tasks?id=<id>" }` |
| 请求体无可修改字段 / 非法 JSON | `400` | `没有可修改的字段（只支持 text / done / due / estimate）` / `请求体不是合法的 JSON` |
| `text` 为空 | `400` | `{ "ok": false, "error": "任务内容不能为空" }` |
| 改后的 `text` 与其他任务重名 | `409` | `{ "ok": false, "error": "这个任务已经存在了" }` |
| id 不存在（或已删除） | `404` | `{ "ok": false, "error": "任务不存在" }` |

### 5.4 调用示例

```bash
curl -X PATCH "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks?id=14" \
  -H "Content-Type: application/json" -d '{"estimate":90}'
```

---

## 6. 删除任务 `DELETE /api/tasks?id=<id>`（软删除）

> Day 22 新增。**不真删数据**：只把 `deleted_at` 置为当前时间，读接口（`GET /api/tasks`、`GET /api/tasks/first`）全带 `deleted_at IS NULL` 过滤，该条自然不再返回；删错了把 `deleted_at` 清空即可找回。

| 项 | 值 |
| --- | --- |
| 方法 | `DELETE` |
| 路径 | `/api/tasks?id=<id>` |
| 鉴权 | 无（公开） |
| 请求体 | 无 |

### 6.1 成功响应（HTTP 200）

返回被删除的任务对象（字段同读接口）：

```json
{ "ok": true, "data": { "id": 14, "text": "给爸爸买生日礼物", "position": 9, "done": false, "due": "2026-10-12", "estimate": 60 } }
```

### 6.2 错误响应

| 场景 | 状态码 | 返回 |
| --- | --- | --- |
| 缺 `id` 参数 | `400` | `{ "ok": false, "error": "缺少任务 id，用法：DELETE /api/tasks?id=<id>" }` |
| id 不存在（或已删除过） | `404` | `{ "ok": false, "error": "任务不存在" }` |

### 6.3 调用示例

```bash
curl -X DELETE "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks?id=14"
```

---

## 7. 错误约定（读写通用）

| 场景 | 状态码 | 说明 |
| --- | --- | --- |
| 路径不存在 | `404` | 请求了 `/api/tasks`、`/api/tasks/first` 以外的路径 |
| 方法不支持 | `405` | 只支持 GET、POST、PATCH、DELETE |
| 服务内部异常 | `500` | 云函数或数据库网关出错 |

