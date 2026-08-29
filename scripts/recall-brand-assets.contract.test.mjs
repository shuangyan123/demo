import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const brandRoot = resolve(workspaceRoot, "public", "brand", "recall");

const approvedAssets = {
  "source/recall-master-transparent-1254.png": {
    width: 1254,
    height: 1254,
    sha256: "f58eab8bc46c0fb8aa9470df2f4a93cacd4b3a6b8ff851bb7fc5bbee1ffbc03b",
  },
  "app/recall-app-icon-1024.png": {
    width: 1024,
    height: 1024,
    sha256: "2a56c4dc446cf94d63580c0270ac9d64533aefba1429212f641abd565047784f",
  },
  "app/recall-app-icon-512.png": {
    width: 512,
    height: 512,
    sha256: "b160783bf395dcc979df112098d960520334d7c3bdc6584ef7b0683e52cbcb7d",
  },
  "app/recall-app-icon-256.png": {
    width: 256,
    height: 256,
    sha256: "17eef6f27fd68fa0ed16606fd354d4f748732dd318ac2e02631622a5ed41371e",
  },
  "app/recall-app-icon-128.png": {
    width: 128,
    height: 128,
    sha256: "113b8e766f32c0cedd3275c36485fb8c22a5b63503476fa6febce87f548f4da2",
  },
  "app/recall-app-icon-64.png": {
    width: 64,
    height: 64,
    sha256: "87324742cf37f998e7866454317e909223c9fd8af626965e6ad3b6f6456dff14",
  },
  "app/recall-app-icon-48.png": {
    width: 48,
    height: 48,
    sha256: "cd529a547514a6403a41a6cc5e27412390312099c2d3315ce84a24f10cf5d317",
  },
  "app/recall-optical-32.png": {
    width: 32,
    height: 32,
    sha256: "c3597674327eb15f79cc12c2ae88632a453750871d907ac2993905b00ea8a1b0",
  },
  "app/recall-optical-24.png": {
    width: 24,
    height: 24,
    sha256: "9d9152ceb6635a8b383de09a99956242eb4cfa0158426116e71fd901fb170e52",
  },
  "app/recall-optical-16.png": {
    width: 16,
    height: 16,
    sha256: "13a3885988a79bc3a261c0d49f77ff41475e9ddeadfd9169635045c8b76aded5",
  },
  "web/favicon-32.png": {
    width: 32,
    height: 32,
    sha256: "c3597674327eb15f79cc12c2ae88632a453750871d907ac2993905b00ea8a1b0",
  },
  "web/favicon-16.png": {
    width: 16,
    height: 16,
    sha256: "13a3885988a79bc3a261c0d49f77ff41475e9ddeadfd9169635045c8b76aded5",
  },
};

const approvedIcoSha256 = "d35baa505a25f2ae7650af025f055543ef65203b057d86192eddb9ba2b33d9e6";
const approvedFaviconIcoSha256 = "23b169116449a4d6f1a20bbfb843db81852f0fc1f77a664fd1b4bf7a8f2dbfdc";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePngMetadata(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      return {
        width: buffer.readUInt32BE(offset + 8),
        height: buffer.readUInt32BE(offset + 12),
        bitDepth: buffer[offset + 16],
        colorType: buffer[offset + 17],
      };
    }
    offset += 12 + length;
  }
  throw new Error("PNG IHDR chunk is missing");
}

function parseIcoEntries(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved field");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO type field");
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const imageOffset = buffer.readUInt32LE(offset + 12);
    return {
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256,
      bitCount: buffer.readUInt16LE(offset + 6),
      bytesInRes: buffer.readUInt32LE(offset + 8),
      signature: buffer.subarray(imageOffset, imageOffset + 8).toString("hex"),
    };
  });
}

test("checked-in Recall assets match the locked v2 package", () => {
  for (const [relativePath, expected] of Object.entries(approvedAssets)) {
    const filePath = resolve(brandRoot, relativePath);
    assert.ok(existsSync(filePath), `missing approved asset: ${relativePath}`);
    const bytes = readFileSync(filePath);
    assert.equal(sha256(bytes), expected.sha256, `unexpected asset variant: ${relativePath}`);
    const metadata = parsePngMetadata(bytes);
    assert.deepEqual(
      { width: metadata.width, height: metadata.height },
      { width: expected.width, height: expected.height },
      `unexpected dimensions: ${relativePath}`,
    );
    assert.equal(metadata.bitDepth, 8, `unexpected PNG bit depth: ${relativePath}`);
    assert.equal(metadata.colorType, 6, `Recall asset must retain RGBA transparency: ${relativePath}`);
  }

  const ico = readFileSync(resolve(brandRoot, "app", "recall.ico"));
  assert.equal(sha256(ico), approvedIcoSha256, "unexpected Windows ICO variant");
  assert.deepEqual(
    parseIcoEntries(ico).map(({ width, height, bitCount }) => `${width}x${height}:${bitCount}`),
    ["16x16:32", "24x24:32", "32x32:32", "48x48:32", "64x64:32", "128x128:32", "256x256:32"],
  );
  assert.ok(parseIcoEntries(ico).every((entry) => entry.bytesInRes > 0 && entry.signature === "89504e470d0a1a0a"));

  const favicon = readFileSync(resolve(brandRoot, "web", "favicon.ico"));
  assert.equal(sha256(favicon), approvedFaviconIcoSha256, "unexpected web favicon variant");
  assert.equal(sha256(readFileSync(resolve(workspaceRoot, "app", "favicon.ico"))), approvedFaviconIcoSha256);
});

test("Recall asset layout excludes the crop-check preview and source ZIP", () => {
  assert.equal(existsSync(resolve(brandRoot, "source", "recall-transparent-crop-check.png")), false);
  assert.equal(existsSync(resolve(workspaceRoot, "recall_locked_final_brand_assets_v2.zip")), false);
});

test("Recall references use the configured asset without changing application identity", () => {
  const workspaceShell = readFileSync(resolve(workspaceRoot, "app", "features", "shared", "workspace-shell.tsx"), "utf8");
  const recallBrandMark = readFileSync(resolve(workspaceRoot, "app", "features", "shared", "recall-brand-mark.tsx"), "utf8");
  const forgeConfig = readFileSync(resolve(workspaceRoot, "forge.config.ts"), "utf8");
  const m0Config = readFileSync(resolve(workspaceRoot, "electron-builder.m0.cjs"), "utf8");
  const nsisConfig = readFileSync(resolve(workspaceRoot, "electron-builder.nsis.cjs"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
  const main = readFileSync(resolve(workspaceRoot, "desktop", "main.ts"), "utf8");

  assert.match(workspaceShell, /<RecallBrandMark \/>/);
  assert.match(recallBrandMark, /src="\/brand\/recall\/app\/recall-app-icon-48\.png"/);
  assert.match(recallBrandMark, /alt="Recall"/);
  assert.match(recallBrandMark, /unoptimized/);
  assert.match(forgeConfig, /icon:\s*recallWindowsIconPath/);
  assert.match(forgeConfig, /setupIcon:\s*recallWindowsIconPath/);
  assert.match(m0Config, /icon:\s*recallWindowsIconPath/);
  assert.match(m0Config, /installerIcon:\s*recallWindowsIconPath/);
  assert.match(m0Config, /uninstallerIcon:\s*recallWindowsIconPath/);
  assert.match(nsisConfig, /icon:\s*recallWindowsIconPath/);
  assert.match(nsisConfig, /installerIcon:\s*recallWindowsIconPath/);
  assert.match(nsisConfig, /uninstallerIcon:\s*recallWindowsIconPath/);
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.match(main, /const partition = "persist:review-workspace"/);
  assert.doesNotMatch(main, /Recall\.exe/);
  assert.doesNotMatch(main, /app\.setPath\(\s*["']userData["']/);
});
