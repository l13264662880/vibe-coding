#!/usr/bin/env python3
"""Day 28：把附录 J 验收清单 md 渲染成适合截图/分享的单页 HTML（紧凑浅色排版）。
用法: python tools/day28_md2html.py [输入md] [输出html]
默认: 附录J-结营验收清单.md -> evidence/day28/附录J-验收清单.html
"""
import pathlib
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "附录J-结营验收清单.md"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "evidence" / "day28" / "附录J-验收清单.html"

CSS = """
:root { --ink:#1f2329; --soft:#57606a; --line:#e5e7eb; --accent:#c2410c; --ok:#15803d; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; }
body { background:#eef0f3; font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif; color:var(--ink); }
.page { max-width:1220px; margin:0 auto; background:#ffffff; padding:16px 28px 18px; }
h1 { font-size:19px; margin:0 0 8px; padding-bottom:7px; border-bottom:2px solid var(--accent); letter-spacing:.01em; }
h2 { font-size:13.5px; margin:13px 0 5px; padding-left:8px; border-left:4px solid var(--accent); line-height:1.35; }
blockquote { margin:7px 0; padding:6px 12px; background:#fff7ed; border-left:3px solid var(--accent); border-radius:0 6px 6px 0; font-size:11.5px; color:#7c2d12; }
blockquote p { margin:2.5px 0; line-height:1.5; }
p { font-size:11.5px; line-height:1.55; margin:5px 0; }
table { width:100%; border-collapse:collapse; font-size:11.5px; margin:3px 0 5px; }
th { background:#f8fafc; text-align:left; color:#374151; }
th, td { padding:4px 8px; border-bottom:1px solid var(--line); line-height:1.45; vertical-align:top; }
tbody tr:nth-child(even) td { background:#fcfcfd; }
td:last-child, th:last-child { text-align:center; white-space:nowrap; }
.ok { color:var(--ok); font-weight:700; }
code { background:#f3f4f6; border:1px solid #e5e7eb; border-radius:4px; padding:0 5px; font-size:10.5px; font-family:Consolas,"Courier New",monospace; color:#b91c1c; }
pre { background:#f8fafc; border:1px solid var(--line); border-radius:6px; padding:8px 12px; font-size:10.5px; line-height:1.55; overflow-x:auto; }
pre code { background:none; border:none; color:#334155; padding:0; }
strong { color:#111827; }
hr { border:none; }
"""

body = markdown.markdown(SRC.read_text(encoding="utf-8"), extensions=["tables"])
# 让打勾状态在截图里一眼可见：✅ 绿色加粗
body = body.replace("✅", '<span class="ok">✅</span>')

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>附录 J｜结营验收清单（智伴 PriorityPal v1.0）</title>
<style>{CSS}</style>
</head>
<body><div class="page">
{body}
</div></body>
</html>
"""

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print("written:", OUT, f"({len(html)} bytes)")
