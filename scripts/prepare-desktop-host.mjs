import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const workspaceRoot = process.cwd();
const hostRoot = resolve(workspaceRoot, ".desktop-app");

if (!hostRoot.startsWith(`${resolve(workspaceRoot)}${sep}`)) {
  throw new Error(`Refusing to prepare desktop host outside workspace: ${hostRoot}`);
}

await rm(hostRoot, { recursive: true, force: true });
await mkdir(hostRoot, { recursive: true });
await cp(resolve(workspaceRoot, ".desktop"), resolve(hostRoot, ".desktop"), {
  recursive: true,
});

const packageJson = JSON.parse(
  await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
);
const hostPackageJson = {
  name: packageJson.name,
  productName: packageJson.productName,
  version: packageJson.version,
  description: packageJson.description,
  author: packageJson.author,
  private: true,
  type: "module",
  main: ".desktop/main.js",
  devDependencies: {
    electron: packageJson.devDependencies.electron,
  },
  config: {
    forge: "../forge.config.ts",
  },
};
await writeFile(
  resolve(hostRoot, "package.json"),
  `${JSON.stringify(hostPackageJson, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared desktop host: ${hostRoot}`);
