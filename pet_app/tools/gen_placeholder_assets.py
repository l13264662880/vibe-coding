# -*- coding: utf-8 -*-
"""占位素材生成器：用 QPainter 画简单色块/形状，保证代码可运行。

⚠️ 美术已定稿：真实素材只需同名放入 assets/parts/ 对应目录即可，
   本脚本仅生成调试用占位图（浅灰色轮廓 + 部位标签），可直接删除。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PySide6.QtCore import Qt, QRect
from PySide6.QtGui import QGuiApplication, QPixmap, QPainter, QColor, QFont, QPen
from PySide6.QtWidgets import QApplication

from ui.wardrobe import ANIMATIONS, WEAR_SLOTS, THEMES_PATH

CANVAS = 160
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS_DIR = os.path.join(BASE_DIR, "assets", "parts")

# 部位示意色（仅占位，非美术稿）
SLOT_COLORS = {
    "tail": "#B8860B", "bottom": "#4682B4", "top": "#CD5C5C",
    "shoes": "#556B2F", "head": "#FF8C00", "back": "#8A2BE2", "hand": "#20B2AA",
}
STATE_COLORS = {"idle": "#E8A87C", "walk": "#E8A87C", "jump": "#F5C97B",
                "sleep": "#C9B1E0", "focus": "#A8D8B9"}


def _draw(canvas: int, label: str, color: str, variant: int) -> QPixmap:
    pm = QPixmap(canvas, canvas)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    c = QColor(color)
    pen = QPen(QColor(80, 60, 40), 2)
    p.setPen(pen)

    if label.startswith("body"):
        # 本体：猫头+身体，variant 微调做出动画差异（眨眼/晃动/弹跳）
        dy = [0, 2, 0, -2][variant % 4]
        eye = Qt.white if variant % 2 else QColor(60, 40, 30)  # 眨眼交替
        p.setBrush(c)
        p.drawEllipse(QRect(45, 30 + dy, 70, 60))    # 头
        p.drawEllipse(QRect(55, 85 + dy, 50, 55))    # 身体
        p.drawEllipse(60, 48 + dy, 12, 10)           # 眼
        p.drawEllipse(88, 48 + dy, 12, 10)
        if variant % 2 == 0:
            p.setBrush(QColor(60, 40, 30))
            p.drawEllipse(64, 52 + dy, 4, 4)
            p.drawEllipse(92, 52 + dy, 4, 4)
    else:
        # 穿戴件：整画布描边框 + 部位标签，示意「该层贴图」
        c2 = QColor(color); c2.setAlpha(140)
        p.setBrush(c2)
        p.drawRect(10, 10, canvas - 20, canvas - 20)

    p.setPen(QPen(QColor(50, 35, 25)))
    f = QFont(); f.setPixelSize(11); p.setFont(f)
    p.drawText(QRect(0, canvas - 22, canvas, 20), Qt.AlignCenter, label)
    p.end()
    return pm


def main():
    app = QApplication(sys.argv)
    for state, (prefix, frames, _, _) in ANIMATIONS.items():
        d = os.path.join(PARTS_DIR, "body")
        os.makedirs(d, exist_ok=True)
        for i in range(frames):
            _draw(CANVAS, f"{prefix}_{i}", STATE_COLORS[state], i).save(
                os.path.join(d, f"{prefix}_{i}.png"))
    for slot, color in SLOT_COLORS.items():
        d = os.path.join(PARTS_DIR, slot)
        os.makedirs(d, exist_ok=True)
        if slot == "tail":
            _draw(CANVAS, "tail", color, 0).save(os.path.join(d, "tail.png"))
            continue
        # 每个槽位生成两套 part，供主题/拼装切换演示
        for pid in (f"{slot}_a", f"{slot}_b"):
            _draw(CANVAS, pid, color, 0).save(os.path.join(d, f"{pid}.png"))
    print("占位素材已生成到", PARTS_DIR)
    app.quit()


if __name__ == "__main__":
    main()
