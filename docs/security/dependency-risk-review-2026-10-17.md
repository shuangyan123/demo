# PR #148 依赖逐项风险审查（2026-10-17）

本审查不是风险接受。原完整审计 56 个包级 findings / 53 个公告，兼容修复后 39 个包级 findings（3 low / 10 moderate / 25 high / 1 critical）。生产审计为 0 high / 0 critical / 3 moderate。全部剩余项保持 UNRESOLVED_NOT_ACCEPTED；不因 dev 标记降低公告严重度。

同线更新：xmldom 仅覆盖 0.9 分支到 0.9.12，保留 mammoth/app-builder 的健康 0.8 分支；brace-expansion 1.1.21 / 2.1.7 / 5.0.12（保留各主版本）；browserslist 4.29.3；baseline-browser-mapping 2.11.29；http-cache-semantics 4.3.0；joi 18.3.0；ip-address 10.7.4；hono 4.13.13；js-yaml 5.5.0。所有候选 Node engine 支持固定 Node 24，未升级 Forge/Electron/Next/ESLint 主版本。

## 实际可达边界

| 公告归属包 | 暴露类别 | 实际调用路径与风险 | 状态 |
| --- | --- | --- | --- |
| @xmldom/xmldom | packaging-input | plist -> app-builder/Forge macOS metadata; attacker-controlled XML/plist can reach parser/serializer in packaging | NO_LONGER_REPORTED |
| baseline-browser-mapping | build-input | Next/PostCSS/browserslist build metadata and query mapping; not an outbound socket boundary | NO_LONGER_REPORTED |
| brace-expansion | build-pattern | minimatch in Forge, node-gyp, ESLint and app-builder; malicious build paths/globs can exhaust memory/stack | NO_LONGER_REPORTED |
| braces | build-pattern | fast-glob -> micromatch -> braces in Forge/Next lint; crafted nested repository patterns cause DoS | UNRESOLVED_NOT_ACCEPTED |
| browserslist | build-config | Next/Tailwind build target queries and custom stats; malicious configuration can crash or exhaust build process | NO_LONGER_REPORTED |
| extract-zip | downloaded-build-archive | @electron/packager/dist/unzip.js extracts the Electron ZIP downloaded through @electron/get; symlink entries can write outside destination | UNRESOLVED_NOT_ACCEPTED |
| hono | runtime-library | @modelcontextprotocol/sdk server transport dependency; application uses SDK client, but package remains runtime-shipped; patched rather than accepting route reachability assumptions | NO_LONGER_REPORTED |
| http-cache-semantics | build-download-cache | make-fetch-happen/lib/cache/policy.js under Electron node-gyp; cache policy can leak shared cached responses | NO_LONGER_REPORTED |
| ip-address | address-validation-library | express-rate-limit/dist/index.cjs and socks/build/client/socksclient.js parse IPv6/client addresses. Transitive server/proxy usage requires review; application outbound policy uses its own classifier and socket binding | NO_LONGER_REPORTED |
| joi | build-config | wait-on/lib/wait-on.js validates launcher options; unsafe messages/schema configuration and pathological values can pollute or exhaust process | NO_LONGER_REPORTED |
| js-yaml | runtime-input-parser | app/services/obsidian-markdown.ts parses/dumps user frontmatter; workflow tooling also parses repository YAML. Untrusted import input can trigger parsing/alias weaknesses | NO_LONGER_REPORTED |
| sprintf-js | runtime-and-build-formatting | mammoth/node_modules/argparse uses root sprintf-js; roarr/dist/factories/createLogger.js uses its nested copy in proxy logging. Hostile format strings require caller review; no blanket unreachable claim | UNRESOLVED_NOT_ACCEPTED |
| tar | downloaded-build-archive | @electron/rebuild/lib/clang-fetcher.js and @electron/node-gyp/lib/install.js use tar 6 for downloaded toolchains/headers. Path traversal can overwrite build host files; critical remains blocking | UNRESOLVED_NOT_ACCEPTED |
| tmp | build-editor-filesystem | external-editor/main/index.js uses tmp 0.0.33 via Inquirer/Forge interactive prompts; symlink/prefix attacks can write outside temporary directory | UNRESOLVED_NOT_ACCEPTED |

tar 6.2.1 无兼容 6.x 修复，不能强制覆盖为 7.x；extract-zip 2.0.1 与 braces 3.0.3 的公告覆盖当前最新版本；tmp 的 0.0.33 调用链没有兼容 0.0.x 修复，不能擅自跨 0.x API 线；sprintf-js 当前公告无补丁版本。上述包及其 Forge/get/packager/fast-glob/ESLint/Inquirer/代理日志等传播项继续阻断完整工具链安全验收。下载、解压和本地文件写入风险是真实构建宿主边界，摘要/固定来源只减少输入风险，不修复这些库。

## 每个公告

NO_LONGER_REPORTED 表示更新后当前 npm audit 不再报告，不代表工具链永久安全。包级传播项与完整依赖节点由工具另行输出，不能把 53 个公告或 56 个包级 findings 当成独立漏洞数量相加。

| 公告 | 归属包 | 原公告级别 | 暴露类别 | 状态 |
| --- | --- | --- | --- | --- |
| [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) | tar | critical | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-27p8-2357-5qqv](https://github.com/advisories/GHSA-27p8-2357-5qqv) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-2vr4-cq9g-pvrc](https://github.com/advisories/GHSA-2vr4-cq9g-pvrc) | ip-address | moderate | address-validation-library | NO_LONGER_REPORTED |
| [GHSA-34x7-hfp2-rc4v](https://github.com/advisories/GHSA-34x7-hfp2-rc4v) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-3px3-54cx-rmw9](https://github.com/advisories/GHSA-3px3-54cx-rmw9) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) | tmp | low | build-editor-filesystem | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) | @xmldom/xmldom | moderate | packaging-input | NO_LONGER_REPORTED |
| [GHSA-6h2x-m376-mqjq](https://github.com/advisories/GHSA-6h2x-m376-mqjq) | joi | high | build-config | NO_LONGER_REPORTED |
| [GHSA-6h8r-xr42-gp59](https://github.com/advisories/GHSA-6h8r-xr42-gp59) | @xmldom/xmldom | moderate | packaging-input | NO_LONGER_REPORTED |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | brace-expansion | high | build-pattern | NO_LONGER_REPORTED |
| [GHSA-6mj3-qw4j-hgrw](https://github.com/advisories/GHSA-6mj3-qw4j-hgrw) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-6w3j-5fw6-r9vr](https://github.com/advisories/GHSA-6w3j-5fw6-r9vr) | joi | low | build-config | NO_LONGER_REPORTED |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | browserslist | high | build-config | NO_LONGER_REPORTED |
| [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) | extract-zip | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-9ppj-qmqm-q256](https://github.com/advisories/GHSA-9ppj-qmqm-q256) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-c7q8-3ch8-vqpv](https://github.com/advisories/GHSA-c7q8-3ch8-vqpv) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | browserslist | high | build-config | NO_LONGER_REPORTED |
| [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) | http-cache-semantics | high | build-download-cache | NO_LONGER_REPORTED |
| [GHSA-crvj-82cr-hjcx](https://github.com/advisories/GHSA-crvj-82cr-hjcx) | hono | moderate | runtime-library | NO_LONGER_REPORTED |
| [GHSA-g53g-w8rj-fmg7](https://github.com/advisories/GHSA-g53g-w8rj-fmg7) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-g6gw-c38x-mqfc](https://github.com/advisories/GHSA-g6gw-c38x-mqfc) | hono | moderate | runtime-library | NO_LONGER_REPORTED |
| [GHSA-gg4h-3hg2-grpc](https://github.com/advisories/GHSA-gg4h-3hg2-grpc) | joi | low | build-config | NO_LONGER_REPORTED |
| [GHSA-gqvv-2mrq-wpjv](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv) | hono | moderate | runtime-library | NO_LONGER_REPORTED |
| [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j) | tar | moderate | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw) | ip-address | moderate | address-validation-library | NO_LONGER_REPORTED |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | sprintf-js | moderate | runtime-and-build-formatting | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-hxh3-vqpv-xpqv](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv) | hono | moderate | runtime-library | NO_LONGER_REPORTED |
| [GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) | ip-address | moderate | address-validation-library | NO_LONGER_REPORTED |
| [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) | extract-zip | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | brace-expansion | high | build-pattern | NO_LONGER_REPORTED |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | tmp | high | build-editor-filesystem | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | brace-expansion | moderate | build-pattern | NO_LONGER_REPORTED |
| [GHSA-qffp-2rhf-9h96](https://github.com/advisories/GHSA-qffp-2rhf-9h96) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | brace-expansion | high | build-pattern | NO_LONGER_REPORTED |
| [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) | js-yaml | moderate | runtime-input-parser | NO_LONGER_REPORTED |
| [GHSA-r6q2-hw4h-h46w](https://github.com/advisories/GHSA-r6q2-hw4h-h46w) | tar | high | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | brace-expansion | high | build-pattern | NO_LONGER_REPORTED |
| [GHSA-rpw4-54j3-4h4q](https://github.com/advisories/GHSA-rpw4-54j3-4h4q) | ip-address | moderate | address-validation-library | NO_LONGER_REPORTED |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces | high | build-pattern | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-vmf3-w455-68vh](https://github.com/advisories/GHSA-vmf3-w455-68vh) | tar | moderate | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-vr34-hp96-76pp](https://github.com/advisories/GHSA-vr34-hp96-76pp) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-w2rr-34g9-rvrj](https://github.com/advisories/GHSA-w2rr-34g9-rvrj) | @xmldom/xmldom | high | packaging-input | NO_LONGER_REPORTED |
| [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | baseline-browser-mapping | moderate | build-input | NO_LONGER_REPORTED |
| [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp) | tar | moderate | downloaded-build-archive | UNRESOLVED_NOT_ACCEPTED |
| [GHSA-wr44-6hxh-3jwq](https://github.com/advisories/GHSA-wr44-6hxh-3jwq) | joi | moderate | build-config | NO_LONGER_REPORTED |

## 复核

`npm audit --json --fetch-timeout=30000 --fetch-retries=0` 保留原始有效响应，非零退出不能写成通过。`node scripts/dependency-risk-review.mjs before.json after.json` 输出全部包级 findings、具体 node_modules 路径、继承公告、风险分类和未接受状态；新未知公告归属、缺失依赖边、畸形响应或无根环会失败。输出只有审计字段，不采集 env、凭据或用户数据。原始报告和完整分类留在验收证据，不将大型审计生成物提交进 Git。

固定 5c1e28c 安装验收验证的是先前 CI 产物；依赖变更后的新 PR HEAD 必须单独通过静态、contracts、构建、E2E 和 NSIS 构建，不能复用旧 artifact 宣称新依赖已安装验收。
