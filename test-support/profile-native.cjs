/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron main-process fixture. */
const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2]);
const mode = process.argv[3];
assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
assert.match(path.basename(root), /^recall-native-profile-test-/);
const appData = path.join(root, 'appData'); const profile = path.join(appData, 'profile');
fs.mkdirSync(profile, { recursive: true });
// 测试专用覆盖：仅触及 owned temp fixture，不使用开发者真实 Electron profile。
app.setPath('appData', appData); app.setPath('userData', profile); app.setPath('sessionData', profile);
assert.equal(app.requestSingleInstanceLock(), true);
const load = name => require(path.resolve('.desktop', name));
const timer = setTimeout(() => { console.error('native fixture timeout'); app.exit(1); }, 20000);
async function run() {
  assert.equal(app.isReady(), false);
  const host = load('managed-storage.js');
  const core = load('profile-initialization.js');
  const state = host.resolveDesktopManagedStorage();
  if (mode === 'restart') {
    assert.equal(state.kind, 'ready'); console.log(JSON.stringify(state)); clearTimeout(timer); app.exit(0); return;
  }
  assert.equal(state.kind, 'uninitialized');
  await app.whenReady();
  // Match packaged Main's post-ready candidate capture; runtime-created Local State
  // cannot be interpreted as an unexpected mutation of a pre-ready snapshot.
  const readyState = host.resolveDesktopManagedStorage();
  assert.equal(readyState.kind, 'uninitialized');
  const inspected = host.inspectDesktopInitialProfile(); assert.equal(inspected.kind, 'eligible');
  const result = await core.completeInitialProfileDecision(inspected.candidate, async () => {
    assert.equal(app.isReady(), true);
    const clicker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('test-support/click-native-dialog.ps1'),
      '-TaskProcessId', String(process.pid), '-Button', mode === 'cancel' ? 'Cancel fixture' : 'Create fixture'], { windowsHide: true });
    const clicked = new Promise((resolve, reject) => {
      clicker.once('error', reject); clicker.once('exit', code => code === 0 ? resolve() : reject(new Error('native click failed')));
    });
    const answer = await dialog.showMessageBox({ title: 'Recall native contract fixture', message: 'Owned temporary profile only',
      buttons: ['Create fixture', 'Cancel fixture'], defaultId: 1, cancelId: 1, noLink: true });
    await clicked;
    if (mode === 'changed') fs.writeFileSync(path.join(profile, 'foreign'), 'preserve');
    return answer.response === 0;
  }, host.createDesktopInitialProfile);
  // 与 packaged Main 一样正常退出；父进程必须检查 Chromium 退出后落盘的文件。
  console.log(JSON.stringify({ result, entries: fs.readdirSync(profile) })); clearTimeout(timer); app.quit();
}
run().catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
