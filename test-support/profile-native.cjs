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
fs.mkdirSync(profile, { recursive: true });
// 测试专用覆盖：仅触及 owned temp fixture，不使用开发者真实 Electron profile。
app.setPath('appData', appData); app.setPath('userData', profile); app.setPath('sessionData', profile);
const load = name => require(path.resolve('.desktop', name));
let phase = 'pre_ready_resolution';
let observed;
function expect(result, kind, stage) { phase = stage; observed = result; assert.equal(result.kind, kind); }
function reportFailure(trigger) {
  const reasons = new Set(['profile_not_pristine', 'unrecognized_legacy_profile', 'initialization_inspection_failed',
    'initialization_candidate_changed', 'initialization_unconfirmed', 'initialization_remnants']);
  fs.writeFileSync(path.join(root, 'native-failure.json'), JSON.stringify({ trigger, phase,
    kind: ['uninitialized', 'eligible', 'ready', 'unavailable'].includes(observed?.kind) ? observed.kind : 'other',
    reason: reasons.has(observed?.reason) ? observed.reason : 'other' }));
}
const timer = setTimeout(() => { reportFailure('watchdog'); app.exit(1); }, 20000);
async function run() {
  phase = 'single_instance_lock'; assert.equal(app.requestSingleInstanceLock(), true);
  phase = 'pre_ready_resolution';
  assert.equal(app.isReady(), false);
  const host = load('managed-storage.js');
  const core = load('profile-initialization.js');
  const state = host.resolveDesktopManagedStorage();
  if (mode === 'restart') {
    fs.writeFileSync(path.join(root, 'owned-processes.json'), JSON.stringify([process.pid]));
    assert.equal(state.kind, 'ready'); console.log(JSON.stringify(state)); clearTimeout(timer); app.exit(0); return;
  }
  expect(state, 'uninitialized', 'pre_ready_resolution');
  phase = 'waiting_ready'; await app.whenReady();
  // Match packaged Main's post-ready candidate capture; runtime-created Local State
  // cannot be interpreted as an unexpected mutation of a pre-ready snapshot.
  phase = 'post_ready_resolution'; const readyState = host.resolveDesktopManagedStorage();
  expect(readyState, 'uninitialized', 'post_ready_resolution');
  phase = 'candidate_inspection'; const inspected = host.inspectDesktopInitialProfile(); expect(inspected, 'eligible', 'candidate_inspection');
  let runtimePublication;
  const result = await core.completeInitialProfileDecision(inspected.candidate, async () => {
    phase = 'native_choice';
    assert.equal(app.isReady(), true);
    // 等待真实 Chromium 文件事件再点击；不写 Local State，也不用固定延时模拟故障。
    const published = mode === 'runtime-write' ? new Promise(resolve => {
      const file = path.join(profile, 'Local State');
      assert.equal(fs.existsSync(file), false);
      const started = performance.now();
      const watcher = fs.watch(profile, (_event, name) => {
        if (name !== 'Local State' || !fs.existsSync(file)) return;
        if (!load('storage-inspection.js').isInitialRuntimeEntry(profile, 'Local State')) return;
        watcher.close();
        runtimePublication = { writer: 'Electron', appearedAfterReady: true, elapsedMs: Math.round(performance.now() - started) };
        resolve();
      });
    }) : Promise.resolve();
    const answerPromise = dialog.showMessageBox({ title: 'Recall native contract fixture', message: 'Owned temporary profile only',
      buttons: ['Create fixture', 'Cancel fixture'], defaultId: 1, cancelId: 1, noLink: true });
    await published;
    phase = 'native_click';
    const clicker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('test-support/click-native-dialog.ps1'),
      '-TaskProcessId', String(process.pid), '-Button', mode === 'cancel' || mode === 'cdp-cancel' ? 'Cancel fixture' : 'Create fixture'], { windowsHide: true });
    const clicked = new Promise((resolve, reject) => {
      clicker.once('error', reject); clicker.once('exit', code => code === 0 ? resolve() : reject(new Error('native click failed')));
    });
    const answer = await answerPromise;
    phase = 'native_click_completion';
    await clicked;
    if (mode === 'changed') fs.writeFileSync(path.join(profile, 'foreign'), 'preserve');
    return answer.response === 0;
  }, candidate => { phase = 'creation'; observed = host.createDesktopInitialProfile(candidate); return observed; });
  // 与 packaged Main 一样正常退出；父进程必须检查 Chromium 退出后落盘的文件。
  fs.writeFileSync(path.join(root, 'owned-processes.json'), JSON.stringify(app.getAppMetrics().map(metric => metric.pid)));
  console.log(JSON.stringify({ result, entries: fs.readdirSync(profile), runtimePublication })); clearTimeout(timer); app.quit();
}
run().catch(() => {
  reportFailure('exception');
  clearTimeout(timer); app.exit(1);
});
