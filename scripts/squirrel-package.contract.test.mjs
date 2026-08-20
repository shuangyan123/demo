import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const artifactPath = resolve(
  workspaceRoot,
  "out",
  "make",
  "squirrel.windows",
  "x64",
  `review_workspace-${packageJson.version}-full.nupkg`,
);

function readZipEntry(archive, predicate) {
  let offset = 0;

  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraFieldLength = archive.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const fileName = archive.subarray(fileNameStart, dataStart - extraFieldLength).toString("utf8");
    const dataEnd = dataStart + compressedSize;

    if (predicate(fileName)) {
      const compressed = archive.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}`);
    }

    offset = dataEnd;
  }

  throw new Error("The generated nupkg does not contain a nuspec entry");
}

test("generated Squirrel nupkg omits the installer-time remote icon metadata", () => {
  assert.ok(existsSync(artifactPath), `missing generated Squirrel package: ${artifactPath}`);

  const nuspec = readZipEntry(
    readFileSync(artifactPath),
    (fileName) => fileName.toLowerCase().endsWith(".nuspec"),
  ).toString("utf8");

  assert.match(nuspec, /<id>review_workspace<\/id>/);
  assert.match(nuspec, new RegExp(`<version>${packageJson.version.replaceAll(".", "\\.")}<\\/version>`));
  assert.doesNotMatch(nuspec, /<iconUrl\b/i);
  assert.doesNotMatch(
    nuspec,
    /raw\.githubusercontent\.com\/electron\/electron\/shell\/browser\/resources\/win\/electron\.ico/i,
  );
});
