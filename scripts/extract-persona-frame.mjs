/**
 * 从用户提供的两张卡片合照中提取共同的金色镶边。
 *
 * 处理过程完全确定：透视校正十二张卡片、统计共同金色像素、扩展原始暗边，
 * 最终输出带透明通道的 3:4 PNG。源图只用于生成，不会被复制到项目中。
 *
 * 用法：
 * node scripts/extract-persona-frame.mjs <参考图一> <参考图二> [更多参考图...] <输出 PNG>
 */

import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const CARD_WIDTH = 900;
const CARD_HEIGHT = 1200;
const FINAL_WIDTH = 1200;
const FINAL_HEIGHT = 1600;

// 两张 1200×1200 合照中的十二张卡片位置一致，四点顺序为左上、右上、右下、左下。
const CARD_QUADS = [
  [[77, 32], [421, 44], [378, 570], [34, 542]],
  [[451, 31], [797, 57], [754, 570], [414, 539]],
  [[824, 33], [1170, 63], [1129, 571], [786, 541]],
  [[79, 592], [425, 611], [378, 1127], [35, 1100]],
  [[451, 592], [796, 617], [755, 1128], [413, 1102]],
  [[824, 594], [1170, 618], [1128, 1129], [786, 1104]],
];

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-9) throw new Error("参考卡片四点无法构成有效透视变换");
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }

  return augmented.map((row) => row[size]);
}

function createInverseHomography(quad) {
  const target = [[0, 0], [CARD_WIDTH - 1, 0], [CARD_WIDTH - 1, CARD_HEIGHT - 1], [0, CARD_HEIGHT - 1]];
  const matrix = [];
  const values = [];

  for (let index = 0; index < 4; index += 1) {
    const [u, v] = target[index];
    const [x, y] = quad[index];
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    values.push(y);
  }

  return solveLinearSystem(matrix, values);
}

function bilinearSample(data, width, height, channels, x, y, output, offset) {
  const safeX = Math.max(0, Math.min(width - 1.001, x));
  const safeY = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;

  for (let channel = 0; channel < 3; channel += 1) {
    const top = data[(y0 * width + x0) * channels + channel] * (1 - tx)
      + data[(y0 * width + x1) * channels + channel] * tx;
    const bottom = data[(y1 * width + x0) * channels + channel] * (1 - tx)
      + data[(y1 * width + x1) * channels + channel] * tx;
    output[offset + channel] = Math.round(top * (1 - ty) + bottom * ty);
  }
}

function rectifyCard(image, quad) {
  const coefficients = createInverseHomography(quad);
  const output = Buffer.alloc(CARD_WIDTH * CARD_HEIGHT * 3);
  const [a, b, c, d, e, f, g, h] = coefficients;

  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      const denominator = g * x + h * y + 1;
      const sourceX = (a * x + b * y + c) / denominator;
      const sourceY = (d * x + e * y + f) / denominator;
      bilinearSample(image.data, image.width, image.height, image.channels, sourceX, sourceY, output, (y * CARD_WIDTH + x) * 3);
    }
  }

  return output;
}

function goldScore(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const warmBalance = Math.min(red, green) - blue;
  const redGreenAgreement = 1 - Math.min(1, Math.abs(red - green) / 150);
  const brightness = Math.min(1, Math.max(0, (max - 62) / 150));
  return Math.max(0, Math.min(1, saturation * 1.35 * (warmBalance / 105) * redGreenAgreement * brightness));
}

function blueScore(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const coolDominance = Math.max(0, blue - red * 0.72);
  const cyanSupport = Math.max(0, green - red * 0.38);
  const brightness = Math.min(1, Math.max(0, (max - 26) / 150));
  return Math.max(0, Math.min(1, saturation * brightness * (coolDominance / 105) * (0.55 + cyanSupport / 180)));
}

function isFrameRegion(x, y) {
  const normalizedX = x / (CARD_WIDTH - 1);
  const normalizedY = y / (CARD_HEIGHT - 1);
  const edgeDistance = Math.min(normalizedX, 1 - normalizedX);
  const inTop = normalizedY <= 0.22;
  const inBottom = normalizedY >= 0.69;
  const inSide = edgeDistance <= 0.12;
  const originalTextBand = normalizedY >= 0.76 && normalizedY <= 0.94 && normalizedX >= 0.18 && normalizedX <= 0.82;
  return (inTop || inBottom || inSide) && !originalTextBand;
}

function dilateMask(mask, radius) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      let maximum = 0;
      for (let offsetY = -radius; offsetY <= radius && maximum < 255; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= CARD_HEIGHT) continue;
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= CARD_WIDTH) continue;
          maximum = Math.max(maximum, mask[sampleY * CARD_WIDTH + sampleX]);
        }
      }
      output[y * CARD_WIDTH + x] = maximum;
    }
  }
  return output;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function readSource(sourcePath) {
  const { data, info } = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 1200 || info.height !== 1200) {
    throw new Error(`参考图必须为 1200×1200，实际为 ${info.width}×${info.height}: ${sourcePath}`);
  }
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const outputPath = argumentsList.pop();
  const sourcePaths = argumentsList;
  if (sourcePaths.length < 2 || !outputPath) {
    throw new Error("请提供至少两张 1200×1200 参考图和输出 PNG 路径");
  }

  const sources = await Promise.all(sourcePaths.map(readSource));
  const rectifiedCards = sources.flatMap((source) => CARD_QUADS.map((quad) => rectifyCard(source, quad)));
  const goldMask = new Uint8Array(CARD_WIDTH * CARD_HEIGHT);
  const blueMask = new Uint8Array(CARD_WIDTH * CARD_HEIGHT);
  const consensusIndex = Math.max(0, Math.floor(rectifiedCards.length / 2) - 1);

  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      const offset = (y * CARD_WIDTH + x) * 3;
      const pixel = y * CARD_WIDTH + x;
      if (isFrameRegion(x, y)) {
        const scores = rectifiedCards.map((card) => goldScore(card[offset], card[offset + 1], card[offset + 2])).sort((left, right) => right - left);
        const consensus = scores[consensusIndex];
        goldMask[pixel] = Math.round(Math.max(0, Math.min(1, (consensus - 0.08) / 0.34)) * 255);
      }
      const normalizedX = x / (CARD_WIDTH - 1);
      const normalizedY = y / (CARD_HEIGHT - 1);
      const inBlueBase = normalizedY >= 0.955 || (normalizedY >= 0.9 && (normalizedX <= 0.18 || normalizedX >= 0.82));
      if (inBlueBase) {
        const scores = rectifiedCards.map((card) => blueScore(card[offset], card[offset + 1], card[offset + 2])).sort((left, right) => right - left);
        const consensus = scores[consensusIndex];
        blueMask[pixel] = Math.round(Math.max(0, Math.min(1, (consensus - 0.055) / 0.24)) * 225);
      }
    }
  }

  // 金色与蓝色分别形成共识层，再轻微扩展共同暗边；蓝色只允许出现在底部区域。
  const combinedMask = new Uint8Array(goldMask.length);
  for (let index = 0; index < combinedMask.length; index += 1) combinedMask[index] = Math.max(goldMask[index], blueMask[index]);
  const dilatedMask = dilateMask(combinedMask, 2);
  const expandedMask = new Uint8Array(combinedMask.length);
  for (let index = 0; index < combinedMask.length; index += 1) {
    expandedMask[index] = Math.max(combinedMask[index], Math.round(dilatedMask[index] * 0.48));
  }
  // 选择深色背景上的样本作为纹理来源，避免多帧颜色中值把金属细节抹平。
  const textureCard = rectifiedCards[7];
  const rgba = Buffer.alloc(CARD_WIDTH * CARD_HEIGHT * 4);
  for (let y = 0; y < CARD_HEIGHT; y += 1) {
    for (let x = 0; x < CARD_WIDTH; x += 1) {
      const pixel = y * CARD_WIDTH + x;
      const sourceOffset = pixel * 3;
      const outputOffset = pixel * 4;
      const texture = [textureCard[sourceOffset], textureCard[sourceOffset + 1], textureCard[sourceOffset + 2]];
      const goldPixels = rectifiedCards
        .map((card) => [card[sourceOffset], card[sourceOffset + 1], card[sourceOffset + 2]])
        .filter(([red, green, blue]) => goldScore(red, green, blue) > 0.1);
      const bluePixels = rectifiedCards
        .map((card) => [card[sourceOffset], card[sourceOffset + 1], card[sourceOffset + 2]])
        .filter(([red, green, blue]) => blueScore(red, green, blue) > 0.08);
      const isBlueLayer = blueMask[pixel] > goldMask[pixel];
      const color = isBlueLayer && bluePixels.length > 0
        ? [0, 1, 2].map((channel) => median(bluePixels.map((sample) => sample[channel])))
        : goldScore(texture[0], texture[1], texture[2]) > 0.08
          ? texture
          : goldPixels.length > 0
            ? [0, 1, 2].map((channel) => median(goldPixels.map((sample) => sample[channel])))
            : [48, 33, 8];
      rgba[outputOffset] = color[0];
      rgba[outputOffset + 1] = color[1];
      rgba[outputOffset + 2] = color[2];
      rgba[outputOffset + 3] = expandedMask[pixel];
    }
  }

  await sharp(rgba, { raw: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4 } })
    .resize(FINAL_WIDTH, FINAL_HEIGHT, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  const opaquePixels = [...expandedMask].filter((alpha) => alpha >= 128).length;
  const bluePixels = [...blueMask].filter((alpha) => alpha >= 96).length;
  const coverage = ((opaquePixels / expandedMask.length) * 100).toFixed(2);
  const blueCoverage = ((bluePixels / blueMask.length) * 100).toFixed(2);
  process.stdout.write(`已生成 ${path.resolve(outputPath)}，镶边覆盖率 ${coverage}%，底部蓝色覆盖率 ${blueCoverage}%\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
