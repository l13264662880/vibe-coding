/* mood.js —— 情绪记录与轻量心理关怀（计划书功能模块 5）

   1. 每日心情打卡：高效 / 平静 / 低落 / 焦虑，按天存 localStorage
   2. 心情联动：选完心情后给一句对应的关怀语（低落给鼓励，焦虑让放慢）
   3. 焦虑缓解呼吸引导：4 秒吸气 → 4 秒屏息 → 4 秒呼气，循环；点按钮开关

   呼吸用的是 setTimeout 链（不是每秒 tick），每个阶段完整走完 4 秒再切下一阶段。
*/

(() => {
  'use strict';

  const MOOD_KEY = 'mood';
  const INHALE = 4000;   // 吸气 4 秒
  const HOLD = 4000;     // 屏息 4 秒
  const EXHALE = 4000;   // 呼气 4 秒

  const el = {
    hint: document.getElementById('moodHint'),
    options: document.getElementById('moodOptions'),
    breathe: document.getElementById('breathe'),
    breatheToggle: document.getElementById('breatheToggle'),
    breatheText: document.getElementById('breatheText'),
    breatheCircle: document.getElementById('breatheCircle'),
  };

  const MOOD_TEXT = {
    '高效': '状态不错，可以挑战难度高一点的任务。',
    '平静': '按部就班，做好眼前这一件。',
    '低落': '先深呼吸一下，只做眼前这一件小事就好。',
    '焦虑': '别急，一件一件来，先迈出最小的一步。',
  };

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`; // 本地日期，不用 UTC（凌晨跨天会算错）
  }

  function recordMood(mood) {
    try {
      const data = JSON.parse(localStorage.getItem(MOOD_KEY) || '{}');
      data[todayKey()] = mood;
      localStorage.setItem(MOOD_KEY, JSON.stringify(data));
    } catch (err) { /* 忽略 */ }
  }

  function loadMood() {
    try {
      const data = JSON.parse(localStorage.getItem(MOOD_KEY) || '{}');
      return data[todayKey()] || null;
    } catch (err) { return null; }
  }

  function setMood(mood) {
    el.hint.textContent = MOOD_TEXT[mood] || '今天状态如何？点一个记下来。';
    el.options.querySelectorAll('.mood-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mood === mood);
    });
  }

  el.options.addEventListener('click', (event) => {
    const btn = event.target.closest('.mood-btn');
    if (!btn) return;
    recordMood(btn.dataset.mood);
    setMood(btn.dataset.mood);
  });

  // 初始化：今天已经打过卡就回显
  const saved = loadMood();
  if (saved) setMood(saved);

  /* ---------------- 呼吸引导 ---------------- */

  let breatheRunning = false;
  let breatheTimer = null;

  function startBreathe() {
    breatheRunning = true;
    el.breathe.hidden = false;
    el.breatheToggle.textContent = '停止呼吸引导';
    inhale();
  }

  function stopBreathe() {
    breatheRunning = false;
    clearTimeout(breatheTimer);
    el.breathe.hidden = true;
    el.breatheToggle.textContent = '焦虑缓解 · 3 分钟呼吸';
    el.breatheText.textContent = '吸气…';
    el.breatheCircle.className = 'breathe-circle';
  }

  function inhale() {
    el.breatheText.textContent = '吸气…';
    el.breatheCircle.className = 'breathe-circle is-inhale';
    breatheTimer = setTimeout(hold, INHALE);
  }
  function hold() {
    if (!breatheRunning) return;
    el.breatheText.textContent = '屏息…';
    el.breatheCircle.className = 'breathe-circle is-hold';
    breatheTimer = setTimeout(exhale, HOLD);
  }
  function exhale() {
    if (!breatheRunning) return;
    el.breatheText.textContent = '呼气…';
    el.breatheCircle.className = 'breathe-circle is-exhale';
    breatheTimer = setTimeout(inhale, EXHALE);
  }

  el.breatheToggle.addEventListener('click', () => {
    breatheRunning ? stopBreathe() : startBreathe();
  });
})();
