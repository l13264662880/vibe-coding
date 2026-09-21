# vibe-coding

一个从零搭起来的网站项目。**当前进度：Day 5**。

## 现在有什么

| 文件 | 归属 | 作用 |
| --- | --- | --- |
| `index.html` | Day 2 | 占位页，证明本地 → GitHub 的链路是通的，Day 7 会被真正的 MVP 替换 |
| `.gitignore` | Day 2 | 忽略规则。`.env`、依赖目录、构建产物都不会被提交 |
| `.env.example` | Day 2 | 环境变量模板，可以提交。告诉协作者需要配置哪些变量 |
| `AGENTS.md` | Day 1 | AI 协作硬规则文件，AI 开工前必读 |
| `research.md` | Day 3 | 需求研究：3 个同类待办产品比较 + 差异化定位 + 「本期不做」清单 |
| `PRD.md` | Day 4 | 产品需求文档：8 项 MVP 功能、砍功能清单及理由、10 条可打勾验收标准 |
| `TECH_DESIGN.md` | Day 5 | 技术方案：数据流一句话、前后端/数据库分工、技术路线（纯前端）+ 理由、桌面形态规划 |
| `data-flow.svg` | Day 5 | 数据流图：数据从哪来、到哪去（可直接打开截图） |
| `.env`（本地） | Day 2 | **本地文件，已被忽略，永远不会出现在 GitHub 上**（Day 23 才会真正用到） |

## 本地怎么跑

直接用浏览器打开 `index.html` 就行，暂时不需要任何依赖（Day 5 技术路线已确认：纯前端，零依赖）。

## 进度

- [x] Day 1 — 装环境、注册账号、建工作区
- [x] Day 2 — 建仓库、首次提交、配好忽略规则
- [x] Day 3 — 需求研究，产出 research.md（项目方向：强制排序的待办小工具）
- [x] Day 4 — 写 PRD，产出 PRD.md（功能范围定稿 + 10 条验收标准）
- [x] Day 5 — 技术方案，产出 TECH_DESIGN.md + data-flow.svg（技术路线：纯前端单页 + localStorage）
- [ ] Day 7 — 做 MVP，替换占位页
- [ ] Day 23 — 接数据库，用上 `.env`

## 技术路线（Day 5 定稿）

**纯前端单页**：HTML + CSS + 原生 JS + 浏览器 localStorage。

- 8 项 MVP 功能全部覆盖，零依赖、零费用、零部署，双击 `index.html` 即可使用。
- 不引入后端和数据库（PRD 4.1 已砍：单人使用，localStorage 够用）。
- 数据流：用户操作产生数据 → 存进 localStorage → 打开页面读回渲染。
- 桌面小工具形态已规划、暂缓：Day 7 先交网页，之后加桌面外壳（详见 `TECH_DESIGN.md` 第 4 节）。