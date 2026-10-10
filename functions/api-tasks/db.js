// db.js —— 数据访问层（Day 19 从 index.js 拆出）
//
// 只负责「怎么读写数据库」：所有对 CloudBase PostgREST 网关的
// fetch 都集中在这里。上层（index.js）只调用 query / insert，
// 不直接碰 fetch、网关地址和 API Key。
//
// 「查数据库」的代码 Day 19 从 index.js 移到了这里——
// 拆分目的：以后换数据库/换网关只改这个文件，HTTP 逻辑一行不动。
//
// 网关鉴权：API Key 从环境变量 CLOUDBASE_APIKEY 读（由 cloudbaserc.json
// 从 .env 注入），明文只在 .env，不进代码、不进 Git。

const ENV_ID = 'yuanjian-d5gdhcntg91022662';
const GATEWAY = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const API_KEY = process.env.CLOUDBASE_APIKEY || '';

// 返回给前端的字段（对齐 Day 16 tasks 表，不含 deleted_at/created_at/updated_at）
const COLUMNS = 'id,text,position,done,due,estimate';

// 查询（GET），path 形如 `/tasks?select=...&...`
async function query(path) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`网关读取错误 ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// 插入（POST），返回插入的行（数组）
async function insert(table, body, select) {
  const url = `${GATEWAY}/${table}` + (select ? `?select=${select}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation', // 让 PostgREST 返回插入后的行（含自增 id）
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`网关写入错误 ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

// 更新（PATCH）：按 id 更新字段，返回更新后的行（数组；空数组 = 没这个 id）
// Day 22 新增。path 用 PostgREST 的过滤语法 `?id=eq.<id>`，
// `Prefer: return=representation` 让网关返回更新后的行。
// 软删除（Day 22 余力加练）也走这里：update('tasks', id, { deleted_at: ... })。
async function update(table, id, body, select) {
  const url =
    `${GATEWAY}/${table}?id=eq.${encodeURIComponent(id)}` + (select ? `&select=${select}` : '');
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`网关更新错误 ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

module.exports = { query, insert, update, COLUMNS };
