# -*- coding: utf-8 -*-
"""Day 24 补充测试用例：更刁钻的输入（空值/超长/类型错乱/路径穿越/连点）。

运行：QT_QPA_PLATFORM=offscreen python tools/edge_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from core.config_store import ConfigStore
from ui.pet_window import PetWindow
from ui.wardrobe import Wardrobe

app = QApplication([])
fails = []


def check(pid, name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {pid} {name}" + (f" | {detail}" if detail else ""))
    if not ok:
        fails.append(pid)


config = ConfigStore()
pet = PetWindow(config)
pet.show()

# ---------- E1 路径穿越：part_id 里塞 ../ ----------
try:
    pet.set_part("head", "../../core/config_store")
    p = Wardrobe(config).part_path("head")
    inside = p and os.path.abspath(p).startswith(os.path.abspath("assets"))
    check("E1", "part_id 路径穿越", inside, f"解析路径 {p}")
except Exception as e:
    check("E1", "part_id 路径穿越", False, f"异常 {e!r}")

# ---------- E2 part_id 类型错乱 ----------
for bad in (None, 123, {"a": 1}, ["x"]):
    try:
        r = pet.set_part("head", bad)
        check("E2", f"part_id={bad!r}", r is False, f"返回 {r!r}")
    except Exception as e:
        check("E2", f"part_id={bad!r}", False, f"异常 {e!r}")

# ---------- E3 气泡刁钻文本 ----------
for text in ("", None, "喵" * 5000, "line1\nline2\nline3",
             "🎉🎉🎉", "<script>alert(1)</script>"):
    try:
        pet.show_bubble(text)
        check("E3", f"气泡 {str(text)[:12]!r}", True)
    except Exception as e:
        check("E3", f"气泡 {str(text)[:12]!r}", False, f"异常 {e!r}")

# ---------- E4 状态机高速乱切 ----------
try:
    seq = ["jump", "walk", "sleep", "focus", "idle"] * 12
    for st in seq:
        pet._set_state(st)
        pet._on_frame()
    legal = pet._state in ("idle", "walk", "jump", "sleep", "focus")
    check("E4", "60 次状态乱切", legal, f"最终 {pet._state}")
except Exception as e:
    check("E4", "60 次状态乱切", False, f"异常 {e!r}")

# ---------- E5 连点中触发休眠唤醒链 ----------
try:
    pet._set_state("idle")
    for _ in range(30):
        pet._handle_click()      # 快速连点
    pet._enter_sleep()           # 强制睡
    for _ in range(10):
        pet._handle_click()      # 睡中连点（唤醒+弹跳混合）
    legal = pet._state in ("idle", "walk", "jump", "sleep", "focus")
    check("E5", "连点/睡眠/唤醒混合", legal, f"最终 {pet._state}")
except Exception as e:
    check("E5", "连点/睡眠/唤醒混合", False, f"异常 {e!r}")

# ---------- E6 配置形态异常 ----------
from core.config_store import CONFIG_PATH
os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
cases = {
    "空文件": "",
    "JSON数组": "[]",
    "parts是字符串": json.dumps({"pet": {"parts": "oops"}}),
    "pos是字符串": json.dumps({"pet": {"pos_x": "abc", "pos_y": None}}),
    "未知字段": json.dumps({"pet": {"unknown": 1}, "hacker": True}),
    "负scale": json.dumps({"pet": {"scale": -3}}),
}
for name, raw in cases.items():
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(raw)
    try:
        c = ConfigStore()
        w = Wardrobe(c)
        p = PetWindow(c)
        check("E6", f"配置[{name}]", True)
    except Exception as e:
        check("E6", f"配置[{name}]", False, f"异常 {e!r}")
# 恢复干净配置
with open(CONFIG_PATH, "w", encoding="utf-8") as f:
    f.write("{}")

# ---------- E7 超长主题名 & 未知主题（空值变体） ----------
for t in ("", "   ", "x" * 300, None):
    try:
        pet.apply_theme(t)
        check("E7", f"主题 {str(t)[:10]!r}", False, "未拒绝")
    except KeyError:
        check("E7", f"主题 {str(t)[:10]!r}", True, "KeyError（有触发路径才会崩）")
    except Exception as e:
        check("E7", f"主题 {str(t)[:10]!r}", False, f"意外异常 {e!r}")

# ---------- E8 窗口尺寸与负坐标拖拽 ----------
try:
    pet.resize(0, 0)              # 零尺寸
    pet._on_frame()
    pet.show_bubble("零尺寸窗口")
    pet.resize(160, 160)
    pet.move(-9999, -9999)
    pet._persist_pos()
    c = ConfigStore()
    check("E8", "零尺寸+极端坐标", c.get("pet", "pos_x") == -9999,
          "位置已保存（下次启动钳制见 P3 记录项）")
except Exception as e:
    check("E8", "零尺寸+极端坐标", False, f"异常 {e!r}")

print(f"\n===== 汇总：{len(fails)} 个 FAIL =====")
for f in fails:
    print("FAIL", f)
sys.exit(0)
