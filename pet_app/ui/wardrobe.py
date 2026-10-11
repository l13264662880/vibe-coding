# -*- coding: utf-8 -*-
"""换装逻辑：成套主题一键切换 / 6 部位自由拼装。

素材目录约定（美术定稿后同名替换即可）：
    assets/parts/body/   本体动画帧   <state>_<i>.png  （如 idle_0.png）
    assets/parts/tail/   尾巴         tail.png
    assets/parts/<slot>/ 穿戴件       <part_id>.png
槽位固定 6 个：bottom(下装) top(上衣) shoes(鞋子) head(头部配饰)
              back(背饰) hand(手持)
主题清单：assets/themes.json
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS_DIR = os.path.join(BASE_DIR, "assets", "parts")
THEMES_PATH = os.path.join(BASE_DIR, "assets", "themes.json")

# 渲染顺序（本体最先、穿戴件依次叠加，防穿模的关键）
RENDER_ORDER = ["body", "tail", "bottom", "top", "shoes", "head", "back", "hand"]
WEAR_SLOTS = ["bottom", "top", "shoes", "head", "back", "hand"]

# 本体 5 组动画：<状态名> -> (帧前缀, 帧数, fps, 是否循环)
ANIMATIONS = {
    "idle":  ("idle",  4, 4,  True),    # 待机眨眼晃动
    "walk":  ("walk",  4, 8,  True),    # 底部来回闲逛
    "jump":  ("jump",  4, 10, False),   # 点击弹跳（播一次）
    "sleep": ("sleep", 3, 3,  True),    # 休眠打哈欠
    "focus": ("focus", 2, 2,  True),    # 番茄专注安静待机
}


def _load_themes() -> dict:
    """读取主题清单；文件缺失时返回空（自由拼装仍可用）。"""
    try:
        with open(THEMES_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("themes", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


class Wardrobe:
    """管理 6 个穿戴槽位的当前选择，并做素材路径解析。

    不持有 QPixmap —— PetWindow 负责按 RENDER_ORDER 加载渲染；
    本类只负责「当前穿什么」的数据与切换规则。
    """

    def __init__(self, config):
        self._config = config
        self.themes = _load_themes()
        self.parts = dict(config.get("pet", "parts") or {})  # slot -> part_id
        self.theme = config.get("pet", "theme")
        self.mode = config.get("pet", "outfit_mode") or "theme"
        self.last_missing_parts = []   # 最近一次 apply_theme 中素材缺失的部位
        # 自愈：历史版本可能已把不存在的 part_id 写进配置，加载时清除
        bad = [s for s, pid in self.parts.items()
               if not self._part_exists(s, pid)]
        if bad:
            for s in bad:
                del self.parts[s]
            self._persist()

    # ---------- 查询 ----------
    def part_path(self, slot: str) -> str | None:
        """返回某槽位当前穿戴件的 PNG 绝对路径（无则 None）。"""
        pid = self.parts.get(slot)
        if not pid:
            return None
        return os.path.join(PARTS_DIR, slot, f"{pid}.png")

    def theme_names(self):
        return list(self.themes.keys())

    # ---------- 切换 ----------
    def _part_exists(self, slot: str, part_id: str) -> bool:
        """校验素材 PNG 真实存在，防非法 part_id 写入配置造成持久化腐化。"""
        return bool(part_id) and os.path.exists(
            os.path.join(PARTS_DIR, slot, f"{part_id}.png"))

    def apply_theme(self, theme: str) -> dict:
        """一键套用主题，返回本次实际变更的 {slot: new_part_id}。

        主题里素材缺失的部位会被跳过（保留原穿戴），不会写坏配置。
        """
        combo = self.themes.get(theme)
        if not combo:
            raise KeyError(f"未知主题: {theme}")
        valid = {s: combo[s] for s in combo
                 if s in WEAR_SLOTS and self._part_exists(s, combo[s])}
        missing = [s for s in combo if s in WEAR_SLOTS and s not in valid]
        changed = {s: valid[s] for s in valid if valid[s] != self.parts.get(s)}
        self.parts.update(valid)
        self.theme, self.mode = theme, "theme"
        self._persist()
        self.last_missing_parts = missing   # 供 UI 提示（气泡）用
        return changed

    def set_part(self, slot: str, part_id: str) -> bool:
        """自由拼装：单独替换一个部位。

        素材不存在时拒绝写入并返回 False（防配置腐化），切到 free 模式。
        """
        if slot not in WEAR_SLOTS:
            raise KeyError(f"非法槽位: {slot}")
        if not self._part_exists(slot, part_id):
            return False
        self.parts[slot] = part_id
        self.mode = "free"
        self._persist()
        return True

    # ---------- 持久化 ----------
    def _persist(self):
        for key, val in (("parts", self.parts), ("theme", self.theme),
                         ("outfit_mode", self.mode)):
            self._config.set("pet", key, val)
