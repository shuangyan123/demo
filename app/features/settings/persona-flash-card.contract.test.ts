import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** 读取角色卡源码，锁定空白卡只显示可访问上传入口的约定。 */
test("空白闪卡不再渲染默认提示和角色名", async () => {
  const source = await readFile(new URL("./persona-flash-card.tsx", import.meta.url), "utf8");
  assert.equal(source.includes(">添加角色图片<"), false);
  assert.match(source, /imageSrc \? <span className="persona-card-name/);
  assert.match(source, /persona-card-placeholder-plus">＋/);
});
