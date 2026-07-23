import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const appRoot = path.join(root, "app");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }))).flat();
}

function domainFor(symbol) {
  if (symbol.startsWith("Acquisition") || symbol === "AutomationCollectionConfig") return "acquisition";
  if (symbol.startsWith("AiQuota")) return "ai-quota";
  if (symbol.startsWith("PersonalMemory")) return "personal-memory";
  if (symbol.startsWith("Learner") || symbol.startsWith("TutoringMicro") || symbol === "TutoringObservation") return "learner-state";
  if (/^(?:Declarative|Extension|InstalledExtension|PersonaExtension|RubricPackExtension|StudyPackExtension|ThemeExtension)/.test(symbol)) return "declarative-extension";
  if (/^Fenbi(?:ImportCredential|Sync)/.test(symbol)) return "fenbi-import";
  if (symbol === "ApiProvider") return "ai-provider";
  if (/^(?:AiGenerationProtocol|AiModelReasoningDescriptor|AiModelRuntime|AiSelectedRuntimeValues)/.test(symbol)) return "ai-model";
  if (symbol.startsWith("Interview")) return "interview";
  if (symbol.startsWith("Tutoring")) return "tutoring";
  if (symbol.startsWith("Obsidian") || symbol.startsWith("KnowledgeEvolution")) return "obsidian";
  if (/^(?:Persona|Personalization|CustomPersona|VoiceProfile)/.test(symbol)) return "personalization";
  if (/^(?:Appearance|Theme|ReducedMotion|DifferenceMarker|PetPreference)/.test(symbol)) return "appearance";
  if (symbol.startsWith("Automation")) return "automation";
  if (/^(?:AiConversation|AiProject|Codex|CommandSearch)/.test(symbol)) return "conversation";
  if (symbol.startsWith("Mcp")) return "mcp";
  if (/^(?:RealtimeVoice|VoiceProviderDescriptor)/.test(symbol)) return "voice";
  if (/^(?:ActiveApiProvider|AiProviderCatalogEntry|AiModelCatalogEntry)/.test(symbol)) return "provider-catalog";
  if (/^(?:Api|AiConnection|AiUsage|AiRuntimeModelSelection)/.test(symbol) || symbol === "AiCapability") return "ai-connection";
  if (/^(?:Import|PersistedImport|FenbiParseResult)/.test(symbol)) return "import";
  if (symbol.startsWith("Association") || symbol === "KnowledgeMistakeLink") return "association";
  if (symbol.startsWith("Knowledge") || symbol === "KNOWLEDGE_CATEGORIES") return "knowledge";
  if (/^(?:Study|ScheduledWorkspaceState|ViewKey)/.test(symbol)) return "workspace";
  if (/^(?:BOARD_OPTIONS|Board|Attempt|BulkSelectionState|ExportFormat|ExportScope|Filters|Mistake|Review)/.test(symbol)) return "review";
  return "legacy-review";
}

function modulePath(file, domain, alias) {
  if (alias) return `@/app/types/domains/${domain}`;
  let relative = path.relative(path.dirname(file), path.join(appRoot, "types", "domains", domain)).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

/** 只重写命名 import 声明，保留文件其余格式和注释。 */
async function migrate(file) {
  if (file.includes(`${path.sep}types${path.sep}`)) return 0;
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements = [];

  for (const node of sourceFile.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (!/(?:^|\/)types\/review(?:\.ts)?$/.test(node.moduleSpecifier.text)) continue;
    const clause = node.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.name) {
      throw new Error(`无法迁移非命名导入: ${file}:${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`);
    }
    const groups = new Map();
    for (const specifier of clause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const domain = domainFor(imported);
      const entries = groups.get(domain) ?? [];
      entries.push({
        imported,
        local: specifier.name.text,
        typeOnly: clause.isTypeOnly || specifier.isTypeOnly,
      });
      groups.set(domain, entries);
    }
    const alias = node.moduleSpecifier.text.startsWith("@/");
    const declarations = [...groups.entries()].map(([domain, entries]) => {
      const allTypeOnly = entries.every((entry) => entry.typeOnly);
      const names = entries.map((entry) => {
        const name = entry.imported === entry.local ? entry.imported : `${entry.imported} as ${entry.local}`;
        return !allTypeOnly && entry.typeOnly ? `type ${name}` : name;
      }).join(", ");
      return `import${allTypeOnly ? " type" : ""} { ${names} } from "${modulePath(file, domain, alias)}";`;
    }).join("\n");
    replacements.push({ start: node.getStart(sourceFile), end: node.end, text: declarations });
  }

  if (!replacements.length) return 0;
  let output = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  await writeFile(file, output, "utf8");
  return replacements.length;
}

let migrated = 0;
const files = await sourceFiles(appRoot);
for (const file of files) migrated += await migrate(file);

// Node 契约测试不使用 bundler；领域入口必须保留显式 `.ts` 扩展。
for (const file of files) {
  const source = await readFile(file, "utf8");
  let output = source.replace(/(from\s+["'][^"']*types\/domains\/[a-z0-9-]+)(?=["'])/gi, "$1.ts");
  if (file.includes(`${path.sep}types${path.sep}domains${path.sep}`)) {
    output = output.replace(/(from\s+["']\.\/[a-z0-9-]+)(?=["'])/gi, "$1.ts");
  }
  const sourceFile = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true);
  const invalidTsxImports = [];
  for (const node of sourceFile.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    if (!specifier.startsWith(".") || !specifier.endsWith(".ts")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    try {
      await access(target);
    } catch {
      try {
        await access(`${target}x`);
        invalidTsxImports.push({
          start: node.moduleSpecifier.getStart(sourceFile) + 1,
          end: node.moduleSpecifier.end - 1,
          text: specifier.slice(0, -3),
        });
      } catch {
        // 不是误改的 TSX 导入，交给后续 typecheck 报告真实缺失。
      }
    }
  }
  for (const replacement of invalidTsxImports.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  if (output !== source) await writeFile(file, output, "utf8");
}
console.log(`已迁移 ${migrated} 个兼容类型 import。`);
