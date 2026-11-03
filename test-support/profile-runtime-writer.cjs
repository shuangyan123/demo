/* eslint-disable @typescript-eslint/no-require-imports -- Actual Electron runtime writer and native choice observer only. */
const { app, dialog } = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { spawn } = require('node:child_process'); const assert = require('node:assert/strict');
const root = process.argv[2];
assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir())); assert.match(path.basename(root), /^recall-native-profile-test-/);
const appData = path.join(root, 'appData'); const profile = path.join(appData, 'profile');
app.setPath('appData', appData); app.setPath('userData', profile); app.setPath('sessionData', profile);
assert.equal(app.requestSingleInstanceLock(), true);
const timer = setTimeout(() => app.exit(1), 20000);
// 不写运行时文件、不创建资料。父测试保留真实候选；此进程只观察 Electron 写入并接收原生选择。
app.whenReady().then(async () => {
  const answer = dialog.showMessageBox({ title: 'Recall native contract fixture', message: 'Owned runtime transition fixture',
    buttons: ['Create fixture', 'Cancel fixture'], defaultId: 1, cancelId: 1, noLink: true });
  const clicker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('test-support/click-native-dialog.ps1'),
    '-TaskProcessId', String(process.pid), '-Button', 'Create fixture'], { windowsHide: true, stdio: 'ignore' });
  const clicked = new Promise((resolve, reject) => {
    clicker.once('error', reject); clicker.once('exit', code => code === 0 ? resolve() : reject(new Error('Owned native choice failed')));
  });
  const [decision] = await Promise.all([answer, clicked]); assert.equal(decision.response, 0);
  fs.writeFileSync(path.join(root, 'owned-processes.json'), JSON.stringify(app.getAppMetrics().map(metric => metric.pid)));
  console.log(JSON.stringify({ confirmed: true })); clearTimeout(timer); app.quit();
}).catch(() => { clearTimeout(timer); app.exit(1); });
