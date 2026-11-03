/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron protocol security fixture. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(process.argv[2]);
assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^recall-protocol-target-test-/);
fs.mkdirSync(path.join(root, 'profile'));
app.setPath('appData', root); app.setPath('userData', path.join(root, 'profile')); app.setPath('sessionData', path.join(root, 'profile'));
const desktop = require(path.resolve('.desktop/protocol.js')); desktop.registerDesktopScheme();
const timer = setTimeout(() => app.exit(1), 20_000);
let escapedRequests = 0, ownedRequests = 0, postBody = '';
const escaped = http.createServer((_request, response) => { escapedRequests++; response.end('escaped'); });
const owned = http.createServer(async (request, response) => {
  ownedRequests++;
  assert.equal(request.headers['x-review-runtime-token'], 'manufactured-runtime-token');
  if (request.method === 'POST') { for await (const chunk of request) postBody += String(chunk); }
  response.setHeader('content-type', 'text/html'); response.end('<main>owned fixture</main>');
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
app.whenReady().then(async () => {
  await listen(escaped); await listen(owned);
  const base = `http://127.0.0.1:${owned.address().port}`;
  desktop.installDesktopProtocol(base, 'manufactured-runtime-token');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  await win.loadURL('review-app://workspace/');
  const url = `review-app://workspace//127.0.0.1:${escaped.address().port}/leak`;
  for (const method of ['GET', 'POST']) {
    const script = `fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)}, ${method === 'POST' ? 'body: "manufactured body",' : ''} }).then(response => response.text())`;
    assert.equal(await win.webContents.executeJavaScript(script), '<main>owned fixture</main>');
  }
  assert.equal(escapedRequests, 0); assert.equal(ownedRequests, 3); assert.equal(postBody, 'manufactured body');
  console.log(JSON.stringify({ escapedRequests, ownedRequests, postBody }));
  clearTimeout(timer); win.destroy(); escaped.closeAllConnections(); owned.closeAllConnections(); escaped.close(); owned.close(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
