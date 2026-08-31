import { getProviderContract } from "../../services/provider-contracts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";

const providerCollator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * 只负责从当前连接快照推导顺序；selector 在 CLOSED -> OPEN 时调用一次，
 * picker 在一次打开会话内只消费返回的不可变数组。
 */
export function getConversationModelProviderOrder(
  connections: ApiConnectionProfile[],
  purpose: AiConnectionPurpose,
  selectedConnectionId?: string,
): readonly ApiProvider[] {
  const eligible = connections.filter((connection) => connection.capabilities.includes(purpose));
  const selectedProvider = eligible.find((connection) => connection.id === selectedConnectionId)?.provider;
  return Object.freeze(Array.from(new Set(eligible.map((connection) => connection.provider))).sort((left, right) => {
    if (left === selectedProvider) return -1;
    if (right === selectedProvider) return 1;
    return providerCollator.compare(getProviderContract(left).label, getProviderContract(right).label);
  }));
}
