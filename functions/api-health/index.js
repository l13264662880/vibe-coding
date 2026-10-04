// HTTP 云函数：/api/health 健康检查
// HTTP 云函数本质是一个标准 Web 服务：用 Node 原生 http 模块起一个服务器，
// 监听 9000 端口（CloudBase 的硬性要求），收到请求就返回一段 JSON。

const http = require('http');

// createServer 创建服务器，回调函数在每次收到请求时执行。
const server = http.createServer((req, res) => {
  // 组装要返回的 JSON：回答「我活着，现在是几点」。
  const body = JSON.stringify({
    status: 'ok',                    // 约定状态字段：ok = 正常
    service: '先做哪件',              // 标识产品
    time: new Date().toISOString(),  // 服务器当前时间（UTC）
  });

  // 设置响应头：200 表示成功，Content-Type 告诉浏览器这是 JSON。
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(body);
});

// 监听 9000 端口，HTTP 云函数强制要求这个端口。
server.listen(9000);
