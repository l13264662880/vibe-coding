/* theme.js —— 面板（网页版任务面板）的主题联动
 *
 * 精灵换装时会把主题序号写进 localStorage（键 sprite-theme），
 * 这里监听 storage 事件，精灵一换装，面板立刻换成同一套配色。
 * 面板的主题和精灵的 5 套一一对应（奶黄包/蜜桃/薄荷/天空/薰衣草）。
 */

(() => {
  'use strict';

  const THEME_KEY = 'sprite-theme';

  /* 面板的颜色变量（不含字体/尺寸/动画，那些不随主题变） */
  const PANEL_THEMES = [
    { // 奶黄包
      '--bg': '#fdf6e3', '--card': '#fffdf6', '--card-hover': '#ffffff', '--card-sunken': '#faf1dc',
      '--line': 'rgba(180,130,40,.16)', '--line-strong': 'rgba(180,130,40,.3)',
      '--text': '#4a3525', '--text-dim': '#8a7355', '--text-faint': '#a58a66',
      '--accent': '#d99a2b', '--accent-line': '#e8b34a', '--accent-soft': 'rgba(232,179,74,.14)',
      '--seal': '#e88a6a', '--danger': '#e07a62', '--ok': '#b8860b',
    },
    { // 蜜桃
      '--bg': '#fdeee8', '--card': '#fffaf4', '--card-hover': '#ffffff', '--card-sunken': '#fbe8de',
      '--line': 'rgba(220,130,100,.16)', '--line-strong': 'rgba(220,130,100,.3)',
      '--text': '#4a3328', '--text-dim': '#8a6a5a', '--text-faint': '#a58a76',
      '--accent': '#e88a6a', '--accent-line': '#f0a080', '--accent-soft': 'rgba(232,138,106,.14)',
      '--seal': '#e07a62', '--danger': '#d06048', '--ok': '#c8785a',
    },
    { // 薄荷
      '--bg': '#edf7f0', '--card': '#f6fdf8', '--card-hover': '#ffffff', '--card-sunken': '#e4f2e8',
      '--line': 'rgba(80,150,120,.16)', '--line-strong': 'rgba(80,150,120,.3)',
      '--text': '#3a4a40', '--text-dim': '#6a8072', '--text-faint': '#8aa090',
      '--accent': '#4e9a74', '--accent-line': '#5bb87e', '--accent-soft': 'rgba(78,154,116,.14)',
      '--seal': '#5bb87e', '--danger': '#d06048', '--ok': '#3e8a68',
    },
    { // 天空
      '--bg': '#edf4fb', '--card': '#f8fbfe', '--card-hover': '#ffffff', '--card-sunken': '#e4eef8',
      '--line': 'rgba(90,140,190,.16)', '--line-strong': 'rgba(90,140,190,.3)',
      '--text': '#3a4a58', '--text-dim': '#6a7a88', '--text-faint': '#8a9aa8',
      '--accent': '#5a90c0', '--accent-line': '#6aa0d0', '--accent-soft': 'rgba(90,144,192,.14)',
      '--seal': '#4a80b0', '--danger': '#d06048', '--ok': '#4a80b0',
    },
    { // 薰衣草
      '--bg': '#f3eefb', '--card': '#fbf8fe', '--card-hover': '#ffffff', '--card-sunken': '#ece4f8',
      '--line': 'rgba(150,110,200,.16)', '--line-strong': 'rgba(150,110,200,.3)',
      '--text': '#433a54', '--text-dim': '#746a88', '--text-faint': '#948aa8',
      '--accent': '#9a6cd0', '--accent-line': '#aa7ce0', '--accent-soft': 'rgba(154,108,208,.14)',
      '--seal': '#7a5ab0', '--danger': '#d06048', '--ok': '#7a5ab0',
    },
  ];

  function applyTheme(idx) {
    const theme = PANEL_THEMES[idx];
    if (!theme) return;
    const root = document.documentElement.style;
    Object.entries(theme).forEach(([k, v]) => root.setProperty(k, v));
  }

  function readIndex() {
    let idx = parseInt(localStorage.getItem(THEME_KEY) || '0', 10);
    return PANEL_THEMES[idx] ? idx : 0;
  }

  // 启动时应用当前主题
  applyTheme(readIndex());

  // 精灵换装 → localStorage 变化 → storage 事件跨窗口触发 → 面板跟着换
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY) return;
    const idx = parseInt(event.newValue, 10);
    if (PANEL_THEMES[idx]) applyTheme(idx);
  });
})();
