// Day 23+ 临时验证：reorder 交换前两条再还原
const B = 'https://yuanjian-d5gdhcntg91022662.service.tcloudbase.com/api/tasks';
const TK = '81ad6640e81a92f614190806e95eac7938463655a73b33e7';
const H = { 'X-App-Token': TK };

(async () => {
  const p = await (await fetch(B, { headers: H })).json();
  const ids = p.data.map((t) => t.id);
  console.log('当前顺序:', ids.join(','));

  const o = ids.slice();
  [o[0], o[1]] = [o[1], o[0]];
  let r = await fetch(B + '/reorder', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: o }),
  });
  console.log('交换请求:', r.status, JSON.stringify(await r.json()));

  const p2 = await (await fetch(B, { headers: H })).json();
  console.log('交换后顺序:', p2.data.map((t) => t.id).join(','));

  r = await fetch(B + '/reorder', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: ids }),
  });
  console.log('还原请求:', r.status, JSON.stringify(await r.json()));

  const p3 = await (await fetch(B, { headers: H })).json();
  console.log('还原后顺序:', p3.data.map((t) => t.id).join(','));

  // 错误分支：不完整的 order
  r = await fetch(B + '/reorder', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: [1] }),
  });
  console.log('错误分支:', r.status, JSON.stringify(await r.json()));
})();
