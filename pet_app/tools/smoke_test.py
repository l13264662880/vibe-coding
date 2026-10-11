# -*- coding: utf-8 -*-
"""离屏冒烟测试：验证 PetWindow 全部关键路径不报错。

运行：QT_QPA_PLATFORM=offscreen python tools/smoke_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from core.config_store import ConfigStore
from ui.pet_window import PetWindow

app = QApplication([])
config = ConfigStore()
pet = PetWindow(config)
pet.show()

# 1) 初始渲染一帧
pet._on_frame()
assert pet._state == "idle", pet._state

# 2) 成套主题切换（持久化 + 气泡）
pet.apply_theme("mint")
assert config.get("pet", "theme") == "mint"
assert config.get("pet", "outfit_mode") == "theme"
assert config.get("pet", "parts")["top"] == "top_b"

# 3) 自由拼装单部位
pet.set_part("head", "head_a")
assert config.get("pet", "parts")["head"] == "head_a"
assert config.get("pet", "outfit_mode") == "free"

# 4) 5 组动画状态切换 + 帧推进
for st in ("walk", "jump", "sleep", "focus", "idle"):
    pet._set_state(st)
    pet._on_frame()
    assert pet._state == st, st

# 5) 弹跳播完回退逻辑
pet._set_state("walk")
pet._set_state("jump")
for _ in range(10):
    pet._on_frame()
assert pet._state == "walk", pet._state   # jump 非循环，播完应回 walk

# 6) 渲染合成（paintEvent 实跑）
pm = pet.grab()
assert not pm.isNull() and pm.width() == 160

# 7) 拖拽/位置记忆 API
pet.move(300, 200)
pet._persist_pos()
assert config.get("pet", "pos_x") == 300

print("SMOKE OK: 渲染/换装/5动画/持久化 全部通过")
