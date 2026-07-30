"use client";

import type { SyntheticEvent } from "react";
import { Button, DataList, EmptyState, Panel, SelectField, TextField } from "../shared/ui-primitives";
import { textValue } from "../../lib/form-utils";
import type { InterviewLink, InterviewLinkSourceType, InterviewLinkTargetType } from "../../types/domains/interview.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

// 面试关联面板负责把面试题/面试记录与知识库或错题建立确认式关系。
export function InterviewLinkPanel({
  links,
  mistakes,
  knowledgeEntries,
  sourceId,
  sourceType,
  onAddLink,
  onDeleteLink,
}: {
  links: InterviewLink[];
  mistakes: Mistake[];
  knowledgeEntries: KnowledgeEntry[];
  sourceId: string;
  sourceType: InterviewLinkSourceType;
  onAddLink: (input: Omit<InterviewLink, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
}) {
  // 提交关联表单，目标只允许选择现有知识资料或错题，避免悬空链接。
  async function submitLink(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const targetValue = textValue(formData.get("target"));
    if (!targetValue) return;
    const [targetType, targetId] = targetValue.split(":") as [InterviewLinkTargetType, string];
    await onAddLink({
      evidence: [],
      reason: textValue(formData.get("reason")) || "面试复盘时手动关联",
      score: 80,
      sourceId,
      sourceType,
      targetId,
      targetType,
    });
    form.reset();
  }

  const targetOptions: Array<[string, string]> = [
    ...knowledgeEntries.map((entry): [string, string] => [`knowledge:${entry.id}`, `知识：${entry.title}`]),
    ...mistakes.map((mistake): [string, string] => [`mistake:${mistake.id}`, `错题：${mistake.stem.slice(0, 28)}`]),
  ];

  return (
    <Panel eyebrow="LINKS" title="关联知识与错题">
      <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitLink}>
        <SelectField label="关联目标" name="target" options={targetOptions.length ? targetOptions : [["", "暂无可关联数据"]]} />
        <TextField label="关联原因" name="reason" placeholder="例如：答题论证可参考该知识点" />
        <div className="flex items-end">
          <Button disabled={!targetOptions.length} type="submit" variant="primary">
            保存关联
          </Button>
        </div>
      </form>

      <DataList className="mt-4">
        {links.length ? (
          links.map((link) => {
            const target =
              link.targetType === "knowledge"
                ? knowledgeEntries.find((entry) => entry.id === link.targetId)?.title
                : mistakes.find((mistake) => mistake.id === link.targetId)?.stem;
            return (
              <article key={link.id} className="ui-list-row">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{link.targetType === "knowledge" ? "知识资料" : "错题"}</p>
                  <p className="mt-1 truncate text-sm text-foreground">{target ?? "目标已不存在"}</p>
                  <p className="mt-1 text-xs text-muted">{link.reason}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void onDeleteLink(link.id)}>
                  删除
                </Button>
              </article>
            );
          })
        ) : (
          <EmptyState reviewPack="interview" stateId="interview.links.empty">还没有确认关联，可把面试题或复盘记录连接到知识库与错题。</EmptyState>
        )}
      </DataList>
    </Panel>
  );
}
