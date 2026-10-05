# Day 16 · 数据模型设计 + 建表 + 种子（PostgreSQL）

> 记录时间：2026-10-05。
> 今日主任务：建表 + 种子脚本 + select 验证。**不写接口**（Day 17 才开始）、不改前端。

## 一｜两张表分别存什么、靠什么关联（今天要回答的问题）

| |表 1 `tasks`（核心表） | 表 2 `task_events`（事件表） |
| --- | --- | --- |
| **存什么** | 任务的「**现在**」：文字、位置、完成状态、软删除标记 | 任务的「**发生过什么**」：每次标记完成 / 删除 / 编辑 / 拖拽记一行 |
| **主键** | `id` | `id` |
| **关联字段** | — | `task_id` → `tasks.id`（**外键，一对多**） |
| **关键字段** | `text` `position` `done` `due` `estimate` `deleted_at` `created_at` `updated_at` | `task_id` `event_type` `from_position` `to_position` `detail` `occurred_at` |

**关联答案**：`task_events.task_id` 外键指向 `tasks.id`。一条任务可以有很多条事件；一条事件只属于一条任务。

### 为什么是这两张表（不是「用户表+待办表」）

PRD 4.1 已砍账号和多人协作，所以**不做users 表**——没有第二个用户，建出来就是空表一张。
本项目真正需要被记录的是「事情」和「事情的变化」，所以拆成「现状+ 历史」两张。

### 为什么核心表要留`deleted_at`（软删除）

PRD 验收标准第 6 条要「撤销删除」。软删除让删除 = 打一个时间戳、撤销 = 清回 NULL，
不需要把数据删掉再重建，也不怕撤销时数据已经被冲掉。

## 二｜建表：`db/schema.sql`（已入库）

放在 `public` schema——Day 17 的云函数直接 `SELECT * FROM tasks` 就能查，不用先设`search_path`。

**字段名刻意对齐前端 `app.js` 的任务对象**（`{ id, text, done, due, estimate }`），
这样 Day 17 查出来的数据几乎不用改名，前端接上即可。

### 三个「让规则自动生效」的设计（今天最值得记的部分）

|设计 | 作用 | 实测报错 |
| --- | --- | --- |
| **部分唯一索引** `idx_tasks_position_active` | 强制「第1 名只有一个」：未删除的任务里 position 不许重复。带 `WHERE deleted_at IS NULL`，所以删掉的任务会释放位置号 | `duplicate key ... idx_tasks_position_active`（23505） |
| **外键 + ON DELETE CASCADE** | 事件不能挂在不存在的任务上；任务真被删时历史一起清走，不留孤儿数据 | `violates foreign key constraint`（23503） |
| **CHECK约束** | `event_type` 只能是 7 个受控词、`position >= 1`、`estimate >= 0`。在数据库层挡住脏数据 | `violates check constraint`（23514） |

**「部分唯一索引」是本项目最贴合的一个设计**：本产品的核心规则是「位置唯一、并列不存在」，
这正好对应「未删除的行里 position 唯一」。用表级UNIQUE 约束做不到（约束不能带 WHERE），
用部分唯一索引则删掉的任务不占位置。

### 附带的两个便利

- `idx_tasks_open`：专门服务「第一件事」查询（`WHERE done=false AND deleted_at IS NULL ORDER BY position LIMIT 1`）
- `trg_tasks_updated_at` 触发器：每次 UPDATE 自动盖 `updated_at`，不靠前端每次传

## 三｜种子：`db/seed.sql`（已入库，重复执行不报错）

**幂等怎么做到的**：不写死自增 id，改为「先按业务键查在不在，不在才插」——
`tasks` 用 `text` 判重、`task_events` 用 `(task_id, event_type)` 判重，全部靠 `WHERE NOT EXISTS` 挡重复。

**实测**：连跑 3 次，行数稳定在 `tasks=8` / `task_events=12`，无报错。

种子内容（8 行 tasks）：6 条未完成（位置 1–6）+ 1 条已完成（位置 7）+ **1 条已软删除**（位置 8）。
后两种是故意留的，用来验证「完成的沉底」和「软删除不占位置」。

`task_events` 12 行覆盖全部 7 种事件类型，含一组完整的「删除 → 撤销删除」。

## 四｜select 验证结果

| 验证项 | 结果 |
| --- | --- |
| `SELECT * FROM tasks` | **8 行**（≥5 行达标），position 1–8 连续 |
| `SELECT * FROM task_events` | **12 行**（≥5 行达标），JOIN 出任务文字 |
| 关联正确性 | 12 条事件全部 JOIN 上任务文字，无孤儿 |
| 「第一件事」查询 | 返回「复习高数第三章」（第 1 位、未完成、未删除） |
| seed.sql 重复执行 | 跑 3 次无报错，行数不变 |
| 约束实测 | 重复 position / 事件挂空任务 / 事件类型拼错，三次均被数据库拒绝 |

## 五｜入库文件

| 文件 | 内容 |
| --- | --- |
| `db/schema.sql` | 建表 + 索引 + 触发器 + 全部字段注释（幂等） |
| `db/seed.sql` | 8 行 tasks + 12 行 task_events + 4 条验证查询（幂等） |

## 六｜命令备忘（下次连库直接用）

```bash
# 执行 SQL（--sql 传单条；多语句用 $(cat 文件) 整份传入）
tcb db execute -e yuanjian-d5gdhcntg91022662 --sql "SELECT 1"
tcb db execute -e yuanjian-d5gdhcntg91022662 --sql "$(cat db/schema.sql)"

# 查表/ 查索引
tcb db execute -e <envId> --sql "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
```

## 七｜Day 17 接手须知

- 读接口只需 `tasks` 一张表：`WHERE deleted_at IS NULL ORDER BY position`
- 写接口记得**同时写一张 `task_events`**（本表的`event_type` 只有 7 个合法值，超出要改CHECK）
- 拖拽排序会改 `position`，注意「部分唯一索引」在拖拽过程中的临时冲突

## 八｜待办坑（Day 18+ 要处理）

**两张表目前都是「无 RLS」**（2026-10-05 控制台实拍确认）。

RLS = Row Level Security（行级安全策略），作用是「限制谁能看到哪些行」。
单人使用时不需要，但**一旦要支持多用户**（PRD 第 6 节排队的「账号/云同步」），
必须回来给 `tasks` / `task_events` 配 RLS + 访问策略，否则任何拿到云函数公网地址的人
都能读写所有人的任务数据。

Day 17 的读接口是公开的（无鉴权），届时至少要确认：单用户阶段这样可以，但别忘了这个坑。

## 九｜提交记录

| 提交 | 内容 |
| --- | --- |
| `a4e4ad5` | Day 16 主提交：`db/schema.sql` + `db/seed.sql` + 本文档 + README/AGENTS 进度更新 |
| `73d70e5` |补记第八节 RLS 坑（当日控制台实拍后追加） |

两个提交均已推送到 `origin/main`。


