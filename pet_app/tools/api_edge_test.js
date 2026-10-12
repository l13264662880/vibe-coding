// Day 24 补充测试用例：线上 API 刁钻输入（空值/超长/边界/并发）
// 运行：node tools/api_edge_test.js
const BASE = 'https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com';
const TOKEN = '81ad6640e81a92f614190806e95eac7938463655a73b33e7';
const H = { 'Content-Type': 'application/json', 'X-App-Token': TOKEN };

const created = [];
const fails = [];
const info = (id, name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' | ' + detail : ''}`);
  if (!ok) fails.push(id);
};

async function post(body) {
  const r = await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

(async () => {
  // A1 纯不可见标题（无可见前缀）：全角/制表/零宽/NBSP 都应被拒
  const invisibles = [
    ['全角空格', '\u3000\u3000'],
    ['制表+换行', '\t\n\r'],
    ['零宽空格', '\u200B\u200B'],
    ['NBSP', '\u00A0\u00A0'],
  ];
  for (const [name, text] of invisibles) {
    const { status, json } = await post({ text });
    info('A1', `纯不可见标题[${name}]`, status === 400,
         `status=${status} ${json.error || ''}`);
  }

  // A2 精确边界：正好 500 字合法 / 501 字拒绝（不带任何前缀）
  const c500 = '长'.repeat(500);
  const c501 = '长'.repeat(501);
  let r = await post({ text: c500 });
  info('A2', '正好 500 字标题', r.status === 200 && r.json.ok === true, `status=${r.status}`);
  if (r.json.data) created.push(r.json.data.id);
  r = await post({ text: c501 });
  info('A2', '501 字标题', r.status === 400, `status=${r.status} ${r.json.error}`);

  // A3 空字节与控制字符：应 400 拒绝（修复前是 500）
  r = await post({ text: 'day24_空字节\u0000标题' });
  info('A3', '标题含 \\u0000', r.status === 400,
       `status=${r.status} ${r.json.error || JSON.stringify(r.json).slice(0, 60)}`);

  // A4 XSS 存储检查（服务端是否原样存 HTML）
  r = await post({ text: 'day24_<img src=x onerror=alert(1)>' });
  info('A4', 'XSS 标题创建', r.status === 200, `status=${r.status}`);
  if (r.json.data) created.push(r.json.data.id);
  const list = await (await fetch(`${BASE}/api/tasks`, { headers: H })).json();
  const hit = (list.data || []).find(t => t.id === r.json.data.id);
  info('A4', 'XSS 标题原样存储（前端需 textContent 渲染）',
       !!hit && hit.text.includes('<img'), hit ? `存储=${hit.text.slice(0, 40)}` : '未找到');

  // A5 reorder 刁钻：重复 id / 不存在 id / 非数组 / 空数组
  const reorderCases = [
    ['重复 id', [created[0] || 1, created[0] || 1, created[1] || 2]],
    ['不存在 id', [99999999]],
    ['空数组', []],
    ['字符串', 'not-array'],
    ['null 混入', [created[0] || 1, null, 3]],
  ];
  for (const [name, order] of reorderCases) {
    const rr = await fetch(`${BASE}/api/tasks/reorder`, {
      method: 'POST', headers: H, body: JSON.stringify({ order }),
    });
    const j = await rr.json();
    info('A5', `reorder[${name}]`, rr.status < 500, `status=${rr.status} ${JSON.stringify(j).slice(0, 80)}`);
  }

  // A6 并发：10 个 POST 同时打（position 唯一性）
  const conc = await Promise.all(
    Array.from({ length: 10 }, (_, i) => post({ text: `day24_并发${i}` }))
  );
  const okCount = conc.filter(c => c.json.ok).length;
  const ids = conc.filter(c => c.json.data).map(c => c.json.data.id);
  ids.forEach(id => created.push(id));
  const positions = (await (await fetch(`${BASE}/api/tasks`, { headers: H })).json())
    .data.filter(t => t.text.startsWith('day24_并发')).map(t => t.position);
  const dupPos = positions.length !== new Set(positions).size;
  info('A6', '10 并发 POST', okCount === 10 && !dupPos,
       `ok=${okCount} position重复=${dupPos} ${JSON.stringify(positions)}`);

  // ---------- 清理 ----------
  for (const id of created) {
    await fetch(`${BASE}/api/tasks?id=${id}`, { method: 'DELETE', headers: H });
  }
  const left = (await (await fetch(`${BASE}/api/tasks`, { headers: H })).json())
    .data.filter(t => (t.text || '').startsWith('day24_'));
  info('A7', '测试数据清理', left.length === 0, `残留 ${left.length} 条`);

  console.log(`\n===== 汇总：${fails.length} 个 FAIL =====`);
  fails.forEach(f => console.log('FAIL', f));
})();
