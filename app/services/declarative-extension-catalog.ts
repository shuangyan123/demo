import type { DeclarativeExtensionPackage, ExtensionSignature } from "../types/domains/declarative-extension.ts";

const OFFICIAL_SIGNATURE_KEY: JsonWebKey = {
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  x: "BZ1MzWhuHmizgD5AUICipw6iUfmjwYzFdMvrSe_Mz5k",
  y: "lBWvZpBc2ZlquRrGhsSneji9PW-dvyKUESaTDfwgqMU",
  crv: "P-256",
};

function officialSignature(value: string): ExtensionSignature {
  return { algorithm: "ECDSA_P256_SHA256", publicKeyJwk: OFFICIAL_SIGNATURE_KEY, value };
}

/** 应用随版本发布的只读静态目录；包内只有数据，不包含可执行代码。 */
export const officialDeclarativeExtensionCatalog: DeclarativeExtensionPackage[] = [
  {
    manifest: {
      schemaVersion: 1,
      id: "cn.review.theme.paper-focus",
      version: "1.0.0",
      minAppVersion: "0.1.0",
      kind: "theme",
      name: "专注纸张",
      author: { name: "公考学习工作台" },
      description: "低干扰纸张色主题，适合长时间阅读和错题复盘。",
      entry: "data.json",
      permissions: ["appearance.write"],
      assets: [],
      contentSha256: "7f191df370b2236099c0c3177ff31b8bfdd719b9f9429039ff1dfe138b6c1969",
      signature: officialSignature("K0t1SPBuTKo6QyMR3+uCMKMpHfft4z8NUSM78CQR8YL81yUQ29powJ9y6XCNK8Yxc05Lro9kaeQoZOMDthcOsw=="),
    },
    data: {
      target: "both",
      theme: {
        name: "专注纸张",
        accent: "#315f78",
        background: "#f7f4ec",
        foreground: "#1f292f",
        uiFont: "var(--font-noto-sans-sc)",
        codeFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
        diffuseGradient: false,
        contrast: 0,
      },
    },
    assets: [],
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "cn.review.persona.exam-coach",
      version: "1.0.0",
      minAppVersion: "0.1.0",
      kind: "persona",
      name: "申论结构教练",
      author: { name: "公考学习工作台" },
      description: "强调论点、证据与段落结构的申论训练教师人设。",
      entry: "data.json",
      permissions: ["persona.write"],
      assets: [],
      contentSha256: "0c8e9091f7a69269f881e57eabc1b69035e0d369f6f645a54c689f4599999ba8",
      signature: officialSignature("Ygv4gejLO4Qw6Pm/YBrJFSFjlELi8d7oWvDrteuHgkpqZL7/qqCGvMHwO2IPENCRhIyOB+fHnXLoRwvgC4rNsw=="),
    },
    data: {
      persona: {
        id: "extension:cn.review.persona.exam-coach",
        name: "申论结构教练",
        role: "关注论点、证据与段落结构的申论训练教师",
        teachingStyle: "先指出结构缺口，再要求学生用自己的表述完成修正",
        questioningStyle: "围绕中心论点、材料依据和段落功能逐步追问",
        strictness: "strict",
        verbosity: "balanced",
        customInstructions: "不代写完整答案；优先让学生先完成一个可观察的修改动作。",
        builtIn: false,
      },
    },
    assets: [],
  },
  {
    manifest: {
      schemaVersion: 1,
      id: "cn.review.study-pack.argumentation-basics",
      version: "1.0.0",
      minAppVersion: "0.1.0",
      kind: "study-pack",
      name: "申论论证基础路径",
      author: { name: "公考学习工作台" },
      description: "从材料归纳到论点、证据和微测的四步学习路径。",
      entry: "data.json",
      permissions: ["study.read"],
      assets: [],
      contentSha256: "77f37b9775df1e3a4779ad43591d2d34592ec599a6d3950b9642070a59715926",
      signature: officialSignature("2OmTj/QMEiHz0WHNNWrSph5SPqqh+juEpcI8EhG8Wfwf9OVS6XO7EPHbDCOAZbPk1bZSoMMjQgNPWOZiBJqyUw=="),
    },
    data: {
      title: "申论论证基础",
      moduleIds: ["knowledge", "tutoring", "review"],
      promptTemplate: "围绕当前材料，只选择一个论证薄弱点，先诊断，再让学习者完成一次改写，最后用微测验证。",
      steps: ["识别材料事实", "提出中心论点", "匹配证据与解释", "完成一题迁移微测"],
    },
    assets: [],
  },
];
