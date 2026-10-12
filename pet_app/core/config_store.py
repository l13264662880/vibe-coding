# -*- coding: utf-8 -*-
"""全局配置读写（穿搭 / 窗口位置 / 气泡行为）。

数据落在 data/config.json，结构见 DEFAULTS。
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "data", "config.json")

# 默认配置：首次启动或字段缺失时补齐
DEFAULTS = {
    "pet": {
        "pos_x": None,          # 记忆窗口位置；None = 系统默认
        "pos_y": None,
        "scale": 1.0,
        "outfit_mode": "theme", # "theme" | "free"
        "theme": "autumn",      # 当前成套主题名
        "parts": {              # 自由拼装：6 部位当前选择的 part_id
            "bottom": "bottom_a",
            "top": "top_a",
            "shoes": "shoes_a",
            "head": "head_a",
            "back": "back_a",
            "hand": "hand_a",
        },
    },
    "general": {
        "bubble_enabled": True,
        "bubble_duration_sec": 6,
        "sleep_after_idle_sec": 30,   # 无交互多久进入休眠打哈欠
    },
}


class ConfigStore:
    """轻量配置单例：启动加载、变更即存（原子写盘）。"""

    def __init__(self):
        self._data = self._load()

    # ---------- 内部 ----------
    def _load(self) -> dict:
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                loaded = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            loaded = {}
        # 防御：根或各段必须是 dict（用户手改可能写出数组/字符串/数字）
        if not isinstance(loaded, dict):
            loaded = {}
        # 用默认值补齐缺失字段（浅合并到二级）
        merged = json.loads(json.dumps(DEFAULTS))  # deep copy
        for section, values in loaded.items():
            if isinstance(values, dict) and isinstance(merged.get(section), dict):
                merged[section].update(values)
            elif isinstance(values, dict):
                merged[section] = values
            # 非 dict 的段直接忽略，保留默认值
        return merged

    def _save(self):
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)  # 原子替换，防写坏

    # ---------- 对外 API ----------
    def get(self, section: str, key: str):
        return self._data.get(section, {}).get(key)

    def set(self, section: str, key: str, value):
        """写入单个字段并立即持久化。"""
        self._data.setdefault(section, {})[key] = value
        self._save()

    def all(self) -> dict:
        return self._data
