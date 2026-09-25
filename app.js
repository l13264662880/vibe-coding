/* app.js —— 页面行为（Day 7：第一版 MVP）

   覆盖 PRD 第 5 节全部 10 条验收标准：
     1  输入文字按回车，任务出现在列表末尾
     2  拖拽任意任务到新位置，松手后顺序立即更新（位置即优先级）
     3  每个位置只有一条任务，第 1 位全局唯一
     4  有且只有一个「第一件事」高亮；空列表时显示引导文案
     5  删除后其余任务自动补位，相对顺序不变
     6  删除后可撤销，任务回到删除前的位置；进行新操作或刷新后撤销失效
     7  编辑任务文字，保存后位置不变
     8  标记完成：划线 + 沉到列表底部 + 不再出现在「第一件事」
     9  刷新或关掉浏览器再打开，任务和顺序都还在（localStorage）
    10  只做 PRD 第 3 节的 8 项功能，界面上找不到范围外功能的入口

   数据流（对应 TECH_DESIGN.md 第 5 节）：
     用户操作 → 改 tasks 数组 → 存进 localStorage → 重新渲染页面
*/

(() => {
  'use strict';

  /* localStorage 里的键名。任务内容、顺序、完成状态都存在这一个键下。 */
  const STORAGE_KEY = 'todo-queue-v1';

  const el = {
    focusText: document.getElementById('focusText'),
    form: document.getElementById('addForm'),
    input: document.getElementById('taskInput'),
    list: document.getElementById('taskList'),
    emptyHint: document.getElementById('emptyHint'),
    undoBar: document.getElementById('undoBar'),
    undoText: document.getElementById('undoText'),
    undoBtn: document.getElementById('undoBtn'),
    parseHint: document.getElementById('parseHint'),
    sortBtn: document.getElementById('sortBtn'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    retryBtn: document.getElementById('retryBtn'),
  };

  /* 任务队列。数组的顺序就是位置，位置就是优先级。 */
  let tasks = [];

  /* 正在编辑的任务 id（同一时刻只有一条处于编辑态）。 */
  let editingId = null;

  /* 刚删掉的那条，用于撤销：{ task, index }。
     只活在内存里 —— 刷新页面就没了，正好满足验收标准 6「刷新后撤销入口不再出现」。 */
  let lastDeleted = null;

  /* 只用来触发一次性的动画，渲染完就清掉，不参与任何数据逻辑。
     宁静版只留三个「交代因果」的功能性过渡：新增淡入、落位提示、删除退场。
     表演型的（首屏依次浮入、焦点转移脉冲）已全部删除。 */
  let justAddedId = null;   // 刚添加的任务 → 淡入
  let justDroppedId = null; // 刚拖完的任务 → 落点提示（只闪一层暖色，不位移）

  /* ---------------- 存取 ---------------- */

  /* 同步读 localStorage，返回解析后的任务数组（不改全局 tasks）。
     读坏了就返回空数组 —— 页面不能因此打不开。 */
  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data)
        ? data
            .filter((t) => t && typeof t.text === 'string')
            .map((t) => ({
              id: t.id || makeId(),
              text: t.text,
              done: !!t.done,
              due: t.due || null,        // 旧数据没有这两个字段，读进来补成 null
              estimate: t.estimate || null,
            }))
        : [];
    } catch (err) {
      console.warn('读取本地任务失败，已按空列表处理：', err);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.warn('保存任务失败：', err);
    }
  }

  /* ---------------- 数据源 + 四种页面状态（Day 8） ----------------
     把「数据从哪来」抽成一层：今天走 mock（mock-data.js），Day 23 换成 fetch 真实 API。
     四种状态：加载中 loading / 有数据 content（就是列表）/ 空 empty / 出错 error。 */

  const DATA_SOURCE = 'mock'; // Day 23 改成 'api'

  function loadFromSource() {
    if (DATA_SOURCE === 'mock') {
      return window.MockData.loadTasks(); // Promise，行为等同 fetch
    }
    // Day 23 换成：return fetch('/api/tasks').then(r => r.json())
    return Promise.resolve(readLocal());
  }

  /* 只负责 loading / error 两个容器的显隐；空和有数据由 render() 说了算 */
  function showState(state) {
    el.loadingState.hidden = state !== 'loading';
    el.errorState.hidden = state !== 'error';
    if (state === 'error') {
      // 出错时列表和空提示都清掉，只留下错误框
      el.list.innerHTML = '';
      el.emptyHint.hidden = true;
    }
  }

  async function bootstrap() {
    const existing = readLocal();

    // localStorage 里已经有数据（老用户 / 之前加载过）：直接渲染，不再走 mock
    if (existing.length > 0) {
      tasks = existing;
      showState('ready');
      render();
      return;
    }

    // 首次打开（localStorage 为空）：走数据源，演示 加载中 → 有数据/空/出错
    showState('loading');
    try {
      const initial = await loadFromSource();
      tasks = initial;
      save();          // 假数据「种子」进 localStorage，之后增删改就在本地正常进行
      showState('ready');
      render();
    } catch (err) {
      console.warn('加载任务失败：', err);
      showState('error');
    }
  }

  function makeId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 算「第一件事」 ---------------- */

  /* 第一件事 = 队列里第一条未完成的任务。同一时刻最多只有一个。 */
  function firstTask() {
    return tasks.find((t) => !t.done) || null;
  }

  /* ---------------- 画页面 ---------------- */

  function render() {
    // 未完成的排在前面，已完成的沉到底部；同组内保持原有相对顺序
    const ordered = [...tasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));

    el.list.innerHTML = '';
    ordered.forEach((task, index) => {
      el.list.appendChild(buildRow(task, index));
    });

    // 空列表时显示引导文案，不空白、不报错（验收标准 4）
    el.emptyHint.hidden = ordered.length > 0;

    // 编辑态：重新渲染后把焦点放回输入框，光标停在末尾
    if (editingId) {
      const box = el.list.querySelector('.task-edit-input');
      if (box) {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }
    }

    renderFocus();

    justAddedId = null;   // 一次性动画标记，用完即清
    justDroppedId = null;
  }

  function renderFocus() {
    const top = firstTask();
    el.focusText.textContent = top ? top.text : '先加一件事';
    el.focusText.classList.toggle('is-empty', !top);
    // 宁静版：焦点换人不再播脉冲动画。
    // 大字换人和序号圆点变陶土色，本身已经够说明「现在是这一件」了。
  }

  /* ---------------- AI 录入的显示格式化 ---------------- */

  /* 截止日期 YYYY-MM-DD → 友好中文：今天 / 明天 / 后天 / 周X / X月X日 */
  function formatDue(dateStr) {
    if (!dateStr) return '';
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateStr;
    const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((due - t0) / 86400000);
    const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff > 2 && diff < 7) return WD[due.getDay()];
    return `${Number(m[2])}月${Number(m[3])}日`;
  }

  /* 分钟数 → 友好中文：X 分钟 / X 小时 / X 小时 Y 分钟 */
  function formatEstimate(minutes) {
    if (minutes == null) return '';
    if (minutes < 60) return `${minutes} 分钟`;
    const h = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (rem === 0) return `${h} 小时`;
    return `${h} 小时 ${rem} 分钟`;
  }

  /* 任务行下方的小字标签：截止 / 时长。都没有就返回 null，不占地方。 */
  function buildMeta(task) {
    const parts = [];
    const due = formatDue(task.due);
    const est = formatEstimate(task.estimate);
    if (due) parts.push(`截止 ${due}`);
    if (est) parts.push(`约 ${est}`);
    if (!parts.length) return null;
    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = parts.join(' · ');
    return meta;
  }

  function buildRow(task, index) {
    const editing = task.id === editingId;

    const li = document.createElement('li');
    li.className = 'task';
    if (!task.done && index === 0) li.classList.add('is-first'); // 第 1 位，就是「第一件事」
    if (task.done) li.classList.add('is-done');
    if (editing) li.classList.add('is-editing');
    li.draggable = !task.done && !editing; // 已完成 / 编辑中的都不给拖
    li.dataset.id = task.id;
    if (task.id === justAddedId) li.classList.add('is-new');         // 新增淡入
    if (task.id === justDroppedId) li.classList.add('just-dropped'); // 落点提示（闪一层暖色）

    const no = document.createElement('span');
    no.className = 'task-index';
    no.textContent = cnNum(index + 1); // 汉字序号：一、二、三……

    const text = document.createElement('span');
    text.className = 'task-text';

    const actions = document.createElement('span');
    actions.className = 'task-actions';

    if (editing) {
      text.appendChild(buildEditInput(task));
      actions.append(
        iconButton('task-btn js-save', '✓', '保存'),
        iconButton('task-btn js-cancel', '✕', '取消')
      );
    } else {
      text.textContent = task.text;
      const meta = buildMeta(task);
      if (meta) text.appendChild(meta); // AI 录入识别的「截止 / 时长」小标签
      actions.append(
        iconButton('task-btn js-done', task.done ? '↺' : '✓', task.done ? '撤销完成' : '标记完成'),
        iconButton('task-btn js-edit', '✎', '编辑文字'),
        iconButton('task-btn js-del', '✕', '删除')
      );
    }

    li.append(no, text, actions);
    return li;
  }

  /* 编辑态的输入框：回车保存，Esc 取消。
     故意不用 blur 自动保存 —— 那样点行上其它按钮时第一次点击会被吃掉。 */
  function buildEditInput(task) {
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'task-edit-input';
    box.value = task.text;
    box.spellcheck = false;

    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitEdit(task.id, box.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    });

    return box;
  }

  function iconButton(className, label, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    return btn;
  }

  function shorten(text, max = 12) {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  /* 汉字序号：古风版把「1、2、3」换成「一、二、三」。
     位置就是优先级 —— 用汉字读起来更像古籍的条目编号，语义反而更直白。
     超过十位退回阿拉伯数字，免得出现「一十一」这种别扭写法。 */
  const CN_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function cnNum(n) {
    return n >= 1 && n <= 10 ? CN_DIGITS[n - 1] : String(n);
  }

  /* ---------------- 撤销条（验收标准 6） ---------------- */

  /* 撤销只对「紧挨着的那一次删除」有效。任何新操作都会把它作废。 */
  function clearUndo() {
    lastDeleted = null;
    el.undoBar.hidden = true;
  }

  /* ---------------- 操作 ---------------- */

  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return; // 空输入不添乱
    clearUndo();

    // AI 录入：先解析，拆出任务名 / 截止 / 时长（本地规则，见 parse.js）
    const parsed = parseTask(trimmed);
    const task = {
      id: makeId(),
      text: parsed.text,
      done: false,
      due: parsed.due,
      estimate: parsed.estimate,
    };

    tasks.push(task);
    justAddedId = task.id; // 让它在渲染时滑入
    save();
    render();
  }

  /* 智能排序（预排序）：未完成任务按截止时间从近到远排，
     没截止时间的排在后面（保持相对顺序），已完成永远沉底。
     只给起点，用户仍可拖拽改 —— 不替用户拍板。 */
  function sortByDue() {
    clearUndo();
    const done = tasks.filter((t) => t.done);
    const open = tasks.filter((t) => !t.done);
    const withDue = open
      .filter((t) => t.due)
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const withoutDue = open.filter((t) => !t.due);
    tasks = [...withDue, ...withoutDue, ...done];
    save();
    render();
  }

  /* 标记完成 / 撤销完成。完成后划线、沉底、退出「第一件事」（验收标准 8）。 */
  function toggleDone(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    clearUndo();
    task.done = !task.done;
    save();
    render();
  }

  /* 删除：其余任务自动补位（数组 splice 天然做到，相对顺序不变，验收标准 5）。 */
  function deleteTask(id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) return;

    clearUndo(); // 上一次的撤销先作废
    if (editingId === id) editingId = null;

    const [removed] = tasks.splice(index, 1);
    lastDeleted = { task: removed, index }; // 记住它原来待在第几位

    save();

    // 数据已经删了，但先让这一行把退场动画播完再重画，免得列表「啪」地跳一下
    const row = el.list.querySelector('.task[data-id="' + id + '"]');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      render();
      el.undoText.textContent = '已删除「' + shorten(removed.text) + '」';
      el.undoBar.hidden = false;
    };

    if (row) {
      row.classList.add('is-leaving');
      row.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 400); // 兜底：万一 animationend 没来（比如系统关了动效）
    } else {
      finish();
    }
  }

  /* 撤销删除：把任务插回它原来的位置。 */
  function undoDelete() {
    if (!lastDeleted) return;
    const { task, index } = lastDeleted;
    tasks.splice(Math.min(index, tasks.length), 0, task);
    clearUndo();
    save();
    render();
  }

  function startEdit(id) {
    clearUndo();
    editingId = id;
    render();
  }

  /* 保存编辑：只换文字，不动位置（验收标准 7）。 */
  function commitEdit(id, value) {
    const task = tasks.find((t) => t.id === id);
    editingId = null;

    const trimmed = value.trim();
    if (task && trimmed) {
      task.text = trimmed; // 空文字不覆盖 —— 想清走一条任务请用删除
      save();
    }
    render();
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  /* ---------------- 事件绑定 ---------------- */

  /* 输入时实时预览 AI 解析结果，让用户知道「会记成什么」，不满意可改 */
  el.input.addEventListener('input', () => {
    const raw = el.input.value.trim();
    if (!raw) {
      el.parseHint.hidden = true;
      return;
    }
    const parsed = parseTask(raw);
    const due = formatDue(parsed.due);
    const est = formatEstimate(parsed.estimate);
    const bits = [];
    if (parsed.due) bits.push(`截止 ${due}`);
    if (parsed.estimate) bits.push(`约 ${est}`);

    const nameChanged = parsed.text !== raw && parsed.text !== '';
    if (!bits.length && !nameChanged) {
      el.parseHint.hidden = true;
      return;
    }

    const namePart = nameChanged ? `将记为「${parsed.text}」` : '';
    el.parseHint.hidden = false;
    el.parseHint.textContent = [namePart, bits.join(' · ')].filter(Boolean).join('　');
  });

  el.form.addEventListener('submit', (event) => {
    event.preventDefault(); // 阻止表单提交导致页面刷新
    addTask(el.input.value);
    el.input.value = '';
    el.input.focus();
  });

  el.undoBtn.addEventListener('click', undoDelete);
  el.sortBtn.addEventListener('click', sortByDue);
  el.retryBtn.addEventListener('click', bootstrap); // 出错后点「重新加载」

  /* 任务行上的按钮统一用事件委托处理（行是动态生成的） */
  el.list.addEventListener('click', (event) => {
    const row = event.target.closest('.task');
    if (!row) return;
    const id = row.dataset.id;

    // 编辑态的两个按钮
    if (event.target.closest('.js-save')) {
      const box = row.querySelector('.task-edit-input');
      commitEdit(id, box ? box.value : '');
      return;
    }
    if (event.target.closest('.js-cancel')) {
      cancelEdit();
      return;
    }

    // 编辑到一半去点别的任务 → 先退出编辑态（这次的改动不保存）
    const wasEditing = editingId;
    if (editingId && editingId !== id) editingId = null;

    if (event.target.closest('.js-done')) {
      toggleDone(id);
      return;
    }
    if (event.target.closest('.js-del')) {
      deleteTask(id);
      return;
    }
    if (event.target.closest('.js-edit')) {
      startEdit(id);
      return;
    }

    // 只是点了一下空白处，且刚退出了编辑态 → 重画，把输入框换回文字
    if (wasEditing && !editingId) render();
  });

  /* ---------------- 拖拽排序（验收标准 2：位置即优先级） ----------------
     用的是浏览器自带的 Drag & Drop API，不需要任何第三方库（TECH_DESIGN 第 3.3 节）。
     拖动只改「未完成」那一段的先后；已完成的任务永远沉底，拖不动。 */

  let dragId = null;     // 正在被拖的任务 id
  let dropTarget = null; // 落点：{ id, after } —— 插到哪条任务的前面还是后面

  el.list.addEventListener('dragstart', (event) => {
    const li = event.target.closest('.task');
    if (!li || li.classList.contains('is-done')) return; // 已完成的不给拖
    dragId = li.dataset.id;
    li.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId); // Firefox 必须先塞数据才肯启动拖拽
  });

  el.list.addEventListener('dragover', (event) => {
    if (!dragId) return;
    event.preventDefault(); // 整个列表区域都接受放下

    const li = event.target.closest('.task');
    clearDropMarks();

    if (li && li.dataset.id === dragId) return; // 拖到自己身上，不算落点

    if (li && !li.classList.contains('is-done')) {
      // 鼠标在目标行的上半 → 插到它前面；下半 → 插到它后面
      const rect = li.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      li.classList.add(after ? 'drop-after' : 'drop-before');
      dropTarget = { id: li.dataset.id, after };
      return;
    }

    // 落在已完成区、或列表的空白处 → 当作「放到未完成区的末尾」
    const last = lastOpenRow();
    if (last && last.dataset.id !== dragId) {
      last.classList.add('drop-after');
      dropTarget = { id: last.dataset.id, after: true };
    }
  });

  el.list.addEventListener('drop', (event) => {
    event.preventDefault();
    if (dragId && dropTarget) {
      clearUndo(); // 拖拽也是新操作，撤销作废
      applyDrop(dragId, dropTarget);
      justDroppedId = dragId; // 让落位的那一行弹一下
      save();   // 改完数据立刻存，刷新也不丢
      render(); // 重画：第 1 位变了，「第一件事」跟着更新
    }
    resetDrag();
  });

  el.list.addEventListener('dragend', resetDrag);

  function clearDropMarks() {
    dropTarget = null;
    el.list.querySelectorAll('.drop-before, .drop-after').forEach((n) => {
      n.classList.remove('drop-before', 'drop-after');
    });
  }

  function lastOpenRow() {
    const rows = el.list.querySelectorAll('.task:not(.is-done)');
    return rows.length ? rows[rows.length - 1] : null;
  }

  function resetDrag() {
    dragId = null;
    clearDropMarks();
    el.list.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
  }

  /* 把被拖的任务挪到目标位置。只在「未完成」这一段里动，已完成的永远沉底。 */
  function applyDrop(id, target) {
    const from = tasks.findIndex((t) => t.id === id);
    if (from === -1) return;

    const [moving] = tasks.splice(from, 1); // 先把它从原位置拿出来

    let to = tasks.findIndex((t) => t.id === target.id);
    if (to === -1) to = tasks.length;
    if (target.after) to += 1;              // 插到目标后面

    // 不许越进「已完成区」：第一条已完成任务之前，就是未完成区的地板
    const firstDone = tasks.findIndex((t) => t.done);
    if (firstDone !== -1 && to > firstDone) to = firstDone;

    tasks.splice(to, 0, moving);            // 落到新位置
  }

  /* ---------------- 启动 ---------------- */

  bootstrap();
})();
