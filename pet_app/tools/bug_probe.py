# -*- coding: utf-8 -*-
"""Day 24 复现探针：用刁钻输入实测 PetWindow / Wardrobe / ConfigStore。

只收集失败证据，不修代码。运行（offscreen）：
  QT_QPA_PLATFORM=offscreen python tools/bug_probe.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from core.config_store import ConfigStore, CONFIG_PATH
from ui.pet_window import PetWindow
from ui.wardrobe import Wardrobe

app = QApplication([])
findings = []


def record(pid, name, ok, detail):
    tag = "PASS" if ok else "FAIL"
    print(f"[{tag}] {pid} {name}: {detail}")
    if not ok:
        findings.append((pid, name, detail))


# ---------- P1 未知主题 ----------
config = ConfigStore()
pet = PetWindow(config)
try:
    pet.apply_theme("no_such_theme")
    record("P1", "apply_theme 未知主题", False, "未报错但也没有任何反馈？需复查")
except KeyError as e:
    record("P1", "apply_theme 未知主题", False,
           f"抛 KeyError 崩溃风险（UI 调用即闪退）: {e}")

# ---------- P2/P7 不存在的 part_id（数据腐化） ----------
accepted = pet.set_part("head", "no_such_part")
saved = ConfigStore().all()   # 读内存态（无变更时不落盘属正确行为）
bad_id = saved["pet"]["parts"]["head"]
w = Wardrobe(config)
path = w.part_path("head")
exists = path and os.path.exists(path)
record("P2", "set_part 不存在的 part_id",
       (not accepted) and exists,
       f"返回值={accepted}，config 中 head={bad_id!r}，素材存在={bool(exists)}"
       + ("" if (not accepted and exists) else " → 非法 id 仍被写入或配置被污染"))

# ---------- P3 拖出屏幕外后重启（位置恢复不可达） ----------
pet.move(-500, -500)
pet._persist_pos()
pet2 = PetWindow(ConfigStore())
screen = app.primaryScreen().availableGeometry()
vis = pet2.x() > screen.left() - 160 and pet2.y() > screen.top() - 160
record("P3", "窗口拖出屏幕后重启恢复", vis,
       f"保存 (-500,-500)，重启恢复到 ({pet2.x()},{pet2.y()})，"
       f"屏幕 {screen.x()},{screen.y()}~{screen.right()},{screen.bottom()} → 桌宠找不到了"
       if not vis else "位置已钳制到可见区域")

# ---------- P4 超长文本气泡 ----------
pet2.show_bubble("喵" * 200)
b = pet2._bubble
ok = b.width() <= pet2.width() * 2.5 and b.height() <= pet2.height() * 2
record("P4", "超长文本气泡", ok,
       f"气泡尺寸 {b.width()}x{b.height()}，窗口 {pet2.width()}x{pet2.height()}"
       + ("" if ok else " → 气泡撑爆窗口"))

# ---------- P5 快速连点 50 次（状态机一致性） ----------
try:
    for _ in range(50):
        pet2._handle_click()
    stable = pet2._state in ("idle", "walk") or True  # 只要不抛异常且能落回合法态
    legal = pet2._state in ("idle", "walk", "jump", "sleep", "focus")
    # 连点后 sleep 定时器被反复重置，jump 播完回退，最终应停在合法状态
    for _ in range(100):
        pet2._on_frame()
    legal_end = pet2._state in ("idle", "walk", "jump", "sleep", "focus")
    record("P5", "快速连点 50 次", stable and legal and legal_end,
           f"最终状态 {pet2._state}")
except Exception as e:
    record("P5", "快速连点 50 次", False, f"异常: {e!r}")

# ---------- P6 config.json 损坏 ----------
with open(CONFIG_PATH, "w", encoding="utf-8") as f:
    f.write("{broken json!!")
try:
    c3 = ConfigStore()
    ok6 = c3.get("pet", "scale") == 1.0
    record("P6", "config.json 损坏", ok6,
           "已回退默认值" if ok6 else "默认值合并失败")
except Exception as e:
    record("P6", "config.json 损坏", False, f"崩溃: {e!r}")

print("\n===== 汇总 =====")
for pid, name, detail in findings:
    print(f"FAIL {pid} {name}")
sys.exit(0)
