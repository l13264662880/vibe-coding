# vibe-coding

一个从零搭起来的网站项目。**当前进度：Day 19 → 重构拆出数据访问层**。

**产品名**：智伴 PriorityPal —— 一个强制排序的待办小工具。所有任务排在一条唯一的队列里，**位置就是优先级**，第 1 名永远只有一个。

## 现在有什么

| 文件 | 归属 | 作用 |
| --- | --- | --- |
| `index.html` | Day 7 / 8 / 12 / 13 | 页面结构：标题、第一件事高亮区、输入框、任务列表、四种状态容器、撤销条；Day 12 加筛选条（状态 tab + 搜索框）；Day 13 加视图导航 + 三视图面板 |
| `style.css` | Day 7 / 8 / 12 / 13 | 全部样式：瓷灰底 + 墨色宋体 + 竹影背景；Day 8 补加载中/出错状态；Day 12 补筛选条样式；Day 13 补视图导航样式 |
| `app.js` | Day 7 / 8 / 12 / 13 | 全部逻辑：增删改、拖拽排序、完成/撤销、localStorage 读写；Day 8 抽「数据源」层；Day 12 加筛选（状态 + 关键词叠加）；Day 13 加 hash 路由视图切换 |
| `mock-data.js` | Day 8 / 13 | 本地假数据源：返回写死的示例任务，模拟异步加载；Day 13 起支持 `?scenario=empty/error/loading` 演示四种状态 |
| `bamboo.svg` | Day 7 | 背景竹枝，手写 SVG（不引图片文件、不联网、不进无障碍树） |
| `.gitignore` | Day 2 | 忽略规则。`.env`、依赖目录、构建产物都不会被提交 |
| `.env.example` | Day 2 | 环境变量模板，可以提交。告诉协作者需要配置哪些变量 |
| `AGENTS.md` | Day 1 | AI 协作硬规则文件，AI 开工前必读 |
| `research.md` | Day 3 | 需求研究：3 个同类待办产品比较 + 差异化定位 + 「本期不做」清单 |
| `PRD.md` | Day 4 / Day 7 | 产品需求文档：8 项 MVP 功能、砍功能清单及理由、10 条可打勾验收标准。Day 7 补了第 6.1 节「预排序」的排队记录 |
| `TECH_DESIGN.md` | Day 5 | 技术方案：数据流一句话、前后端/数据库分工、技术路线（纯前端）+ 理由、桌面形态规划 |
| `data-flow.svg` | Day 5 | 数据流图：数据从哪来、到哪去（可直接打开截图） |
| `api-contract.md` | Day 15 | 接口契约：前后端唯一约定（当前只有 `/api/health`），业务接口 Day 16–22 再补 |
| `day15-cloudbase.md` | Day 15 | CloudBase 环境信息：环境 ID、套餐能力、续期时间、安全红线、各环节用在哪天 |
| `cloudbaserc.json` | Day 15 | CloudBase CLI 配置：环境 ID + 云函数声明 |
| `functions/api-health/` | Day 15 | HTTP 云函数 `/api/health`（`index.js` + `scf_bootstrap`，监听 9000 端口） |
| `db/schema.sql` | Day 16 | 建表脚本：`tasks`（核心表）+ `task_events`（事件表），含索引、触发器、全部字段注释（幂等） |
| `db/seed.sql` | Day 16 | 种子脚本：8 行 tasks + 12 行 task_events + 4 条验证查询（幂等，重复执行不报错） |
| `day16-db.md` | Day 16 | Day 16 记录：两张表各存什么、靠`task_id` 关联、三个约束的实测报错 |
| `functions/api-tasks/` | Day 17–19 | HTTP 云函数 `/api/tasks`（读接口 + POST 新增；Day 19 拆分：`index.js` HTTP 层 + `db.js` 数据访问层） |
| `day17-read-api.md` | Day 17 | Day 17 记录：接口映射、REST 网关 + API Key 的技术路径、验证结果 |
| `day18-post-api.md` | Day 18 | Day 18 记录：POST 接口、防重复/防空校验、PostgREST 插入语法、验证结果 |
| `day19-refactor.md` | Day 19 | Day 19 记录：分层思路、拆分对比、分层示意图、回归验证结果 |
| `app.js` | Day 7–13 / Day 17 | 全部逻辑。Day 17 板块②接数据：`DATA_SOURCE` 改 `api`，从 `/api/tasks` 读真实数据替换 mock |
| `.workbuddy/skills/筛选交互检查/SKILL.md` | Day 12 | 筛选检查 Skill：frontmatter（name + description）+ 三条筛选验证清单 |
| `.workbuddy/skills/筛选交互检查/调用记录.md` | Day 12 | Skill 真实调用记录：三种筛选情况（有结果/无结果/清空恢复）实测全通过 |
| `.env`（本地） | Day 2 | **本地文件，已被忽略，永远不会出现在 GitHub 上**（Day 23 才会真正用到） |

> Day 2 的占位页已被 Day 7 的 MVP 替换，不再单列——它还在 Git 历史里（`Day 2` 那次提交），随时能翻出来看。

## 本地怎么跑

**方式一｜VS Code Live Server（本项目选定的方式）**

1. VS Code 打开本项目文件夹
2. 右键 `index.html` → **Open with Live Server**
3. 浏览器会自动打开。地址默认是 `127.0.0.1:5500`——想让地址栏显示 `localhost`，把它手工改成 `localhost:5500` 即可（两者等价）

**方式二｜Python 自带服务器（免安装、不用装任何扩展）**

```bash
cd my-site
py -m http.server 8000
```

然后浏览器打开 **http://localhost:8000**

**方式三｜直接双击 `index.html`**

也能用（Day 5 定的「纯前端、零依赖」就体现在这），但地址栏是 `file:///...`，不是 `localhost`。

> 三种方式都没有安装步骤、没有依赖要装——这是 Day 5 技术选型的直接结果。

## 进度

- [x] Day 1 — 装环境、注册账号、建工作区
- [x] Day 2 — 建仓库、首次提交、配好忽略规则
- [x] Day 3 — 需求研究，产出 research.md（项目方向：强制排序的待办小工具）
- [x] Day 4 — 写 PRD，产出 PRD.md（功能范围定稿 + 10 条验收标准）
- [x] Day 5 — 技术方案，产出 TECH_DESIGN.md + data-flow.svg（技术路线：纯前端单页 + localStorage）
- [x] Day 6 — 追加协作规则（AGENTS.md）
- [x] Day 7 — **MVP 跑起来了**：index.html / style.css / app.js 三件套 + 竹影背景 + 运行说明存档
- [x] Day 8 — **mock 数据版主视图**：抽「数据源」层（`mock-data.js`）+ 四种页面状态（加载中/有数据/空/出错），列表用假数据渲染
- [x] Day 9 — **设计审查**：统一间距与对比度（4 处修复）+ 窄屏番茄栏拆字修复
- [x] Day 10 — **补漏**：任务行操作按钮提高可见度
- [x] Day 11 — **交互反馈**：复制 / 完成 / 排序三个交互补上「生效了」提示
- [x] Day 12 — **筛选功能 + Skill**：状态 tab + 搜索框；创建并调用「筛选交互检查」Skill，三种情况实测通过
- [x] Day 13 — **三视图 + 四状态**：待办/番茄/心情三视图 hash 路由切换；列表空/加载/错误/正常四种状态（`?scenario=` 参数演示）
- [x] Day 14 — 真人测试全流程通过 + 窄屏拆字最小修复
- [x] Day 15 — **后端接入**：接 CloudBase 免费体验版（PostgreSQL 数据库），部署 `/api/health` HTTP 云函数 + 前端 mock 版上线 + 接口契约
- [x] Day 16 — **数据模型 + 建表**：`tasks`（核心表）+ `task_events`（事件表，靠 `task_id` 外键一对多关联），种子脚本 8+12 行，select 与约束实测全通过
- [x] Day 17 — **GET 读接口**：`/api/tasks`（全部任务）+ `/api/tasks/first`（第一件事），走 REST 网关读 PG，公网实测通过
- [x] Day 18 — **POST 写接口**：`/api/tasks` 新增任务，防重复提交 + 防空文本校验，同步写 `task_events`，公网实测通过
- [x] Day 19 — **重构拆数据访问层**：`db.js`（新）管 fetch 网关，`index.js` 只管 HTTP；契约零改动，本地+公网 6 项回归全过
- [ ] Day 20 — 接前端写操作（增删改同步到后端）+ 真实数据版重新上传
- [ ] Day 23 — 接数据库，用上 `.env`

## 视觉说明（Day 7）

外观迭代过几轮，最终定在 **「瓷影 · 古风」**：瓷灰绿底 + 墨色**宋体** + 深青瓷强调色 + 页头一枚朱砂方印。任务序号用汉字（一、二、三）。背景衬两枝**极淡、纯静态**的竹影，只在窗口 ≥990px 时出现，且永远让出内容区。

两条自我约束，改了别忘：

- **字体只留 400 字重**——宋体没有真 500/600，浏览器合成的假粗会发脏
- **最小字号 12px**——SimSun 在 11px 以下会点阵发虚

## 技术路线（Day 5 定稿）

**纯前端单页**：HTML + CSS + 原生 JS + 浏览器 localStorage。

- 8 项 MVP 功能全部覆盖，零依赖、零费用、零部署，双击 `index.html` 即可使用。
- 不引入后端和数据库（PRD 4.1 已砍：单人使用，localStorage 够用）。
- 数据流：用户操作产生数据 → 存进 localStorage → 打开页面读回渲染。
- 桌面小工具形态已规划、暂缓：Day 7 先交网页，之后加桌面外壳（详见 `TECH_DESIGN.md` 第 4 节）。