"use client";

import type { SyntheticEvent } from "react";
import { Button, SelectField, TextAreaField, TextField } from "../shared/ui-primitives";
import { BOARD_OPTIONS } from "../../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

// 手动录入页只负责收集表单字段；校验、复盘日期计算和 IndexedDB 写入由主工作台处理。
export function EntryView({ onSubmit }: { onSubmit: (event: SubmitReactEvent) => void }) {
  return (
    <form className="ui-panel grid max-w-5xl gap-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <SelectField label="板块" name="board" defaultValue="常识判断" options={[...BOARD_OPTIONS]} />
        <TextField label="来源" name="source" placeholder="专项练习 / 模拟卷 / 截图整理" />
        <TextField label="标签" name="tags" placeholder="增长率、比重、易混概念" />
        <SelectField
          label="初始掌握度"
          name="mastery"
          defaultValue="3"
          options={[
            ["1", "1 - 需要重学"],
            ["2", "2 - 有印象"],
            ["3", "3 - 巩固中"],
            ["4", "4 - 较稳定"],
            ["5", "5 - 已掌握"],
          ]}
        />
      </div>
      <TextAreaField label="题干" name="stem" placeholder="粘贴题干或复盘摘要" required />
      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <TextAreaField label="答案" name="answer" placeholder="B / 13.3%" required />
        <TextField label="错因" name="reason" placeholder="审题偏差、公式混淆" required />
      </div>
      <TextAreaField label="解析" name="explanation" placeholder="错在哪里、下次怎么识别、关键公式" />
      <div className="flex justify-end gap-3">
        <Button type="reset" variant="outline">
          清空
        </Button>
        <Button type="submit" variant="primary">
          保存错题
        </Button>
      </div>
    </form>
  );
}
