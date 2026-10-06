/* theme.js —— 面板主题：4 套完整风格 + 手动选择器 + 精灵换装联动兜底
 *
 * 风格（data-theme 属性驱动，样式定义在 style.css）：
 *   play       玩趣明快（默认）
 *   minimal    极致极简
 *   editorial  杂志编辑
 *   dark       暗夜
 *
 * 选择优先级（启动时）：
 *   1. localStorage['panel-theme'] —— 用户在面板手动选过的风格
 *   2. localStorage['sprite-theme'] —— 精灵换装联动（映射到风格，取模）
 *   3. 默认 play
 *
 * 精灵联动：只有用户「没在面板手动选过」时才跟随精灵换装；
 *   一旦手动选过（panel-theme 存在），面板就不再被精灵牵着走。
 */
(() => {
  'use strict';

  const THEME_KEY = 'panel-theme';      // 面板主题的本地缓存（云端才是共享真相）
  const SPRITE_KEY = 'sprite-theme';    // 精灵换装联动键
  // 主题跨端同步的云端 API（与 app.js 同一网关）
  const API_BASE = 'https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com';

  /* 七套风格：id 对应 data-theme，swatch 给选择器画色块预览 */
  const STYLES = [
    { id: 'play',      name: '玩趣明快', swatch: ['#ff5c3a', '#ffd23f', '#5bd9a6'] },
    { id: 'minimal',   name: '极致极简', swatch: ['#4f46e5', '#1a1a1a', '#fafafa'] },
    { id: 'editorial', name: '杂志编辑', swatch: ['#b3402a', '#1a1a1a', '#faf6ee'] },
    { id: 'dark',      name: '暗夜',     swatch: ['#6ea8fe', '#ececf1', '#16161c'] },
    { id: 'nature',    name: '自然有机', swatch: ['#7a9b6d', '#c8b98a', '#f4f1e6'] },
    { id: 'retro',     name: '复古未来', swatch: ['#39ff88', '#00e5ff', '#0d0f0d'] },
    { id: 'luxe',      name: '轻奢雅致', swatch: ['#b8923f', '#2a2520', '#faf7f0'] },
  ];

  function styleById(id) {
    return STYLES.find((s) => s.id === id) || STYLES[0];
  }

  function applyStyle(id) {
    const style = styleById(id);
    document.documentElement.setAttribute('data-theme', style.id);
    // 写本地缓存：下次启动的「上一刻主题」立即可见（防闪烁）；云端才是共享真相
    try { localStorage.setItem(THEME_KEY, id); } catch (err) { /* 忽略 */ }
    // 调色板按钮上的小色点：一眼看出当前是哪套
    const dot = document.querySelector('.theme-toggle .theme-dot');
    if (dot) dot.style.background = style.swatch[0];
    syncMenu(style.id);
  }

  // 把主题写到云端：fire-and-forget，失败静默（离线时本地选择依然生效）
  function syncThemeToServer(id) {
    fetch(`${API_BASE}/api/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: id }),
    }).catch(() => { /* 离线/网关异常时静默 */ });
  }

  // 从云端拉当前主题（云端 = 三端共享真相，「最后写入者胜」）：
  // 只在启动时拉一次，不做轮询——免费版资源点扛不住轮询频率。
  // 其他端改了主题时，本端刷新页面即可同步；实时推送是后续课题。
  function pullThemeFromServer() {
    fetch(`${API_BASE}/api/theme`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!payload || !payload.ok) return;
        const id = payload.data && payload.data.theme;
        if (id && styleById(id).id === id) applyStyle(id);
      })
      .catch(() => { /* 离线时忽略 */ });
  }

  /* 读启动风格：panel-theme > sprite-theme（映射）> play */
  function readStyle() {
    try {
      const own = localStorage.getItem(THEME_KEY);
      if (own && styleById(own).id === own) return own;

      const sprite = parseInt(localStorage.getItem(SPRITE_KEY) || '', 10);
      if (!Number.isNaN(sprite) && sprite >= 0) {
        return STYLES[sprite % STYLES.length].id;
      }
    } catch (err) { /* 隐私模式读不到就回默认 */ }
    // 没有任何手动/联动偏好时：跟随系统深色模式（首次打开更聪明）
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (err) { /* 忽略 */ }
    return 'play';
  }

  /* 选择器菜单的选中态 */
  function syncMenu(id) {
    document.querySelectorAll('.theme-option').forEach((btn) => {
      const active = btn.dataset.theme === id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  /* 初始化：注入选择器菜单（HTML 由 index.html 提供静态结构，这里补绑定） */
  function initPicker() {
    const toggle = document.getElementById('themeToggle');
    const menu = document.getElementById('themeMenu');
    if (!toggle || !menu) return;

    const close = () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
    });

    menu.addEventListener('click', (event) => {
      const opt = event.target.closest('.theme-option');
      if (!opt) return;
      const id = opt.dataset.theme;
      applyStyle(id);          // 立即生效 + 写本地缓存
      syncThemeToServer(id);   // 同步到云端，其他端下次启动时跟上
      close();
    });

    // 点别处收起
    document.addEventListener('click', (event) => {
      if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) {
        close();
      }
    });

    // Esc 收起
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) close();
    });
  }

  // 启动：先应用本地缓存的主题（防闪烁）+ 绑定选择器，再异步向云端对齐（云端优先）
  applyStyle(readStyle());
  initPicker();
  pullThemeFromServer();

  // 精灵换装 → storage 事件跨窗口触发 → 面板跟着换（精灵换装 = 最后写入，必须跟随）。
  // ⚠️ 局限：storage 事件只在同源窗口间触发。Electron 面板与本应用同源时有效；
  // 网页版部署在云端域名下时，与本地 Electron 不同源，此联动收不到——
  // 三端真正联动走云端 /api/theme（applyStyle / 换装处已接入）。
  window.addEventListener('storage', (event) => {
    if (event.key !== SPRITE_KEY) return;
    const idx = parseInt(event.newValue, 10);
    if (!Number.isNaN(idx) && idx >= 0) {
      applyStyle(STYLES[idx % STYLES.length].id);
    }
  });
})();
