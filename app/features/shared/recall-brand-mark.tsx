import Image from "next/image";

/** 使用批准的 Recall 标准导出；不在渲染层重绘或裁剪品牌图形。 */
export function RecallBrandMark() {
  return (
    <Image
      className="h-7 w-7 shrink-0 object-contain"
      src="/brand/recall/app/recall-optical-32.png"
      alt="Recall"
      width={28}
      height={28}
      unoptimized
    />
  );
}
