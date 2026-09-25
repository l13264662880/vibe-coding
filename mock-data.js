/* mock-data.js —— 本地假数据源（Day 8）

   作用：在「接真实 API（第 3 周）」之前，先把「数据从哪来」抽象成一层。
   今天这里返回写死的假数据；Day 23 换成 fetch('/api/tasks') 即可，页面其余部分不用动。

   四种页面状态怎么演示：
     改下面 SCENARIO 的值，就能看到 加载中 / 有数据 / 空 / 出错 四种状态。
       'content'  加载成功，返回 4 条示例任务（默认）
       'empty'    加载成功，但一条都没有 → 空状态
       'error'    加载失败 → 出错状态（带「重新加载」按钮）

   改完后刷新页面即可看到对应状态。要回到「有数据」，把值改回 'content' 再刷新。
*/

(function () {
  'use strict';

  // 演示场景开关：'content' | 'empty' | 'error'
  const SCENARIO = 'content';

  // 模拟网络延迟（毫秒）。给「加载中」那一帧留出时间，否则一闪而过看不见
  const FAKE_DELAY = 600;

  // 示例任务：形态和 app.js 里真实任务完全一致（id/text/done/due/estimate）。
  // Day 23 换成 API 返回的 JSON，字段对得上，页面不会报错。
  const MOCK_TASKS = [
    { id: 'mock-1', text: '复习高数第三章', done: false, due: '2026-09-25', estimate: 90 },
    { id: 'mock-2', text: '写完 Day 8 的 mock 数据', done: false, due: '2026-09-26', estimate: 60 },
    { id: 'mock-3', text: '给妈妈打个电话', done: false, due: null, estimate: 15 },
    { id: 'mock-4', text: '整理本周读书笔记', done: true, due: '2026-09-24', estimate: 45 },
  ];

  /* 模拟一次异步加载：返回 Promise，跟真实 fetch 的行为一致。
     app.js 只管 await，不关心数据是假的还是网络来的。 */
  function loadTasks() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (SCENARIO === 'error') {
          reject(new Error('模拟加载失败'));
        } else if (SCENARIO === 'empty') {
          resolve([]);
        } else {
          resolve(MOCK_TASKS);
        }
      }, FAKE_DELAY);
    });
  }

  // 挂到全局，app.js 通过 window.MockData.loadTasks() 调用
  window.MockData = { loadTasks };
})();
