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

## 4. 错误约定（读接口通用）

| 场景 | 状态码 | 说明 |
| --- | --- | --- |
| 路径不存在 | `404` | 请求了 `/api/tasks`、`/api/tasks/first` 以外的路径 |
| 非 GET 方法 | `405` | 只支持 GET（写接口 Day 18 才做） |
| 服务内部异常 | `500` | 云函数或数据库网关出错 |

