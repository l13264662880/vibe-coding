-- =====================================================================
-- db/schema.sql —— 「先做哪件」数据库结构（Day 16 建表）
--
-- 目标库：CloudBase 环境 yuanjian-d5gdhcntg91022662 的 Serverless PostgreSQL
-- 执行方式：控制台「数据库 → SQL 编辑器」整份粘贴执行，或
--           tcb db execute -e yuanjian-d5gdhcntg91022662 -f db/schema.sql
-- 幂等：全部使用 IF NOT EXISTS，重复执行不报错、可安全重跑
--
-- 两张表各存什么、靠什么关联（今天要回答的问题）：
--   1) tasks        —— 任务的「现在」：文字、位置、完成状态、软删除标记
--   2) task_events  —— 任务的「发生过什么」：每条操作一行历史
--   关联字段：task_events.task_id  →  tasks.id   （外键，一对多）
--   一条任务可以有很多条事件；一条事件只属于一条任务。
--
-- 放public schema 的原因：Day 17 起的云函数直接
--   SELECT * FROM tasks
-- 就能查，不需要先设置 search_path，少一道手续。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 表 1：tasks —— 核心表，Day 17 的读接口只依赖它
-- ---------------------------------------------------------------------
-- 字段名刻意和前端 app.js 里的任务对象保持一致
-- （{ id, text, done, due, estimate }），这样 Day 17 云函数查出来
-- 几乎不用改名，前端接上即可。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  -- 主键。自增 bigint：省事、索引小；将来要多人协作再换 uuid 也来得及。
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 任务文字。正文用 TEXT（不限长度），不用 VARCHAR(255)：
  -- 待办文字虽短，但没必要为省几 KB 冒「存不下」的风险。
  text         TEXT        NOT NULL,

  -- 排序位置 = 优先级。这是本产品的核心：产品在数组里的先后顺序
  -- 就是「先做哪件」的答案，而数组顺序在数据库里必须落成一个数字。
  -- 值越小越靠前，第 1 位就是「第一件事」。
  -- 前端原来靠数组下标隐式表达顺序，搬到数据库后必须变成显式字段。
  position     INTEGER     NOT NULL CHECK (position >= 1),

  -- 是否已完成。对应前端 task.done。
  -- 完成的会自动沉到列表底部、不再参与「第一件事」。
  done         BOOLEAN     NOT NULL DEFAULT FALSE,

  -- 截止日期，可空。对应前端 task.due，没有就是 NULL。
  -- 用 DATE 不用字符串：日期要能比较大小（「今天之前到期有哪些」），
  -- 字符串比大小是按字典序，容易出错。
  due          DATE,

  -- 预估耗时（分钟），可空。对应前端 task.estimate。
  -- 用 INTEGER：只用来做「加起来还剩多少分钟」的加减运算，
  -- 不需要 TIMESTAMP 那种精度。
  estimate     INTEGER     CHECK (estimate IS NULL OR estimate >= 0),

  -- 软删除时间戳，可空。对应 PRD 的「撤销删除」功能。
  -- NULL = 没被删；打上时间戳 = 已删除但数据还留着；
  -- 撤销删除就是把这个字段清回NULL，不需要把数据删了再重建。
  deleted_at   TIMESTAMPTZ,

  -- 审计时间戳。数据库自己记，不靠前端传，避免漏传或造假。
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 强制本产品的核心规则「第 1 名只有一个」：
-- 未被删除的任务里，position 不能重复。
-- 用「部分唯一索引」而不是表里的 UNIQUE 约束——因为约束不能带 WHERE，
-- 而我们需要「只约束deleted_at IS NULL 的行」。
-- 效果：删掉第 2 位的任务后，位置 2 空出来可以被新任务占用；
--       而已删除的老任务不会一直占着位置号。

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_position_active
  ON tasks (position)
  WHERE deleted_at IS NULL;

-- 「第一件事」查询的固定套路：
--   WHERE done = false AND deleted_at IS NULL ORDER BY position LIMIT 1
-- 建个索引让它别全表扫。
CREATE INDEX IF NOT EXISTS idx_tasks_open
  ON tasks (position)
  WHERE done = FALSE AND deleted_at IS NULL;

-- updated_at 自动维护：每次 UPDATE 自动盖上新时间戳。
-- 不靠前端每次手动传——漏传一次，数据的时间信息就不准了。
CREATE OR REPLACE FUNCTION tasks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_set_updated_at();


-- ---------------------------------------------------------------------
-- 表 2：task_events —— 事件表，记录任务身上发生过什么
-- ---------------------------------------------------------------------
-- 核心表 tasks 只回答「现在长什么样」；
-- 这张表回答「它怎么变成这样的」：谁在什么时候把它标记完成、删掉、改了字。
--
-- 为什么 Day 16 就要它：
--   ① 一对多关系的练习（靠 task_id 关联tasks.id）
--   ② PRD 的「撤销删除」「编辑留痕」以后都要读这张表
--   ③ 想知道「我上周完成了多少件事」时，只需要查这张表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  -- 主键
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 关联字段（今天最重要的一个字段）。
  -- 指向 tasks.id，外键约束保证「事件不能挂在不存在的任务上」。
  -- ON DELETE CASCADE：任务被彻底删掉时，它的历史事件一起清掉，
  -- 不留孤儿数据。
  task_id      BIGINT      NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,

  -- 事件类型。用受控词表而不是自由文本：
  -- 这样 CHECK 能在数据库层挡住拼错的值（比如写成'finish'），
  -- 也保证以后写统计SQL 时不会出现多种叫法。
  event_type   TEXT        NOT NULL CHECK (event_type IN (
                 'created',    -- 新建
                 'done',       -- 标记完成
                 'undone',     -- 撤销完成
                 'deleted',    -- 删除（软删）
                 'restored',   -- 撤销删除
                 'edited',     -- 改了任务文字
                 'reordered'   -- 拖拽改了位置
               )),

  -- 拖拽事件专用：拖之前在第几位、拖之后在第几位。
  -- 非拖拽事件这两个字段留NULL。留档是为了将来能回答
  --「这件事被拖动过几次」这类问题。
  from_position INTEGER,
  to_position   INTEGER,

  -- 事件附带的细节，用 JSONB：
  --   edited 事件存 {"old": "旧文字", "new": "新文字"}
  --   其他事件存 NULL。
  -- 为什么用 JSONB 而不是加两列 old_text / new_text：
  --   只有编辑事件用得上，为一种事件加两个字段会污染表结构；
  --   JSONB 还能装下将来新加的事件类型（不一定要改表）。
  detail        JSONB,

  -- 事件发生时间
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 「查某条任务的全部历史」是这张表最高频的查询：
--   SELECT * FROM task_events WHERE task_id = 3 ORDER BY occurred_at DESC
CREATE INDEX IF NOT EXISTS idx_task_events_task
  ON task_events (task_id, occurred_at DESC);


-- ---------------------------------------------------------------------
-- 字段注释（余力加练：给每个字段加注释）
-- ---------------------------------------------------------------------
COMMENT ON TABLE  tasks                IS '核心表：任务的「现在」——文字、位置(优先级)、完成状态、软删除标记。Day 17 读接口只依赖这张表。';
COMMENT ON COLUMN tasks.id            IS '主键，自增 bigint';
COMMENT ON COLUMN tasks.text          IS '任务文字，对应前端 task.text。TEXT 不限长度';
COMMENT ON COLUMN tasks.position      IS '排序位置 = 优先级，值越小越靠前，第1 位即「第一件事」。未删除的行之间不允许重复';
COMMENT ON COLUMN tasks.done          IS '是否已完成，对应前端 task.done。已完成的沉到底部、不参与「第一件事」';
COMMENT ON COLUMN tasks.due           IS '截止日期，可空。用 DATE 因为要按日期比较大小';
COMMENT ON COLUMN tasks.estimate      IS '预估耗时（分钟），可空。只做加减运算，用 INTEGER 足够';
COMMENT ON COLUMN tasks.deleted_at    IS '软删除时间戳。NULL=未删除；打时间戳=已删除但可恢复（PRD 撤销删除）；清回 NULL 即撤销';
COMMENT ON COLUMN tasks.created_at    IS '创建时间，由数据库自动记录';
COMMENT ON COLUMN tasks.updated_at    IS '最后更新时间，由触发器自动维护，不依赖前端传值';

COMMENT ON TABLE  task_events          IS '事件表：任务的「发生过什么」——每次标记完成/删除/编辑/拖拽记一行。';
COMMENT ON COLUMN task_events.id      IS '主键，自增 bigint';
COMMENT ON COLUMN task_events.task_id IS '关联字段 → tasks.id。外键+ON DELETE CASCADE，保证没有孤儿事件。查询某任务历史就按它过滤';
COMMENT ON COLUMN task_events.event_type IS '事件类型，受 CHECK 约束：created/done/undone/deleted/restored/edited/reordered';
COMMENT ON COLUMN task_events.from_position IS '拖拽前位置，仅 reordered 事件有值';
COMMENT ON COLUMN task_events.to_position   IS '拖拽后位置，仅 reordered 事件有值';
COMMENT ON COLUMN task_events.detail  IS '事件细节(JSONB)。例：编辑事件存 {"old":"旧文字","new":"新文字"}，其余事件为 NULL';
COMMENT ON COLUMN task_events.occurred_at IS '事件发生时间，数据库自动记录';
