/* eslint-disable @typescript-eslint/no-require-imports -- Owned packaged Electron test bootstrap. */
const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = app.commandLine.getSwitchValue('recall-owned-test-root');
assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
assert.match(path.basename(root), /^recall-packaged-profile-test-/);
assert.equal(app.isPackaged, true);
assert.equal(process.versions.electron, '43.5.0');
const appData = path.join(root, 'appData'); const profile = path.join(appData, 'profile');
fs.mkdirSync(profile, { recursive: true });
// 仅测试 bootstrap 覆盖 Host 路径；后续执行原封不动的编译产物 Main，禁止写真实用户 profile。
app.setPath('appData', appData); app.setPath('userData', profile); app.setPath('sessionData', profile);
// 加载生成的 ASAR 产物，不是 test-support 目录中的源码模块；入口自身可被复制到包内。
const loadDesktopArtifact = file => require(path.join(app.getAppPath(), '.desktop', file));
const report = { packaged: app.isPackaged, electronVersion: process.versions.electron, promptObserved: false };
let phase = 'main_start';
let finishing = false;
let quitting = false;
function failed(reason) {
  report.failure = reason; report.phase = phase;
  fs.writeFileSync(path.join(root, 'observation.json'), JSON.stringify(report)); app.exit(1);
}
const timer = setTimeout(() => failed('fixture_watchdog'), 20000);
async function finish() {
  if (finishing) return; finishing = true;
  phase = 'final_inspection';
  const inspection = loadDesktopArtifact('storage-inspection.js');
  const rejected = fs.readdirSync(profile).filter(entry => !inspection.isInitialRuntimeEntry(profile, entry));
  report.rejection = rejected.length === 0 ? 'none' : rejected.length === 1 && rejected[0] === 'DevToolsActivePort'
    ? 'debug_port_record' : 'other_or_multiple_entries';
  if (report.failure) {
    const result = loadDesktopArtifact('profile-initialization.js').inspectInitialProfile({ appData, defaultUserData: profile, defaultSessionData: profile });
    report.candidateInspectionReason = result.reason;
  }
  const file = path.join(profile, 'DevToolsActivePort');
  report.debugRecordMatchesLiveEndpoint = false;
  if (fs.existsSync(file)) {
    phase = 'debugger_correlation';
    // 与本进程的真实 CDP 端点交叉核验；端口、UUID、文件内容均不输出。
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^[1-9][0-9]{0,4}\n\/devtools\/browser\/[0-9a-f-]{36}$/);
    const [port, endpoint] = text.split('\n');
    assert.equal(port, app.commandLine.getSwitchValue('remote-debugging-port'));
    const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
    const url = new URL(version.webSocketDebuggerUrl);
    report.debugRecordMatchesLiveEndpoint = url.hostname === '127.0.0.1' && url.port === port && url.pathname === endpoint;
  }
  // Main 退出不等于 GPU/utility 的进程句柄已终止；父测试按这些 PID 验证所有者并等退出事件。
  fs.writeFileSync(path.join(root, 'owned-processes.json'), JSON.stringify(app.getAppMetrics().map(metric => metric.pid)));
  fs.writeFileSync(path.join(root, 'observation.json'), JSON.stringify(report)); clearTimeout(timer);
  quitting = true; app.quit();
}
const allowedFailures = new Set(['profile_not_pristine', 'unrecognized_legacy_profile', 'initialization_inspection_failed']);
dialog.showErrorBox = (_title, message) => {
  const reason = String(message).split('状态：').at(-1);
  report.failure = allowedFailures.has(reason) ? reason : 'other_failure';
  void finish().catch(() => failed('final_inspection_failed'));
};
const nativeMessageBox = dialog.showMessageBox.bind(dialog);
dialog.showMessageBox = async options => {
  phase = 'native_choice';
  assert.equal(options.title, '创建本地学习资料'); report.promptObserved = true;
  const answer = nativeMessageBox(options);
  const clicker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'click-native-dialog.ps1'),
    '-TaskProcessId', String(process.pid), '-DialogTitle', options.title, '-Button', '取消'], { windowsHide: true, stdio: 'ignore' });
  const clicked = new Promise((resolve, reject) => {
    clicker.once('error', () => { failed('native_choice_start_failed'); reject(new Error('Owned native choice failed')); });
    clicker.once('exit', code => { if (code === 0) resolve(); else { failed('native_choice_failed'); reject(new Error('Owned native choice failed')); } });
  });
  const [decision] = await Promise.all([answer, clicked]); assert.equal(decision.response, 1); report.cancelled = true;
  return decision;
};
app.on('before-quit', event => {
  if (!quitting) { event.preventDefault(); void finish().catch(() => failed('final_inspection_failed')); }
});
loadDesktopArtifact('main.js');
