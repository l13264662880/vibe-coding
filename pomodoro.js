/* pomodoro.js —— 番茄专注计时器（计划书功能模块 4 的核心）

   25 分钟专注 + 5 分钟休息，开始 / 暂停 / 重置。
   每完成一个「专注」阶段，把当天计数 +1（存 localStorage，供以后做专注周报）。

   用「时间戳」计时而不是「每秒递减」：即使页面在后台被节流，
   回到前台剩余时间依然准确。
*/

(() => {
  'use strict';

  const FOCUS = 25 * 60;   // 专注 25 分钟
  const BREAK = 5 * 60;    // 休息 5 分钟
  const COUNT_KEY = 'pomodoro-count';

  const el = {
    time: document.getElementById('pomoTime'),
    phase: document.getElementById('pomoPhase'),
    toggle: document.getElementById('pomoToggle'),
    reset: document.getElementById('pomoReset'),
  };

  let phase = 'focus';   // focus | break
  let running = false;
  let remaining = FOCUS; // 剩余秒数
  let endAt = null;      // 本阶段结束的时间戳（毫秒）
  let timer = null;

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function render() {
    el.time.textContent = fmt(remaining);
    const fresh = remaining === (phase === 'focus' ? FOCUS : BREAK);
    let phaseText;
    if (running) {
      phaseText = phase === 'focus' ? '专注中' : '休息中';
    } else if (fresh) {
      phaseText = phase === 'focus' ? '待开始' : '休息';
    } else {
      phaseText = phase === 'focus' ? '已暂停' : '休息已暂停';
    }
    el.phase.textContent = phaseText;
    el.toggle.textContent = running ? '暂停' : (fresh ? '开始' : '继续');
  }

  /* 一个阶段走完，切到下一阶段（专注→休息→专注），专注完成时记一笔 */
  function switchPhase() {
    if (phase === 'focus') {
      recordFocus();
      phase = 'break';
      remaining = BREAK;
    } else {
      phase = 'focus';
      remaining = FOCUS;
    }
    endAt = Date.now() + remaining * 1000;
  }

  function tick() {
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (remaining <= 0) switchPhase();
    render();
  }

  function start() {
    if (running) return;
    running = true;
    endAt = Date.now() + remaining * 1000;
    timer = setInterval(tick, 250);
    render();
  }

  function pause() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = null;
    render();
  }

  function reset() {
    pause();
    phase = 'focus';
    remaining = FOCUS;
    endAt = null;
    render();
  }

  /* 专注完成 +1，按天记：{ "2026-09-25": 3 } */
  function recordFocus() {
    try {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const today = `${y}-${m}-${day}`; // 本地日期，不用 UTC（凌晨跨天会算错）
      const data = JSON.parse(localStorage.getItem(COUNT_KEY) || '{}');
      data[today] = (data[today] || 0) + 1;
      localStorage.setItem(COUNT_KEY, JSON.stringify(data));
    } catch (err) {
      /* 忽略，计数不影响主流程 */
    }
  }

  el.toggle.addEventListener('click', () => (running ? pause() : start()));
  el.reset.addEventListener('click', reset);

  render();
})();
