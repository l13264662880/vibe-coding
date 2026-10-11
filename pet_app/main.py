# -*- coding: utf-8 -*-
"""程序入口：装配 Config + PetWindow，运行桌宠。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PySide6.QtWidgets import QApplication

from core.config_store import ConfigStore
from ui.pet_window import PetWindow


def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(True)

    config = ConfigStore()
    pet = PetWindow(config)
    pet.show()

    # 演示：换装接口（后续 ControlPanel 接入后由 UI 调用）
    # pet.apply_theme("mint")
    # pet.set_part("head", "head_b")
    # pet.set_focus(True)

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
