import Image from "next/image";
import type { ApiProvider } from "../../types/review";
import { getProviderBranding } from "../../services/provider-branding";

/** 使用本地厂商 SVG，避免设置页和额度卡各自绘制不一致图标。 */
export function ProviderIcon({ provider, size = 24 }: { provider: ApiProvider; size?: number }) {
  const branding = getProviderBranding(provider);
  if (branding.iconPath) {
    return (
      <span
        aria-hidden="true"
        className="provider-icon relative shrink-0"
        data-theme-variant={branding.themeVariant}
        style={{
          width: size,
          height: size,
          backgroundColor: branding.iconBackground,
          borderRadius: branding.iconBackground ? Math.max(4, Math.round(size * 0.2)) : undefined,
        }}
        title={branding.label}
      >
        <Image alt="" fill sizes={`${size}px`} src={branding.iconPath} style={{ objectFit: "contain" }} unoptimized />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="provider-icon inline-grid shrink-0 place-items-center rounded-[0.3rem] font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: branding.color, fontSize: Math.max(8, Math.round(size * 0.45)) }}
      title={branding.label}
    >
      {branding.mark}
    </span>
  );
}
