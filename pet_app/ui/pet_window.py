# -*- coding: utf-8 -*-
"""悬浮桌宠窗口：图层合成渲染 + 拖拽 + 5 组动画状态机 + 气泡提示。

渲染顺序（wardrobe.RENDER_ORDER）：
    本体 → 尾巴 → 下装 → 上装 → 鞋子 → 头部配饰 → 背饰 → 手持
本体承担全部动画帧；穿戴件为静态贴图，随本体一起每帧重绘。

动画状态机（wardrobe.ANIMATIONS）：
    idle  待机眨眼晃动（默认）
    walk  底部来回闲逛（窗口自身水平往返）
    jump  点击弹跳（播一次后回 idle/walk）
    sleep 休眠打哈欠（无交互超时进入，交互即醒）
    focus 番茄专注安静待机（外部调用 set_focus 切入）
"""
import os

from PySide6.QtCore import Qt, QTimer, QPoint, Signal
from PySide6.QtGui import QPixmap, QPainter, QCursor
from PySide6.QtWidgets import QWidget, QLabel

from ui.wardrobe import Wardrobe, RENDER_ORDER, ANIMATIONS, PARTS_DIR
from core.config_store import BASE_DIR

BODY_DIR = os.path.join(PARTS_DIR, "body")

# 交互/拖拽阈值：位移小于该像素视为「点击」而非拖拽
CLICK_SLOP_PX = 5


class PetWindow(QWidget):
    """无边框置顶透明桌宠窗口。"""

    # 对外信号（后续 PomodoroTimer / ControlPanel 接入用）
    outfit_changed = Signal(str)          # 换装完成：描述文字
    state_changed = Signal(str)           # 动画状态切换
    clicked = Signal()                    # 单击本体

    def __init__(self, config):
        super().__init__(None,
                         Qt.FramelessWindowHint        # 无边框
                         | Qt.WindowStaysOnTopHint     # 置顶
                         | Qt.Tool)                    # 不占任务栏
        self.setAttribute(Qt.WA_TranslucentBackground) # 透明背景
        self.setWindowTitle("Desktop Pet")

        self._config = config
        self._wardrobe = Wardrobe(config)

        # ---------- 动画状态机字段 ----------
        self._state = "idle"          # 当前状态名
        self._prev_state = "idle"     # jump 播完回退用
        self._frame_idx = 0
        self._frame_timer = QTimer(self)               # 帧驱动
        self._frame_timer.timeout.connect(self._on_frame)
        self._set_fps(4)

        # ---------- 闲逛位移字段 ----------
        self._walk_dir = 1            # +1 向右 / -1 向左
        self._walk_origin_x = None    # 本轮闲逛起点

        # ---------- 素材缓存 ----------
        self._body_cache = {}         # (state, idx) -> QPixmap
        self._overlay_cache = {}      # path -> QPixmap
        self._overlays = {}           # slot -> QPixmap（当前穿戴件）

        # ---------- 拖拽/休眠字段 ----------
        self._press_pos = None        # 按下时的全局坐标
        self._dragging = False
        self._sleep_timer = QTimer(self)               # 无交互休眠计时
        self._sleep_timer.setSingleShot(True)
        self._sleep_timer.timeout.connect(self._enter_sleep)
        idle_sec = self._config.get("general", "sleep_after_idle_sec") or 30
        self._sleep_timer.start(idle_sec * 1000)

        # ---------- 气泡 ----------
        self._bubble = QLabel(self)
        self._bubble.setStyleSheet(
            "QLabel{background:#FFF7E0;color:#5A4632;border:1px solid #E8C97A;"
            "border-radius:10px;padding:6px 10px;font-size:12px;}")
        self._bubble.setWordWrap(True)
        self._bubble.hide()
        self._bubble_timer = QTimer(self)
        self._bubble_timer.setSingleShot(True)
        self._bubble_timer.timeout.connect(self._bubble.hide)
        self._bubble_duration = (self._config.get("general", "bubble_duration_sec")
                                 or 6) * 1000

        # 恢复窗口位置与换装
        self._restore_pos()
        self._refresh_overlays()

        self.resize(160, 160)
        self._set_state("idle")
        self._frame_timer.start()

    # ================= 对外 API =================
    def set_focus(self, on: bool):
        """番茄钟接入点：开始专注/结束专注。"""
        self._set_state("focus" if on else "idle")
        if on:
            self.show_bubble("专注模式启动，喵～")

    def apply_theme(self, theme: str):
        """整套主题切换：换装 → 持久化 → 气泡提示。"""
        changed = self._wardrobe.apply_theme(theme)
        self._refresh_overlays()
        self.update()
        msg = f"换上「{theme}」主题啦！({len(changed)} 个部位)"
        if self._wardrobe.last_missing_parts:
            msg += f"（{','.join(self._wardrobe.last_missing_parts)} 素材缺失已跳过）"
        self.show_bubble(msg)
        self.outfit_changed.emit(theme)

    def set_part(self, slot: str, part_id: str) -> bool:
        """自由拼装：单部位切换（素材缺失时拒绝并提示，不写坏配置）。"""
        if self._wardrobe.set_part(slot, part_id):
            self._refresh_overlays()
            self.update()
            self.show_bubble(f"{slot} → {part_id}")
            self.outfit_changed.emit(f"{slot}:{part_id}")
            return True
        self.show_bubble(f"没有「{part_id}」这个{slot}素材喵…")
        return False

    def show_bubble(self, text: str, duration_ms: int | None = None):
        """在头顶弹出气泡文字，超时自动隐藏。"""
        if not self._config.get("general", "bubble_enabled"):
            return
        self._bubble.setText(text)
        # 超长文本：先限宽再量高（QLabel+wordWrap 需两次 adjustSize 才准）
        self._bubble.setMaximumWidth(240)
        self._bubble.adjustSize()
        self._bubble.adjustSize()
        # 气泡位置：本体上方居中（出界则往下放）
        bx = (self.width() - self._bubble.width()) // 2
        by = self._bubble.height() + 8
        self._bubble.move(max(0, bx), max(0, by))
        self._bubble.show()
        self._bubble.raise_()
        self._bubble_timer.start(duration_ms or self._bubble_duration)

    # ================= 动画状态机 =================
    def _set_state(self, state: str, remember_prev: bool = True):
        if state not in ANIMATIONS:
            return
        if remember_prev and self._state in ("idle", "walk"):
            self._prev_state = self._state
        if state == "walk":
            self._walk_origin_x = self.x()
        self._state = state
        self._frame_idx = 0
        self._set_fps(ANIMATIONS[state][2])
        self.state_changed.emit(state)

    def _set_fps(self, fps: int):
        self._frame_timer.setInterval(int(1000 / fps))

    def _on_frame(self):
        """帧驱动：推进本体帧；walk 状态下额外移动窗口。"""
        _, frames, _, loop = ANIMATIONS[self._state]
        self._frame_idx += 1
        if self._frame_idx >= frames:
            if loop:
                self._frame_idx = 0
            elif self._state == "jump":      # 弹跳播完回退
                self._set_state(self._prev_state)
                self._frame_idx = 0

        if self._state == "walk":
            # 以窗口为周期左右往返，各走 80px
            step = 4 * self._walk_dir
            nx = self.x() + step
            if abs(nx - self._walk_origin_x) >= 80:
                self._walk_dir *= -1
            else:
                self.move(nx, self.y())
        self.update()                        # 触发 paintEvent

    # ================= 交互：拖拽 / 点击 / 休眠唤醒 =================
    def mousePressEvent(self, ev):
        if ev.button() == Qt.LeftButton:
            self._press_pos = ev.globalPosition().toPoint()
            self._dragging = False
        super().mousePressEvent(ev)

    def mouseMoveEvent(self, ev):
        if self._press_pos is None:
            return
        gp = ev.globalPosition().toPoint()
        if not self._dragging and (gp - self._press_pos).manhattanLength() > CLICK_SLOP_PX:
            self._dragging = True            # 超过阈值才算拖拽
        if self._dragging:
            delta = gp - self._press_pos
            self.move(self.pos() + delta)
            self._press_pos = gp
            if self._state == "walk":        # 拖拽中暂停闲逛基准
                self._walk_origin_x = self.x()

    def mouseReleaseEvent(self, ev):
        if ev.button() == Qt.LeftButton:
            if not self._dragging:
                self._handle_click()          # 位移小于阈值 → 点击
            self._dragging = False
            self._press_pos = None
            self._persist_pos()
        super().mouseReleaseEvent(ev)

    def _handle_click(self):
        """单击：唤醒 → 弹跳 → 气泡。"""
        self._poke()
        if self._state != "focus":            # 专注中不弹跳，保持安静
            self._set_state("jump")
        self.clicked.emit()

    def _poke(self):
        """任意交互：重置休眠计时，若在睡觉则醒来。"""
        idle_sec = self._config.get("general", "sleep_after_idle_sec") or 30
        self._sleep_timer.start(idle_sec * 1000)
        if self._state == "sleep":
            self._set_state(self._prev_state)
            self.show_bubble("喵？")

    def _enter_sleep(self):
        """无交互超时 → 打哈欠入睡（不改 _prev_state，醒来回原状态）。"""
        if self._state in ("idle", "walk"):
            self._set_state("sleep", remember_prev=False)
            self.show_bubble("（打哈欠）好困呀…")

    # ================= 渲染 =================
    def _refresh_overlays(self):
        """按当前穿搭加载穿戴件贴图（缺失素材静默跳过该层）。"""
        self._overlays.clear()
        for slot in RENDER_ORDER:
            if slot in ("body", "tail"):
                continue
            path = self._wardrobe.part_path(slot)
            if path and os.path.exists(path):
                self._overlays[slot] = self._overlay_cache.setdefault(
                    path, QPixmap(path))

    def _body_pixmap(self) -> QPixmap | None:
        """取当前状态当前帧的本体贴图，带缓存。"""
        prefix, frames, _, _ = ANIMATIONS[self._state]
        idx = self._frame_idx % frames
        key = (self._state, idx)
        if key not in self._body_cache:
            path = os.path.join(BODY_DIR, f"{prefix}_{idx}.png")
            if not os.path.exists(path):
                return None
            self._body_cache[key] = QPixmap(path)
        return self._body_cache[key]

    def paintEvent(self, _):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.SmoothPixmapTransform)

        # 1) 本体（含全部动画帧）；素材缺失时画占位色块便于调试
        body = self._body_pixmap()
        if body:
            painter.drawPixmap(0, 0, body)
        else:
            painter.fillRect(self.rect().adjusted(40, 40, -40, -40), Qt.gray)

        # 2) 依固定顺序叠加尾巴 + 6 个穿戴件（SourceOver 防穿模）
        tail_path = os.path.join(PARTS_DIR, "tail", "tail.png")
        for path in [tail_path] + [self._wardrobe.part_path(s)
                                   for s in RENDER_ORDER[2:]]:
            if path and os.path.exists(path):
                pm = self._overlay_cache.setdefault(path, QPixmap(path))
                painter.drawPixmap(0, 0, pm)
        painter.end()

    # ================= 位置记忆 =================
    def _restore_pos(self):
        x, y = self._config.get("pet", "pos_x"), self._config.get("pet", "pos_y")
        if x is not None and y is not None:
            self.move(int(x), int(y))

    def _persist_pos(self):
        self._config.set("pet", "pos_x", self.x())
        self._config.set("pet", "pos_y", self.y())
