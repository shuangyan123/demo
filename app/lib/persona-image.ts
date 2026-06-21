/**
 * 把用户上传的高清角色图裁成统一 2:3，并压缩为适合 IndexedDB 持久化的 WebP。
 * 原图只在浏览器内解码，不上传服务器，也不保留额外副本。
 */

const MAX_WIDTH = 2400;
const MAX_HEIGHT = 3600;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76];

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("高清图片压缩失败")), "image/webp", quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 居中裁切并限制最终像素与存储体积，避免高清原图直接转 Data URL 带来的 33% 体积膨胀。
 */
export async function preparePersonaImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const sourceRatio = bitmap.width / bitmap.height;
    const targetRatio = 2 / 3;
    const cropWidth = sourceRatio > targetRatio ? bitmap.height * targetRatio : bitmap.width;
    const cropHeight = sourceRatio > targetRatio ? bitmap.height : bitmap.width / targetRatio;
    const sourceX = (bitmap.width - cropWidth) / 2;
    const sourceY = (bitmap.height - cropHeight) / 2;
    let width = Math.min(MAX_WIDTH, Math.max(2, Math.round(cropWidth)));
    let height = Math.min(MAX_HEIGHT, Math.max(3, Math.round(width / targetRatio)));
    if (height > MAX_HEIGHT) {
      height = MAX_HEIGHT;
      width = Math.round(height * targetRatio);
    }

    for (let resizeAttempt = 0; resizeAttempt < 3; resizeAttempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("当前浏览器无法处理高清角色图");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);

      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= MAX_OUTPUT_BYTES) return blobToDataUrl(blob);
      }
      width = Math.max(1200, Math.round(width * 0.8));
      height = Math.round(width / targetRatio);
    }
    throw new Error("图片压缩后仍超过 5MB，请换用细节稍少的图片");
  } finally {
    bitmap.close();
  }
}
