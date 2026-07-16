import type { TutoringMode } from "../../types/review";

export type VisionSourceKind = Exclude<TutoringMode, "upload">;
export type VisionSourceStatus = "idle" | "starting" | "ready" | "ended" | "error";

/** 单帧只在内存传递；fingerprint 仅用于本地变化检测。 */
export type VisionFrame = {
  dataUrl: string;
  capturedAt: string;
  fingerprint: string;
};

export type VisionSourceSession = {
  kind: VisionSourceKind;
  label: string;
  stream: MediaStream;
};

export type VisionCaptureInput = {
  mode: TutoringMode;
  video?: HTMLVideoElement | null;
  uploadedDataUrl?: string;
  maxWidth?: number;
};

/** 未来 Android XR 配套应用需要实现的最小眼镜输入协议。 */
export interface VisionSourceAdapter {
  start(kind: VisionSourceKind): Promise<VisionSourceSession>;
  stop(session?: VisionSourceSession): void;
  status(session?: VisionSourceSession): VisionSourceStatus;
  capture(input: VisionCaptureInput): VisionFrame;
  readUpload(file: File): Promise<string>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择文件"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/** 生成 8×8 灰度指纹，计算量低且不保留可还原的画面。 */
function frameFingerprint(canvas: HTMLCanvasElement): string {
  const sample = document.createElement("canvas");
  sample.width = 8;
  sample.height = 8;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  context.drawImage(canvas, 0, 0, 8, 8);
  const pixels = context.getImageData(0, 0, 8, 8).data;
  const bytes: string[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    bytes.push(luminance.toString(16).padStart(2, "0"));
  }
  return bytes.join("");
}

function captureVideoFrame(video: HTMLVideoElement, maxWidth = 960): VisionFrame {
  if (!video.videoWidth || !video.videoHeight) throw new Error("画面尚未就绪，请稍后再发送");
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法截取画面");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.72),
    capturedAt: new Date().toISOString(),
    fingerprint: frameFingerprint(canvas),
  };
}

/** 上传图片使用不可逆的分桶哈希参与重复检测，不保留任何可还原片段。 */
function textFingerprint(value: string): string {
  const buckets = new Uint8Array(64);
  for (let index = 0; index < value.length; index += 1) {
    buckets[index % buckets.length] = (buckets[index % buckets.length] * 31 + value.charCodeAt(index)) & 0xff;
  }
  return [...buckets].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 比较不可逆灰度指纹；差异达到阈值才更新自动采样帧。 */
export function hasMeaningfulVisionChange(previous: string, next: string, threshold = 0.09): boolean {
  if (!previous || !next || previous.length !== next.length) return true;
  let difference = 0;
  let count = 0;
  for (let index = 0; index < next.length; index += 2) {
    difference += Math.abs(Number.parseInt(previous.slice(index, index + 2), 16) - Number.parseInt(next.slice(index, index + 2), 16));
    count += 1;
  }
  return count ? difference / (count * 255) >= threshold : true;
}

/** 浏览器摄像头、屏幕和上传图片的默认实现。 */
export const browserVisionSourceAdapter: VisionSourceAdapter = {
  async start(kind) {
    if (!navigator.mediaDevices) throw new Error("当前浏览器不支持媒体设备访问");
    const stream = kind === "camera"
      ? await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } })
      : await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
    const track = stream.getVideoTracks()[0];
    const displaySurface = track?.getSettings().displaySurface;
    const sourceLabel = kind === "camera"
      ? track?.label || "摄像头"
      : displaySurface === "browser" ? "浏览器标签页" : displaySurface === "window" ? "应用窗口" : displaySurface === "monitor" ? "整个屏幕" : "共享画面";
    return { kind, label: track?.label && kind === "screen" ? `${sourceLabel} · ${track.label}` : sourceLabel, stream };
  },
  stop(session) {
    session?.stream.getTracks().forEach((track) => track.stop());
  },
  status(session) {
    if (!session) return "idle";
    return session.stream.getVideoTracks().some((track) => track.readyState === "live") ? "ready" : "ended";
  },
  capture(input) {
    if (input.mode === "upload") {
      if (!input.uploadedDataUrl) throw new Error("请先上传一张截图或图片");
      return { dataUrl: input.uploadedDataUrl, capturedAt: new Date().toISOString(), fingerprint: textFingerprint(input.uploadedDataUrl) };
    }
    if (!input.video) throw new Error("请先启动摄像头或屏幕共享");
    return captureVideoFrame(input.video, input.maxWidth);
  },
  readUpload(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("只支持 PNG、JPEG 或 WebP 图片");
    if (file.size > 10 * 1024 * 1024) throw new Error("辅导图片不能超过 10MB");
    return readFileAsDataUrl(file);
  },
};
