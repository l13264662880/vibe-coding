# 回滚手册（Day 26 实跑沉淀）

> 原则：**先恢复服务，再查原因**。回滚不丢人，挂着 500/404 才丢人。

## 一、回滚路径总览

| 层 | 回滚单位 | 手段 | 实操状态 |
|----|---------|------|---------|
| 静态托管（前端 9 文件） | 文件级 | 用旧版文件重新 `hosting deploy` | ✅ Day 26 已实跑 |
| 云函数（api-*） | 函数级 | `tcb fn deploy <name> --httpFn --force` 重发旧版代码 | 📋 仅备查（今日不做） |
| 数据库（PG） | 数据级 | `pg_dump` 导出 + 恢复；软删除任务可 `restore` 接口找回 | 📋 仅备查（今日不做） |

## 二、什么情况必须回滚（判断表）

| 现象 | 严重度 | 动作 |
|------|-------|------|
| 首页 404 / 500 / 白屏 | 🔴 致命 | **立即回滚**，不等原因 |
| 核心链路断（读不出任务/写不进） | 🔴 致命 | **立即回滚** |
| 报错变多但主流程能走 | 🟡 观察 | 记录 + 评估，热点修复优先 |
| 样式/文案小瑕疵 | 🟢  minor | 排期修复，不回滚 |
| 只有监控告警、无用户影响 | 🟢  minor | 先核实再决定 |

判据：**用户能不能完成「看一眼任务 + 改一件任务」**。不能 → 回滚。

## 三、静态托管回滚操作（Day 26 实跑验证）

```bash
# 0. 准备两套发布文件（都在仓库 git 历史里，不靠手快）
FILES="index.html style.css app.js mock-data.js mood.js pomodoro.js parse.js theme.js bamboo.svg"
mkdir -p _stage_target && git archive <目标commit> $FILES | tar -x -C _stage_target

# 1. 发布/回滚（⚠️ Git Bash 里必须加 MSYS_NO_PATHCONV=1，否则 "/" 被转换成怪异路径）
MSYS_NO_PATHCONV=1 node <tcb路径> hosting deploy _stage_target / -e yuanjian-d5gdhcntg91022662 --safe

# 2. 等 CDN 30 秒后验证（必须带 no-cache，否则读到缓存旧版）
curl -s -H "Cache-Control: no-cache" -o /dev/null -w "%{http_code}\n" https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/
```

- `--safe`：发布前自动备份（`.cloudbase-backup/<时间戳>/`），上传或校验失败自动回滚
- **不要叠加 `--verify`**：它走 CDN 做一致性校验，CDN 有分钟级延迟，会把成功发布误判失败并触发自动回滚（Day 26 实测踩过：11 秒的发布被回滚成 404）。校验用上面的 curl 手动做
- 回滚锚点：`v1.0` 标签（当前正式版）；上一内容版本 `51efc80`（写操作上云之前）

## 四、Day 26 回滚演练耗时记录（2026-10-13）

| 步骤 | 耗时 | 结果 |
|------|------|------|
| v1.0 首次发布（--safe --verify） | 11s | ❌ verify 撞 CDN 延迟误报 → 自动回滚 → 站点 404 |
| 事故恢复（重发 v1.0，去掉 --verify） | 8s + CDN 等待 30s | ✅ 首页 200，app.js 哈希与 v1.0 一致 |
| 计划内回滚到 51efc80 | 8s + CDN 等待 25s | ✅ 首页 200，app.js 确认是旧版 |
| 恢复 v1.0 | 8s + CDN 等待 25s | ✅ 首页 200，哈希一致 |
| **端到端（发现 404 → 恢复 200）** | **约 1 分钟** | 人工介入 2 条命令 |

结论：**这套流程敢用**。真正拖时间的不是回滚本身（8 秒），是 CDN 缓存等待（25-30 秒）和误报干扰（--verify）。已在第三节固化避坑。

## 五、遗留事项

- `.cloudbase-backup/` 备份目录不会自动清理，确认发布正确后定期清理（本地与云端都有）
- 云函数/数据库回滚路径今天只做了文档推演，下次演练补实操
