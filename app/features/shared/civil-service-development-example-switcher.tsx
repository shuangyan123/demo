"use client";

import type { ViewKey } from "../../types/domains/workspace.ts";
import {
  developmentExamplesForCivilServiceModule,
} from "./development-example-registry";
import { DevelopmentExampleSwitcher, useDevelopmentExample } from "./development-example-switcher";

/** 公考模块只展示自己的开发示例入口；没有注册场景的模块保持真实界面。 */
export function CivilServiceDevelopmentExampleSwitcher({
  initialValue,
  view,
}: {
  initialValue?: string;
  view: ViewKey;
}) {
  const options = developmentExamplesForCivilServiceModule(view);
  const example = useDevelopmentExample(initialValue, options);
  if (!example.enabled || !options.length) return null;
  return <DevelopmentExampleSwitcher options={options} value={example.value} onChange={example.select} />;
}
