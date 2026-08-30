import Image from "next/image";

export type RecallBrandTheme = "light" | "dark";
export type RecallBrandVariant = "B" | "C";

type RecallBrandAsset = Readonly<{
  height: number;
  src: string;
  width: number;
}>;

const wordmarkAssets: Record<RecallBrandTheme, Record<RecallBrandVariant, RecallBrandAsset>> = {
  light: {
    B: { height: 170, src: "/brand/recall/wordmark/recall-wordmark-B-transparent.png", width: 430 },
    C: { height: 129, src: "/brand/recall/wordmark/recall-wordmark-C-transparent.png", width: 369 },
  },
  dark: {
    B: { height: 170, src: "/brand/recall/wordmark/recall-wordmark-B-dark-transparent.png", width: 430 },
    C: { height: 129, src: "/brand/recall/wordmark/recall-wordmark-C-dark-transparent.png", width: 369 },
  },
};

const lockupAssets: Record<RecallBrandTheme, Record<RecallBrandVariant, RecallBrandAsset>> = {
  light: {
    B: { height: 176, src: "/brand/recall/wordmark/recall-lockup-B-transparent.png", width: 504 },
    C: { height: 176, src: "/brand/recall/wordmark/recall-lockup-C-transparent.png", width: 544 },
  },
  dark: {
    B: { height: 176, src: "/brand/recall/wordmark/recall-lockup-B-dark-transparent.png", width: 418 },
    C: { height: 176, src: "/brand/recall/wordmark/recall-lockup-C-dark-transparent.png", width: 446 },
  },
};

type RecallBrandProps = {
  alt?: string;
  className?: string;
  theme: RecallBrandTheme;
  variant: RecallBrandVariant;
};

function RecallBrandImage({ alt = "Recall", asset, className }: Pick<RecallBrandProps, "alt" | "className"> & { asset: RecallBrandAsset }) {
  return (
    <Image
      className={`h-auto w-auto max-w-full object-contain${className ? ` ${className}` : ""}`}
      src={asset.src}
      alt={alt}
      width={asset.width}
      height={asset.height}
      unoptimized
    />
  );
}

/** 使用批准的 B/C 字形；theme 必须显式选择对应的官方明暗位图。 */
export function RecallBrandWordmark({ alt, className, theme, variant }: RecallBrandProps) {
  return <RecallBrandImage alt={alt} asset={wordmarkAssets[theme][variant]} className={className} />;
}

/** 使用批准的 mascot + B/C 字形 lockup；不在渲染层重绘、裁剪或改色。 */
export function RecallBrandLockup({ alt, className, theme, variant }: RecallBrandProps) {
  return <RecallBrandImage alt={alt} asset={lockupAssets[theme][variant]} className={className} />;
}
