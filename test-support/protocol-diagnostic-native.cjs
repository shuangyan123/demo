/* eslint-disable @typescript-eslint/no-require-imports -- Owned Electron native protocol fixture. */
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const [root, mode] = process.argv.slice(2);
assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^recall-durable-submission-test-/);
const { baseUrl, token, oldSession = '' } = JSON.parse(fs.readFileSync(path.join(root, 'native-config.json'), 'utf8'));
const profile = path.join(root, 'electron-profile'); fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);
const desktop = require(path.resolve('.desktop/protocol.js')); desktop.registerDesktopScheme();
const timer = setTimeout(() => { console.error('native protocol fixture timeout'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:owned-diagnostic-protocol');
  desktop.installDesktopProtocol(baseUrl, token, ses.protocol);
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  const evaluate = script => win.webContents.executeJavaScript(script);
  const navigate = async script => {
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await evaluate(script); await loaded;
  };
  await win.loadURL('review-app://workspace/diagnostic/resume');
  const before = JSON.parse(await evaluate('document.querySelector("#view").textContent'));
  if (mode === 'repeat') {
    await win.loadURL('review-app://workspace/diagnostic?session=' + encodeURIComponent(oldSession));
    assert.equal(await evaluate('Boolean(document.querySelector("#unavailable"))'), true);
    assert.equal(await evaluate('Boolean(document.querySelector("#revealed"))'), false);
    await win.loadURL('review-app://workspace/diagnostic/resume');
  }
  await navigate('document.querySelector("#repeat").click()');
  const sessionId = await evaluate('document.querySelector("input[name=sessionId]").value');
  await evaluate(`document.querySelector('input[value="${mode === 'first' ? 'five' : 'four'}"]').checked = true`);
  await navigate('document.querySelector("form").requestSubmit()');
  // 不把失败响应当作成功；原 net.fetch 转发会在这里得到实际 route 的 cross_origin_request。
  assert.equal(await evaluate('Boolean(document.querySelector("#revealed"))'), true,
    await evaluate('document.body.textContent'));
  assert.match(win.webContents.getURL(), /^review-app:\/\/workspace\/diagnostic\?session=/);
  await navigate('document.querySelector("#resume").click()');
  const after = JSON.parse(await evaluate('document.querySelector("#view").textContent'));
  console.log(JSON.stringify({ mainPid: process.pid, sessionId, before, after }));
  clearTimeout(timer); win.destroy(); app.quit();
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
