/** 非 AI 厂商集成的品牌资产登记，避免混入 provider registry。 */
export const integrationBranding = {
  obsidian: {
    label: "Obsidian",
    assetPath: "/plugin-icons/obsidian.svg",
    assetOrigin: "lobe-icons" as const,
    package: "@lobehub/icons-static-svg",
    version: "1.91.0",
    sourceUrl: "https://unpkg.com/@lobehub/icons-static-svg@1.91.0/icons/obsidian-color.svg",
    license: "MIT",
    verifiedAt: "2026-07-15",
    sha256: "cb8d13afbcc2817956725f7ec4d3c2e9173c79988d178e0b7138b7595c13d261",
  },
} as const;
