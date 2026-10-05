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

  const THEME_KEY = 'panel-theme';      // 面板自己选的风格
  const SPRITE_KEY = 'sprite-theme';    // 精灵换装联动键

  /* 四套风格：id 对应 data-theme，swatch 给选择器画色块预览 */
  const STYLES = [
    { id: 'play',      name: '玩趣明快', swatch: ['#ff5c3a', '#ffd23f', '#5bd9a6'] },
    { id: 'minimal',   name: '极致极简', swatch: ['#4f46e5', '#1a1a1a', '#fafafa'] },
    { id: 'editorial', name: '杂志编辑', swatch: ['#b3402a', '#1a1a1a', '#faf6ee'] },
    { id: 'dark',      name: '暗夜',     swatch: ['#6ea8fe', '#ececf1', '#16161c'] },
  ];

  function styleById(id) {
    return STYLES.find((s) => s.id === id) || STYLES[0];
  }

  function applyStyle(id) {
    const style = styleById(id);
    document.documentElement.setAttribute('data-theme', style.id);
    syncMenu(style.id);
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
      try { localStorage.setItem(THEME_KEY, id); } catch (err) { /* 忽略 */ }
      applyStyle(id);
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

  // 启动：应用当前风格 + 绑定选择器
  applyStyle(readStyle());
  initPicker();

  // 精灵换装 → storage 事件跨窗口触发。只在用户没手动选过时跟随。
  window.addEventListener('storage', (event) => {
    if (event.key !== SPRITE_KEY) return;
    let own = false;
    try { own = !!localStorage.getItem(THEME_KEY); } catch (err) { /* 忽略 */ }
    if (own) return;
    const idx = parseInt(event.newValue, 10);
    if (!Number.isNaN(idx) && idx >= 0) {
      applyStyle(STYLES[idx % STYLES.length].id);
    }
  });
})();
