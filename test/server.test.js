'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness() {
  let handler;
  let upstream;
  const filename = path.join(__dirname, '..', 'server.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: path.dirname(filename), process, URL, console,
    require(name) {
      if (name === 'http') return {
        createServer(callback) { handler = callback; return { listen() {} }; }
      };
      if (name === 'https') return {
        get(url, options, callback) {
          upstream = new EventEmitter();
          upstream.setEncoding = () => {};
          upstream.statusCode = 200;
          callback(upstream);
          const request = new EventEmitter();
          request.setTimeout = () => request;
          return request;
        }
      };
      return require(name);
    }
  }, { filename });
  return async (body, status = 200) => {
    let result;
    const done = handler({ url: '/api/search?q=package' }, {
      writeHead(statusCode) { result = { status: statusCode }; },
      end(json) { result.body = JSON.parse(json); }
    });
    upstream.statusCode = status;
    upstream.emit('data', body);
    // Emit after the Promise executor has returned, as a real response does.
    upstream.emit('end');
    await done;
    return result;
  };
}

const feed = title => `<feed><entry><d:Id>package</d:Id><d:Title>${title}</d:Title></entry></feed>`;

test('valid decimal, hexadecimal and named references retain normal decoding', async () => {
  const response = await harness()(feed('&#65; &#128512; &#1114111; &#x1F600; &amp; &lt; &gt; &quot; &apos;'));
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].title, 'A 😀 \u{10ffff} 😀 & < > " \'');
});

for (const entity of ['&#1114112;', `&#${'9'.repeat(400)};`, '&#x110000;']) {
  test(`invalid reference ${entity.slice(0, 25)} returns 502 and permits a subsequent search`, async () => {
    const search = harness();
    const response = await search(feed(entity));
    assert.equal(response.status, 502);
    assert.equal(typeof response.body.error, 'string');
    const next = await search(feed('&#65;'));
    assert.equal(next.status, 200);
    assert.equal(next.body.results[0].title, 'A');
  });
}

test('upstream HTTP failures still return 502', async () => {
  assert.equal((await harness()('unavailable', 503)).status, 502);
});
