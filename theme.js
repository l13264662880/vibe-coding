/* theme.js —— 面板（网页版任务面板）的主题联动
 *
 * 精灵换装时会把主题序号写进 localStorage（键 sprite-theme），
 * 这里监听 storage 事件，精灵一换装，面板立刻换成同一套配色。
 * 面板的主题和精灵的 5 套一一对应（奶黄包/蜜桃/薄荷/天空/薰衣草）。
 *
 * 玩趣明快重设计：5 套配色改成「柔和奶油底 + 明快强调色」，
 * 变量名保持不变，只换颜色值。
 */
(() => {
  'use strict';

  const THEME_KEY = 'sprite-theme';

  /* 面板的颜色变量（不含字体/尺寸/动画，那些不随主题变） */
  const PANEL_THEMES = [
    { // 奶黄包：暖奶油 + 珊瑚橙
      '--bg': '#fff3e0', '--card': '#fffdf8', '--card-hover': '#ffffff', '--card-sunken': '#ffe6c2',
      '--line': 'rgba(51,43,35,.10)', '--line-strong': 'rgba(51,43,35,.20)',
      '--text': '#332b23', '--text-dim': '#8b7e6d', '--text-faint': '#b0a493',
      '--accent': '#ff5c3a', '--accent-line': '#ff8a5c', '--accent-soft': 'rgba(255,92,58,.12)',
      '--seal': '#ff5c3a', '--danger': '#e0482e', '--ok': '#2fbf8f',
    },
    { // 蜜桃：蜜桃粉 + 珊瑚红
      '--bg': '#ffece6', '--card': '#fffaf7', '--card-hover': '#ffffff', '--card-sunken': '#ffddd2',
      '--line': 'rgba(160,80,50,.12)', '--line-strong': 'rgba(160,80,50,.22)',
      '--text': '#4a2f28', '--text-dim': '#8a6a5a', '--text-faint': '#b09888',
      '--accent': '#ff6b5e', '--accent-line': '#ff8d82', '--accent-soft': 'rgba(255,107,94,.12)',
      '--seal': '#ff6b5e', '--danger': '#e04838', '--ok': '#2fbf8f',
    },
    { // 薄荷：薄荷绿 + 深绿强调
      '--bg': '#e8f7ef', '--card': '#f7fdf9', '--card-hover': '#ffffff', '--card-sunken': '#d6f0e2',
      '--line': 'rgba(40,120,90,.12)', '--line-strong': 'rgba(40,120,90,.22)',
      '--text': '#2f4a3e', '--text-dim': '#64806f', '--text-faint': '#8aa293',
      '--accent': '#22b37f', '--accent-line': '#45d39a', '--accent-soft': 'rgba(34,179,127,.12)',
      '--seal': '#22b37f', '--danger': '#e0482e', '--ok': '#1a9a6b',
    },
    { // 天空：天蓝 + 蓝强调
      '--bg': '#e8f2fc', '--card': '#f8fbff', '--card-hover': '#ffffff', '--card-sunken': '#d6e8f8',
      '--line': 'rgba(50,110,170,.12)', '--line-strong': 'rgba(50,110,170,.22)',
      '--text': '#2f4052', '--text-dim': '#64788a', '--text-faint': '#8a9aab',
      '--accent': '#3d8bfd', '--accent-line': '#66a5ff', '--accent-soft': 'rgba(61,139,253,.12)',
      '--seal': '#3d8bfd', '--danger': '#e0482e', '--ok': '#2fbf8f',
    },
    { // 薰衣草：薰衣草紫 + 紫强调
      '--bg': '#f3ecfb', '--card': '#fbf9fe', '--card-hover': '#ffffff', '--card-sunken': '#e8dcf6',
      '--line': 'rgba(120,80,190,.12)', '--line-strong': 'rgba(120,80,190,.22)',
      '--text': '#3e3350', '--text-dim': '#6f6486', '--text-faint': '#948aa8',
      '--accent': '#8b5cf6', '--accent-line': '#a57bfa', '--accent-soft': 'rgba(139,92,246,.12)',
      '--seal': '#8b5cf6', '--danger': '#e0482e', '--ok': '#2fbf8f',
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
