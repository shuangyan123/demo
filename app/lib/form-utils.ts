// 把用户输入的逗号、分号、顿号或换行分隔内容整理成字符串数组，统一标签和错因解析规则。
export function splitInput(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 从 FormData 中安全读取并裁剪文本值，避免每个表单重复处理空值。
export function textValue(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

// 把数组展示成表单可编辑文本；保存时再由 splitInput 统一拆回数组。
export function toListText(items: string[]): string {
  return items.join("，");
}
