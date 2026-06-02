import { NextResponse } from "next/server";

// 代理浏览器发来的 OpenAI-compatible 请求；只转发当前请求中的 Key，不在服务端持久化。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      messages?: unknown[];
    };

    if (!body.apiKey || !body.baseUrl || !body.model || !Array.isArray(body.messages)) {
      return new NextResponse("缺少 API 配置或消息内容", { status: 400 });
    }

    const baseUrl = body.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return new NextResponse(text || `AI API 请求失败：${response.status}`, { status: response.status });
    }

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return NextResponse.json({ content: json.choices?.[0]?.message?.content ?? "" });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "AI API 请求失败", { status: 500 });
  }
}
