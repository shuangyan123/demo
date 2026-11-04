/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron main-process fixture. */
const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2]);
const mode = process.argv[3];
assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
assert.match(path.basename(root), /^recall-native-profile-test-/);
const appData = path.join(root, 'appData'); const profile = path.join(appData, 'profile');
fs.mkdirSync(appData, { recursive: true });
// 测试专用覆盖：仅触及 owned temp fixture，不使用开发者真实 Electron profile。
app.setPath('appData', appData); app.setPath('userData', profile); app.setPath('sessionData', profile);
assert.equal(app.requestSingleInstanceLock(), true);
const load = name => require(path.resolve('.desktop', name));
assert.equal(process.versions.electron, JSON.parse(fs.readFileSync(path.resolve('node_modules/electron/package.json'), 'utf8')).version);
const observations = [];
function observe(stage) {
  const describe = target => {
    if (!fs.existsSync(target)) return { exists: false };
    const stat = fs.lstatSync(target);
    return { exists: true, directory: stat.isDirectory(), dev: stat.dev, ino: stat.ino, bytes: stat.size };
  };
  observations.push({ stage, ready: app.isReady(), profile: describe(profile),
    hostPaths: ['appData', 'userData', 'sessionData'].map(key => app.getPath(key).replaceAll(root, '<fixture>')),
    files: fs.existsSync(profile) ? fs.readdirSync(profile).map(name => ({ name, ...describe(path.join(profile, name)) })) : [] });
}
const timer = setTimeout(() => { console.error('native fixture timeout'); app.exit(1); }, 35000);
async function run() {
  assert.equal(app.isReady(), false);
  const host = load('managed-storage.js');
  const core = load('profile-initialization.js');
  const state = host.resolveDesktopManagedStorage();
  if (mode === 'restart') {
    assert.equal(state.kind, 'ready'); console.log(JSON.stringify(state)); clearTimeout(timer); app.exit(0); return;
  }
  assert.equal(state.kind, 'uninitialized');
  const beforeReady = host.inspectDesktopInitialProfile(); assert.equal(beforeReady.kind, 'eligible');
  observe('before-ready');
  await app.whenReady();
  observe('after-ready');
  if (mode === 'history-before-prompt') fs.writeFileSync(path.join(profile, 'foreign'), 'preserve');
  if (mode === 'identity-before-prompt') {
    fs.mkdirSync(path.join(profile, '.recall-storage'));
    fs.writeFileSync(path.join(profile, '.recall-storage', 'identity.json'), JSON.stringify({ formatVersion: 1,
      profileId: '00000000-0000-4000-8000-000000000001', epochId: '00000000-0000-4000-8000-000000000002' }));
  }
  if (mode === 'corrupt-before-prompt') {
    fs.mkdirSync(path.join(appData, 'recall-storage'));
    fs.writeFileSync(path.join(appData, 'recall-storage', 'bootstrap.json'), '{partial');
  }
  const pendingInspection = host.inspectReadyDesktopInitialProfile();
  if (mode === 'host-before-prompt') {
    const other = path.join(appData, 'other'); fs.mkdirSync(other); app.setPath('sessionData', other);
  }
  const inspected = await pendingInspection;
  observe('before-prompt');
  if (mode.endsWith('before-prompt')) {
    assert.notEqual(inspected.kind, 'eligible');
    console.log(JSON.stringify({ result: inspected, observations })); clearTimeout(timer); app.quit(); return;
  }
  assert.equal(inspected.kind, 'eligible');
  // 旧时序的候选不能因等待过运行时而自动升级；仅用于验证旧缺陷继续 fail closed。
  if (mode === 'stale-before-ready') await core.completeInitialProfileDecision(inspected.candidate, async () => false, host.createDesktopInitialProfile);
  const result = await core.completeInitialProfileDecision(mode === 'stale-before-ready' ? beforeReady.candidate : inspected.candidate, async () => {
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
    if (mode === 'local-state-changed') {
      const file = path.join(profile, 'Local State'); const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      value.uninstall_metrics.installation_date2 = '2'; fs.writeFileSync(file, JSON.stringify(value));
    }
    if (mode === 'host-path-changed') {
      const other = path.join(appData, 'other'); fs.mkdirSync(other); app.setPath('sessionData', other);
    }
    observe('after-confirmation');
    return answer.response === 0;
  }, host.createDesktopInitialProfile);
  // 与 packaged Main 一样正常退出；父进程必须检查 Chromium 退出后落盘的文件。
  observe('after-create');
  assert.equal(core.createInitialProfile(mode === 'stale-before-ready' ? beforeReady.candidate : inspected.candidate,
    { appData, defaultUserData: profile, defaultSessionData: profile }).reason, 'invalid_initialization_candidate');
  console.log(JSON.stringify({ result, entries: fs.readdirSync(profile), observations })); clearTimeout(timer); app.quit();
}
run().catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
