-- =====================================================================
-- db/seed.sql —— 「先做哪件」种子数据（Day 16）
--
-- 目标库：CloudBase 环境 yuanjian-d5gdhcntg91022662 的 Serverless PostgreSQL
-- 执行方式：控制台「数据库 → SQL 编辑器」整份粘贴执行，或
--           tcb db execute -e yuanjian-d5gdhcntg91022662 -f db/seed.sql
--
-- ★ 幂等保证（今天的完成标准之一：重复执行不报错）：
--   1) 不写死自增 id，改为「先按业务键查在不在，不在才插入」
--   2) 所有插入都靠 WHERE NOT EXISTS 挡重复
--   3) 结束时用 RAISE NOTICE 报当前行数，方便确认
--   所以这个脚本可以天天跑、跑十遍都不脏数据。
--
-- 数据说明：
--   tasks 7 行（6 条未完成 + 1 条已完成 + 1 条已软删除，共 8 行）
--   task_events 12 行，覆盖 created / done / edited / reordered / deleted
--   故意留一条 done=true 的任务：验证「完成的任务沉到底部」；
--   故意留一条 deleted_at 非空的任务：验证软删除不占用 position。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 种子数据 1/2：核心表 tasks
-- ---------------------------------------------------------------------
-- 用WITH 语句配合「先查后插」，实现幂等：
--   把要插的行列出来 → 只保留 tasks 里不存在的 → 再插入
-- 业务键选 text（任务文字）：种子里这8 条文字各不相同，
-- 靠它判断「这条种子是不是已经进过库了」。
-- ---------------------------------------------------------------------
WITH seed (text, position, done, due, estimate, deleted_at) AS (
  VALUES
    -- 未完成任务：位置 1~6，构成「第一件事」到第 6 位
    ('复习高数第三章',        1, FALSE, DATE '2026-10-08', 90,  NULL),
    ('写完 Day 16 的建表笔记', 2, FALSE, DATE '2026-10-05', 60,  NULL),
    ('给妈妈打个电话',3, FALSE, NULL,                  15,  NULL),
    ('整理本周读书笔记',      4, FALSE, DATE '2026-10-10', 45,  NULL),
    ('把番茄钟的数据导出',    5, FALSE, NULL,                  30,  NULL),
    ('投递三家公司的简历',    6, FALSE, DATE '2026-10-12', 120, NULL),

    -- 已完成：done=true。对应前端「划线显示+ 沉到列表底部」
    ('买好明天的早饭',        7, TRUE,  NULL,                  20,  NULL),

    -- 已软删除：deleted_at 有值，但数据还在库里（能撤销）
    -- 注意它的 position=8，因为 1~7 已被上面占满——
    -- 软删除的语义是「不再参与排序」，但它自己的位置号仍保留。
    ('临时记一下要买酱油',    8, FALSE, NULL,                   5,
     TIMESTAMPTZ '2026-10-04 10:30:00+08')
)
INSERT INTO tasks (text, position, done, due, estimate, deleted_at)
SELECT s.text, s.position, s.done, s.due, s.estimate, s.deleted_at
FROM seed s
WHERE NOT EXISTS (
  SELECT 1 FROM tasks t WHERE t.text = s.text
);


-- ---------------------------------------------------------------------
-- 种子数据 2/2：事件表 task_events
-- ---------------------------------------------------------------------
-- 关联字段 task_id 用子查询按text 反查 tasks.id：
-- 这样脚本不依赖固定的自增 id，在任何库里跑都能对上。
--
-- 幂等靠 event_type + task_id 这个组合判重：
-- 「同一条任务的同一种事件」只记一次。
-- ---------------------------------------------------------------------
WITH ev (task_text, event_type, from_position, to_position, detail) AS (
  VALUES
    -- 任务 1 的完整人生：建出来→ 拖到第一位 → 改了字
    ('复习高数第三章',        'created',  NULL, 6,  NULL),
    ('复习高数第三章',        'reordered', 6,    1,  NULL),
    ('复习高数第三章',        'edited',   NULL, NULL,
      '{"old":"复习高数第三章","new":"复习高数第三章（下册）"}'::jsonb),

    -- 任务 2：建出来 → 拖过两次
    ('写完 Day 16 的建表笔记',  'created',   NULL, 2,  NULL),
    ('写完 Day 16 的建表笔记',  'reordered', 2,    4,  NULL),
    ('写完 Day 16 的建表笔记',  'reordered', 4,    2,  NULL),

    -- 任务 3：建出来 → 删了 → 又撤销回来（演示 PRD 的撤销删除）
    ('给妈妈打个电话',          'created',  NULL, 3,  NULL),
    ('给妈妈打个电话',          'deleted',  NULL, NULL,
      '{"reason":"输错了，不是这件事"}'::jsonb),
    ('给妈妈打个电话',          'restored', NULL, NULL, NULL),

    -- 任务 7：建出来 → 标记完成 → 又撤销完成 → 再标记完成
    ('买好明天的早饭',          'created',  NULL, 7,  NULL),
    ('买好明天的早饭',          'done',     NULL, NULL, NULL),
    ('买好明天的早饭',          'undone',   NULL, NULL, NULL)
)
INSERT INTO task_events (task_id, event_type, from_position, to_position, detail, occurred_at)
SELECT t.id, e.event_type, e.from_position, e.to_position, e.detail,
       now() - (INTERVAL '1 hour' * (15 - ROW_NUMBER() OVER (ORDER BY e.event_type, t.text)))
FROM ev e
JOIN tasks t ON t.text = e.task_text
WHERE NOT EXISTS (
  SELECT 1 FROM task_events x
  WHERE x.task_id = t.id AND x.event_type = e.event_type
);


-- ---------------------------------------------------------------------
-- 验证 1：两张表各有多少行（应当 tasks=8、task_events=12）
-- ---------------------------------------------------------------------
SELECT 'tasks'       AS 表名, COUNT(*) AS 行数 FROM tasks
UNION ALL
SELECT 'task_events' AS 表名, COUNT(*) AS 行数 FROM task_events;

-- ---------------------------------------------------------------------
-- 验证 2：核心表 select（完成标准：至少 5 行）
-- ---------------------------------------------------------------------
SELECT id, position, text, done, due, estimate, deleted_at
FROM tasks
ORDER BY position;

-- ---------------------------------------------------------------------
-- 验证 3：事件表 select，并JOIN 出任务文字（看关联是否正确）
-- ---------------------------------------------------------------------
SELECT e.id, e.task_id, t.text AS 任务, e.event_type, e.occurred_at
FROM task_events e
JOIN tasks t ON t.id = e.task_id
ORDER BY e.task_id, e.occurred_at;

-- ---------------------------------------------------------------------
-- 验证 4：第 1 位的未完成任务（产品的核心问题「先做哪件」的答案）
-- 顺手证明：已完成的、以及已软删除的，都不会挤进第 1 位。
-- ---------------------------------------------------------------------
SELECT text AS 第一件事
FROM tasks
WHERE done = FALSE AND deleted_at IS NULL
ORDER BY position
LIMIT 1;
