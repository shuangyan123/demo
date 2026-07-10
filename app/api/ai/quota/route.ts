import { NextResponse } from "next/server";
import { normalizeOpenAiCostsSnapshot } from "../../../services/ai-quota-plugins.ts";
import type { AiQuotaSnapshot, ApiProvider } from "../../../types/review";

type QuotaRequest = {
  provider?: ApiProvider | "manual";
  apiKey?: string;
  monthlyBudget?: number;
};

function monthStartUnix(today = new Date()): number {
  return Math.floor(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).getTime() / 1000);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuotaRequest;
    if (body.provider !== "openai") {
      const snapshot: AiQuotaSnapshot = {
        id: body.provider ?? "manual",
        provider: body.provider === "manual" ? "custom" : body.provider ?? "custom",
        label: "额度插件",
        status: "unsupported",
        source: "unavailable",
        sourceLabel: "unsupported",
        officialRemainingAvailable: false,
        message: "该厂商暂未启用稳定官方额度 API。",
        refreshedAt: new Date().toISOString(),
      };
      return NextResponse.json(snapshot);
    }
    if (!body.apiKey) return new NextResponse("缺少 OpenAI Admin Key", { status: 400 });
    const costsUrl = new URL("https://api.openai.com/v1/organization/costs");
    costsUrl.searchParams.set("start_time", String(monthStartUnix()));
    costsUrl.searchParams.set("bucket_width", "1d");
    const usageUrl = new URL("https://api.openai.com/v1/organization/usage/completions");
    usageUrl.searchParams.set("start_time", String(monthStartUnix()));
    usageUrl.searchParams.set("bucket_width", "1d");
    const headers = { Authorization: `Bearer ${body.apiKey}` };
    const [costsResponse, usageResponse] = await Promise.all([
      fetch(costsUrl, { headers, cache: "no-store" }),
      fetch(usageUrl, { headers, cache: "no-store" }),
    ]);
    if (!costsResponse.ok) return new NextResponse(`OpenAI 额度 API 请求失败（${costsResponse.status}）`, { status: costsResponse.status });
    if (!usageResponse.ok) return new NextResponse(`OpenAI 用量 API 请求失败（${usageResponse.status}）`, { status: usageResponse.status });
    const [costsPayload, usagePayload] = await Promise.all([costsResponse.json(), usageResponse.json()]);
    return NextResponse.json(normalizeOpenAiCostsSnapshot({ costs: costsPayload, usage: usagePayload }, {
      monthlyBudget: body.monthlyBudget,
      refreshedAt: new Date().toISOString(),
    }));
  } catch {
    return new NextResponse("额度插件刷新失败", { status: 500 });
  }
}
