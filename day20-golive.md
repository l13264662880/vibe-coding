# Day 20 · 公网接线验证（页面展示真实数据）

> 记录时间：2026-10-09。
> 今日主任务：拿到一个可分享的公网 URL，页面展示真实数据。**不改后端代码、不从零重新部署**。

## 一｜先答「今天要掌握」的问题

> 跨域那一下，你是怎么认出问题出在哪的？

**四步排除法**（Day 17 实际走过的路）：

| 步骤 | 做什么 | 判断 |
| --- | --- | --- |
| 1. 症状分离 | curl 直接调接口 vs 浏览器打开页面 | curl 通 + 浏览器没数据 → 问题在浏览器侧（十有八九跨域）；两边都不通 → 后端/网络 |
| 2. F12 Console | 看报错文字 | 跨域有标志性 `blocked by CORS policy: No 'Access-Control-Allow-Origin'` |
| 3. F12 Network | 看请求状态 | 请求标 `CORS error` = 跨域；**请求 200 但页面没数据 = 不是跨域**（Day 17 真凶是渲染等待不够，靠这步排除） |
| 4. curl 带 Origin | `curl -H "Origin: <前端域名>" -I <接口>` | 直接看服务端返回的 `access-control-allow-origin`，绕过浏览器验证服务端配置 |

核心心法：**先分离「服务端」和「浏览器端」，再用 Console/Network 定位，最后用 curl 验证服务端配置**。Day 17 就是靠第 3 步发现请求其实 200、跨域根本不是问题，避免了瞎改。

## 二｜现状说明

Day 17 板块②已把前端接上真实接口（`app.js` 的 `DATA_SOURCE='api'` + 公网 `API_BASE`），公网页面一直在展示真实数据。所以 Day 20 的实质是**验证 + 补齐三项完成标准的证据**。

## 三｜四板块执行记录

| 板块 | 动作 | 结果 |
| --- | --- | --- |
| ① 云函数可用 + 跨域 | curl health（`status:ok`）+ tasks（8 行）+ 带 Origin 头看 CORS | `access-control-allow-origin: <前端域名>` 仍在 ✅ |
| ② 本地接线 | 确认 `app.js`：`DATA_SOURCE='api'`（120 行）、`API_BASE=公网地址`（121 行） | 配置未被动过 ✅ |
| ③ 重新构建上传 | 前端 10 个文件（新增了别的会话加的 `data-flow.svg`）重新上传静态托管 | 成功 ✅ |
| ④ 逐项验证 | 见下节 | 三项全过 ✅ |

## 四｜完成标准逐项验证

| 标准 | 验证方式 | 结果 |
| --- | --- | --- |
| 公网首页展示数据库真实数据 | 打开公网首页等渲染后截图 | 「复习高数第三章」等 8 行真实任务 ✅ |
| 控制台改数据刷新跟着变 | 改库 `estimate 90→30` → 重开页面 → 截图对比 | 页面从「约 1 小时 30 分钟」变「**约 30 分钟**」✅（验证后已改回 90） |
| F12 请求地址是公网地址 | CDP 抓 `performance.getEntriesByType('resource')` | 实际请求 `https://...service.tcloudbase.com/api/tasks` 和 `/api/theme`，全公网 ✅ |

抓到的真实请求（F12 Network 等效输出）：
```
https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/theme
https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks
```

## 五｜余力加练：数据同步时间

`app.js` 加 `showSyncTime()`：api 模式首次加载完成后，在筛选计数下方显示「**数据同步于 HH:MM:SS**」（fetch 完成的本地时刻）。

- 动态创建元素，不写死在 HTML；只在 api 模式显示（mock/演示态不显示）
- 接口字段里没有 `updated_at`，且今日禁改后端，所以用前端本地时刻——这是不改后端前提下的唯一解
- 页面实测显示「数据同步于 16:12:28」✅

## 六｜公网 URL

```
https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/
```

可分享：任何人打开都能看到这份真实待办数据（只读；写操作 Day 21+ 接）。

## 七｜入库文件

| 文件 | 归属 |
| --- | --- |
| `app.js` | Day 20 改（余力加练：showSyncTime 同步时间显示） |
| `day20-golive.md` | Day 20 新增（本文档） |

其余（云函数、接口、schema）**零改动**——遵守「今日不做：改后端代码」。

## 八｜Day 21+ 接手须知

- 前端写操作（添加/完成/删除/拖拽同步到后端）还没接——目前写操作仍只改本地 localStorage，刷新后会被接口数据覆盖（api 模式每次加载都从接口读）
- `/api/theme`（别的会话加的）还没拆数据访问层，可照 `db.js` 模式拆
- 两表 + app_state 表均无 RLS，多用户前必须配
