/**
 * 从用户确认的 2:3 边框参考图中移除近白棋盘背景，保留原始金色、蓝色与暗色描边。
 *
 * 用法：
 * node scripts/extract-persona-frame.mjs <1024x1536 参考图> <输出 PNG>
 */

import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const EXPECTED_WIDTH = 1024;
const EXPECTED_HEIGHT = 1536;

async function main() {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) throw new Error("请提供 2:3 参考图和输出 PNG 路径");

  const { data, info } = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== EXPECTED_WIDTH || info.height !== EXPECTED_HEIGHT) {
    throw new Error(`参考图必须为 ${EXPECTED_WIDTH}×${EXPECTED_HEIGHT}，实际为 ${info.width}×${info.height}`);
  }

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const sourceOffset = pixel * info.channels;
    const outputOffset = pixel * 4;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const distanceFromWhite = 255 - Math.min(red, green, blue);
    const alpha = distanceFromWhite <= 12 ? 0 : distanceFromWhite >= 58 ? 255 : Math.round(((distanceFromWhite - 12) / 46) * 255);
    rgba[outputOffset] = red;
    rgba[outputOffset + 1] = green;
    rgba[outputOffset + 2] = blue;
    rgba[outputOffset + 3] = alpha;
  }

  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ adaptiveFiltering: true, compressionLevel: 9 })
    .toFile(outputPath);
  process.stdout.write(`已生成 ${path.resolve(outputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
