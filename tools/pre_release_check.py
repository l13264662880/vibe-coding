#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""发布前检查（Day 25）：把「上线前要人工过一遍」的检查项固化成一条命令。

用法：
    python tools/pre_release_check.py            # 全量检查
    python tools/pre_release_check.py --quick    # 只查公网 + 密钥（最小版）

退出码：0 = 全部通过；1 = 有 FAIL。检查项可增删，加一项 = 加一个 check_xxx()。
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import urllib.error

shutil_which = shutil.which  # 别名，避免与下方局部变量混淆

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- 检查目标（换环境只改这里） ----------
SITE_URL = "https://yuanjian-d5gdhcntg91022662-1500297151.tcloudbaseapp.com/"
API_BASE = "https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com"
HEALTH_PATH = "/api/health"
TASKS_PATH = "/api/tasks"

# 密钥扫描：命中这些模式且出现在「不该出现的文件」里 → FAIL
SECRET_PATTERNS = [
    (r"github_pat_[A-Za-z0-9_]{20,}", "GitHub PAT"),
    (r"APP_ACCESS_TOKEN\s*=\s*['\"]?[A-Za-z0-9]{16,}", "APP_ACCESS_TOKEN 真值"),
    (r"81ad6640e81a92f614190806e95eac7938463655a73b33e7", "项目访问令牌真值"),
]
# 这些文件允许出现（模板/说明文档），其余文件命中即 FAIL
# 说明：app.js / theme.js / .workbuddy 下的 Day23 测试脚本带的是「挡扫描器」级
# 访问令牌（Day 17 历史决策，与后端 .env 的 APP_ACCESS_TOKEN 配对），
# 属既定设计，不是泄漏。
SECRET_ALLOWLIST = {".env.example", "app.js", "theme.js", "tools/pre_release_check.py"}
SECRET_ALLOW_PREFIX = (".workbuddy", "pet_app\\data", "pet_app/tools", "evidence")
SECRET_SCAN_EXTS = (".js", ".json", ".md", ".py", ".html", ".sh", ".yml", ".yaml")

results = []


def report(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" | {detail}" if detail else ""))


def _load_app_token():
    """从 .env 读 APP_ACCESS_TOKEN（仅本地检查用，不打印、不提交）。"""
    env_path = os.path.join(REPO, ".env")
    if not os.path.exists(env_path):
        return ""
    for line in open(env_path, encoding="utf-8"):
        if line.startswith("APP_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def _http_json(path, timeout=10, token=False):
    """GET 一个 JSON 接口，返回 (status, body_text)。"""
    headers = {"Accept": "application/json"}
    if token:
        headers["X-App-Token"] = _load_app_token()
    req = urllib.request.Request(API_BASE + path, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def check_site_online():
    """公网首页必须 200 且返回 HTML。"""
    try:
        req = urllib.request.Request(SITE_URL, headers={"User-Agent": "pre-release-check"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(200).decode("utf-8", "replace")
            ok = r.status == 200 and "<html" in body.lower()
            report("公网首页可访问", ok, f"{r.status} {SITE_URL}")
    except Exception as e:
        report("公网首页可访问", False, f"请求失败: {e!r}")


def check_health():
    """/api/health 必须 200 且 status:ok。"""
    try:
        status, body = _http_json(HEALTH_PATH)
        ok = status == 200 and '"status":"ok"' in body.replace(" ", "")
        report("健康接口 /api/health", ok, f"{status} {body[:80]}")
    except Exception as e:
        report("健康接口 /api/health", False, f"请求失败: {e!r}")


def check_tasks_api():
    """/api/tasks GET 必须 200 且 ok:true（带令牌，读接口是门面）。"""
    try:
        status, body = _http_json(TASKS_PATH, token=True)
        ok = status == 200 and '"ok":true' in body.replace(" ", "")
        report("任务接口 GET /api/tasks", ok, f"{status}")
    except urllib.error.HTTPError as e:
        # 401/403 说明令牌/鉴权出问题，也算 FAIL 并带上状态码
        report("任务接口 GET /api/tasks", False, f"HTTP {e.code}")
    except Exception as e:
        report("任务接口 GET /api/tasks", False, f"请求失败: {e!r}")


def check_secrets():
    """密钥不进 Git：.env 未被跟踪 + 源码无硬编码密钥真值。"""
    # 1) .env 是否被 git 跟踪
    tracked = subprocess.run(
        ["git", "ls-files", ".env"], cwd=REPO, capture_output=True, text=True
    ).stdout.strip()
    if tracked:
        report("密钥扫描：.env 未入库", False, f"被跟踪: {tracked}")
    else:
        report("密钥扫描：.env 未入库", True)

    # 2) 扫工作区源码里的密钥模式
    hits = []
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
        for fn in files:
            if not fn.endswith(SECRET_SCAN_EXTS):
                continue
            path = os.path.join(root, fn)
            rel = os.path.relpath(path, REPO).replace("\\", "/")
            if rel in SECRET_ALLOWLIST or rel.startswith(SECRET_ALLOW_PREFIX):
                continue
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            for pattern, label in SECRET_PATTERNS:
                if re.search(pattern, text):
                    hits.append(f"{rel} 命中[{label}]")
    report("密钥扫描：源码无硬编码真值", not hits, "; ".join(hits[:3]))


def _node_bin():
    """定位 node：先 PATH，找不到回退到 WorkBuddy 托管 node（本机实测路径）。"""
    found = shutil_which("node")
    if found:
        return found
    fallback = r"C:\Users\L1326\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
    return fallback if os.path.exists(fallback) else "node"


def check_functions_syntax():
    """云函数 JS 语法必须全部通过 node --check。"""
    fns = []
    for root, _dirs, files in os.walk(os.path.join(REPO, "functions")):
        fns += [os.path.join(root, f) for f in files if f.endswith(".js")]
    bad = []
    node = _node_bin()
    for f in fns:
        r = subprocess.run(
            [node, "--check", f], cwd=REPO, capture_output=True, text=True
        )
        if r.returncode != 0:
            bad.append(os.path.basename(f))
    report(f"云函数语法检查（{len(fns)} 个）", not bad,
           "失败: " + ",".join(bad) if bad else "node --check 全过")


def check_pet_smoke():
    """桌宠冒烟测试必须通过（offscreen，无需显示器）。"""
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen")
    r = subprocess.run(
        [sys.executable, os.path.join("pet_app", "tools", "smoke_test.py")],
        cwd=REPO, capture_output=True, text=True, env=env,
    )
    ok = r.returncode == 0 and "SMOKE OK" in r.stdout
    report("桌宠冒烟测试", ok,
           (r.stdout.strip().splitlines() or ["无输出"])[-1][:80])


def check_git_clean():
    """发布前工作区应无未提交改动（提醒项，不阻断）。"""
    r = subprocess.run(["git", "status", "--porcelain"], cwd=REPO,
                       capture_output=True, text=True)
    dirty = [l for l in r.stdout.splitlines() if l.strip()]
    report("工作区已提交（提醒）", not dirty,
           f"{len(dirty)} 个未提交改动" if dirty else "干净")


def check_readme():
    """README 必须存在且提到当前进度。"""
    p = os.path.join(REPO, "README.md")
    ok = os.path.exists(p) and "Day" in open(p, encoding="utf-8").read()
    report("README 存在且含进度", ok)


QUICK_CHECKS = [check_site_online, check_secrets]  # 最小版：公网 + 密钥
FULL_CHECKS = QUICK_CHECKS + [
    check_health, check_tasks_api, check_functions_syntax,
    check_pet_smoke, check_git_clean, check_readme,
]


def main():
    ap = argparse.ArgumentParser(description="发布前检查（Day 25）")
    ap.add_argument("--quick", action="store_true", help="只查公网 + 密钥")
    args = ap.parse_args()

    print(f"===== 发布前检查（{'最小版' if args.quick else '全量'}）=====")
    for fn in (QUICK_CHECKS if args.quick else FULL_CHECKS):
        try:
            fn()
        except Exception as e:  # 单项检查自身出错也算 FAIL，不中断整体
            report(fn.__name__, False, f"检查器异常: {e!r}")

    fails = [r for r in results if not r[1]]
    print(f"\n===== 汇总：{len(results) - len(fails)}/{len(results)} 通过 =====")
    for name, _ok, detail in fails:
        print(f"FAIL {name} | {detail}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
