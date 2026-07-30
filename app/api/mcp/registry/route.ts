import { NextRequest } from "next/server";
import { queryOfficialMcpRegistry } from "../../../server/mcp/registry-client.ts";
import { apiErrorResponse, apiJsonResponse } from "../../../server/http/route-security.ts";

export const runtime = "nodejs";

/** 只代理固定的官方 MCP Registry，并对查询、游标、超时、体积与缓存设限。 */
export async function GET(request: NextRequest) {
  try {
    const page = await queryOfficialMcpRegistry({
      query: request.nextUrl.searchParams.get("query") ?? "",
      cursor: request.nextUrl.searchParams.get("cursor") ?? "",
    });
    return apiJsonResponse(page);
  } catch (error) {
    return apiErrorResponse(error, {
      code: "mcp_registry_unavailable",
      message: error instanceof Error ? error.message : "MCP Registry 暂时不可用",
      status: 502,
      retryable: true,
    });
  }
}
