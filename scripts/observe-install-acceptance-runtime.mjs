import assert from "node:assert/strict";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Read-only, synthetic hosted installation observation. Never output profile paths,
// security material, raw runtime bytes, or filesystem exception messages.
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.env.RUNNER_OS, "Windows");
assert.equal(process.env.GITHUB_REPOSITORY, "shuangyan123/demo");
const output = process.argv[2];
assert.ok(output && path.dirname(output) === path.join(process.env.RUNNER_TEMP, "recall-install-acceptance", "evidence"));
const appData = process.env.APPDATA;
assert.ok(appData && path.isAbsolute(appData));
const profiles = ["review-workspace", "错题复盘"].map(name => path.join(appData, name));
const exact = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj)
  && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());

function validLocalState(file) {
  let before, after, bytes;
  try {
    before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 4096) return false;
    bytes = readFileSync(file);
    after = lstatSync(file);
  } catch (e) { if (e?.code === "ENOENT") return false; throw new Error("runtime observation unavailable"); }
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino
    || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
    || bytes.length !== before.size) return false;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return false;
  let value;
  try { value = JSON.parse(text); } catch { return false; }
  if (JSON.stringify(value) !== text.trim() || !exact(value, ["os_crypt", "uninstall_metrics"])
    || !exact(value.os_crypt, ["audit_enabled", "encrypted_key"])
    || !exact(value.uninstall_metrics, ["installation_date2"])) return false;
  const key = value.os_crypt.encrypted_key;
  const date = value.uninstall_metrics.installation_date2;
  if (typeof value.os_crypt.audit_enabled !== "boolean" || typeof key !== "string"
    || typeof date !== "string" || !/^[0-9]{1,20}$/.test(date)) return false;
  const decoded = Buffer.from(key, "base64");
  return decoded.length > 5 && decoded.toString("base64") === key && decoded.subarray(0, 5).toString("ascii") === "DPAPI";
}

const paths = profiles.map(profile => path.join(profile, "Local State"));
const fileWasAbsentWhenPromptOpened = paths.every(file => {
  try { lstatSync(file); return false; }
  catch (error) { if (error?.code === "ENOENT") return true; throw new Error("initial runtime observation unavailable"); }
});
if (!fileWasAbsentWhenPromptOpened) throw new Error("Local State was present at native prompt observation start");
const started = Date.now();
let observed;
while (Date.now() - started < 45000) {
  const found = paths.map((file, i) => validLocalState(file) ? i : -1).filter(i => i >= 0);
  if (found.length > 1) throw new Error("Ambiguous runtime profile");
  if (found.length === 1) { observed = found[0]; break; }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (observed === undefined) throw new Error("Recognized Local State never appeared while native prompt remained open");
const record = { status: "PASS", recognizedElectronLocalState: true,
  fileWasAbsentWhenPromptOpened, observedAfterDialogVisible: true,
  profileLabel: observed === 0 ? "review-workspace" : "错题复盘",
  elapsedMs: Date.now() - started };
writeFileSync(output, JSON.stringify(record, null, 2));
console.log("PASS: owned native dialog remained open until Electron Local State appeared");
