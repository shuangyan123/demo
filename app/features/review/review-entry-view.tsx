"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Button, SelectField, TextAreaField, TextField } from "../shared/ui-primitives";
import { BOARD_OPTIONS } from "../../types/review";
import styles from "./review-entry-view.module.css";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

// 手动录入页只负责收集表单字段；校验、复盘日期计算和 IndexedDB 写入由主工作台处理。
export function EntryView({ onSubmit }: { onSubmit: (event: SubmitReactEvent) => void }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  return (
    <section className={styles.workspace}>
      <header className={styles.header}>
        <div><h1>手动录入</h1><p>补充一条错题草稿；保存后继续沿用现有复盘结构。</p></div>
      </header>
    <form
      ref={formRef}
      className={styles.form}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        onSubmit(event);
        setDirty(false);
      }}
    >
      <div className={styles.meta}>
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
      <div className={styles.twoColumns}>
        <TextAreaField label="答案" name="answer" placeholder="B / 13.3%" required />
        <TextField label="错因" name="reason" placeholder="审题偏差、公式混淆" required />
      </div>
      <TextAreaField label="解析" name="explanation" placeholder="错在哪里、下次怎么识别、关键公式" />
      <div className={styles.actions}>
        <Button type="reset" variant="outline" onClick={() => setDirty(false)}>
          清空
        </Button>
        <Button type="submit" variant="primary">
          保存错题
        </Button>
      </div>
    </form>
    </section>
  );
}
