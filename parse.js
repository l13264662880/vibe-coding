/* parse.js —— AI 智能任务录入的本地规则解析器

   输入一句话，拆出三样东西：
     text      任务名（去掉时间、时长后剩下的文字）
     due       截止日期 YYYY-MM-DD（没识别到就是 null）
     estimate  预估时长，单位分钟（没识别到就是 null）

   这是「本地规则兜底」那一层：不联网、不依赖大模型，
   双击 index.html 打开就能用。大模型 API 升级是后续的可选增强。

   设计原则：
   - 纯函数，不碰 DOM，浏览器和 Node 都能跑；
   - 解析不出就原样退回，绝不把用户输入改坏；
   - 「今天」由调用方传入（默认 new Date()），方便测试固定基准日。
*/

(() => {
  'use strict';

  /* 中文星期 → JS getDay() 的 0~6（日=0，一=1 … 六=6） */
  const WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

  function toYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /* ---------------- 提取预估时长 ----------------
     返回 { minutes, remaining } 或 null。
     只认「明确表示耗时」的表达，避免把「3天后」的「3天」误判成时长。 */
  function extractEstimate(text) {
    const patterns = [
      // 组合前置词 + X 小时：大概需要/大约需要/约需要 等
      { re: /(?:大概需要|大约需要|约需要|大概|大约|约|需要|预计|耗时|花)\s*(\d+(?:\.\d+)?)\s*(?:个)?小时/, min: 60 },
      // 半小时 / 半个钟
      { re: /半\s*个?\s*小时/, fixed: 30 },
      { re: /半\s*个?\s*钟/, fixed: 30 },
      // 裸的「X 小时」
      { re: /(\d+(?:\.\d+)?)\s*(?:个)?小时/, min: 60 },
      // 「X 分钟」
      { re: /(\d+)\s*分钟/, min: 1 },
      // 有前置词的「X 天」：需要/大概/约 X 天（「天后」不算时长）
      { re: /(?:需要|大概|大约|约)\s*(\d+(?:\.\d+)?)\s*天(?!后)/, min: 1440 },
    ];

    for (const p of patterns) {
      const m = text.match(p.re);
      if (!m) continue;
      let minutes;
      if (p.fixed !== undefined) {
        minutes = p.fixed;
      } else {
        minutes = Math.round(parseFloat(m[1]) * p.min);
      }
      const remaining = text.replace(m[0], ' ');
      return { minutes, remaining };
    }
    return null;
  }

  /* ---------------- 提取截止时间 ----------------
     返回 { date, remaining } 或 null。date 是 YYYY-MM-DD。
     相对时间一律以传入的 now 为「今天」换算。 */
  function extractDue(text, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 下周 X（可带「前/之前」尾巴）
    let m = text.match(/下周([一二三四五六日天])(?:前|之前)?/);
    if (m) {
      const target = WEEKDAY[m[1]];
      const cur = today.getDay();
      const diff = (7 - cur + target) % 7 || 7;
      return { date: toYMD(addDays(today, diff)), remaining: text.replace(m[0], ' ') };
    }

    // 本周 X / 这周 X / 周 X / 星期 X（可带「前/之前」尾巴）
    m = text.match(/(?:本周|这周|星期|周)([一二三四五六日天])(?:前|之前)?/);
    if (m) {
      const target = WEEKDAY[m[1]];
      const cur = today.getDay();
      let diff = target - cur;
      if (diff < 0) diff += 7; // 已经过去的，算下周；正好今天(diff=0)就是今天
      return { date: toYMD(addDays(today, diff)), remaining: text.replace(m[0], ' ') };
    }

    // 后天
    m = text.match(/后天(?:前|之前)?/);
    if (m) return { date: toYMD(addDays(today, 2)), remaining: text.replace(m[0], ' ') };

    // 明天 / 明日
    m = text.match(/(?:明天|明日)(?:前|之前)?/);
    if (m) return { date: toYMD(addDays(today, 1)), remaining: text.replace(m[0], ' ') };

    // 今天 / 今晚 / 今日
    m = text.match(/(?:今晚|今天|今日)(?:前|之前)?/);
    if (m) return { date: toYMD(today), remaining: text.replace(m[0], ' ') };

    // N 天后
    m = text.match(/(\d+)\s*天后/);
    if (m) {
      return { date: toYMD(addDays(today, parseInt(m[1], 10))), remaining: text.replace(m[0], ' ') };
    }

    // X月X日（可带「号」，可带「前/之前」尾巴）
    m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?(?:前|之前)?/);
    if (m) {
      const mo = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
        const d = new Date(today.getFullYear(), mo - 1, dd);
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        return { date: toYMD(d), remaining: text.replace(m[0], ' ') };
      }
    }

    // X号 / X日（本月的几号，可带「前/之前」尾巴）
    m = text.match(/(\d{1,2})\s*[日号](?:前|之前)?/);
    if (m) {
      const dd = parseInt(m[1], 10);
      if (dd >= 1 && dd <= 31) {
        const d = new Date(today.getFullYear(), today.getMonth(), dd);
        if (d < today) d.setMonth(d.getMonth() + 1);
        return { date: toYMD(d), remaining: text.replace(m[0], ' ') };
      }
    }

    return null;
  }

  /* ---------------- 清理任务名 ----------------
     去掉解析后残留的标点、开头的连接词，把多余空格压成一个。
     只做「去杂」，不删有实义的动词，避免误伤。 */
  function cleanText(text) {
    let t = text
      .replace(/[，。、,.;；:：！？!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 去掉开头残留的时间连接词尾巴（「前」「之前」在去掉时间后可能单独剩下来）
    t = t.replace(/^(?:前|之前|之前完成|内|之内)\s*/, '');
    // 去掉开头残留的介词/祈使词
    t = t.replace(/^(?:要|去|把|记得|别忘了|准备|打算)\s*/, '');

    return t.trim();
  }

  /* ---------------- 主入口 ---------------- */
  function parseTask(input, now) {
    const raw = (input || '').trim();
    if (!raw) return { text: '', due: null, estimate: null };

    const base = now instanceof Date ? now : new Date();

    let text = raw;

    const est = extractEstimate(text);
    if (est) text = est.remaining;

    const due = extractDue(text, base);
    if (due) text = due.remaining;

    text = cleanText(text);

    // 万一全被解析掉了，退回原始输入，别让任务名空着
    if (!text) text = raw;

    return {
      text,
      due: due ? due.date : null,
      estimate: est ? est.minutes : null,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTask };
  } else {
    window.parseTask = parseTask;
  }
})();
