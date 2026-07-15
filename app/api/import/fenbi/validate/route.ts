import { NextResponse } from "next/server";
import { FenbiAccountImportAdapter, FenbiAccountImportError } from "@/app/server/import/fenbi-account-import-adapter";

export const runtime = "nodejs";

/** 验证粉笔 Cookie；服务端不保存 Cookie，也不返回上游原始响应。 */
export async function POST(request: Request) {
  try {
    const input = await request.json() as { cookie?: string };
    await new FenbiAccountImportAdapter().validate(input.cookie ?? "", request.signal);
    return NextResponse.json({ valid: true });
  } catch (error) {
    const known = error instanceof FenbiAccountImportError ? error : new FenbiAccountImportError("upstream_unavailable", "粉笔验证失败，请稍后重试。", 502);
    return NextResponse.json({ valid: false, code: known.code, message: known.message }, { status: known.status });
  }
}
