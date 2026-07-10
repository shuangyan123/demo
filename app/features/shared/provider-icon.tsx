import Image from "next/image";
import type { ApiProvider } from "../../types/review";
import { getProviderBranding } from "../../services/provider-branding";

/** 使用本地厂商 SVG，避免设置页和额度卡各自绘制不一致图标。 */
export function ProviderIcon({ provider, size = 24 }: { provider: ApiProvider; size?: number }) {
  const branding = getProviderBranding(provider);
  return <Image alt="" aria-hidden="true" className="provider-icon" height={size} src={branding.iconPath} title={branding.label} unoptimized width={size} />;
}
