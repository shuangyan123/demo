# 0.5.x AI capability architecture

## Phase 1 scope

Phase 1 establishes conservative model facts, protocol facts, effective capability resolution, and runtime-value validation. It does not rewrite provider request/response/stream/error adapters, add providers, route models automatically, or implement benchmarks.

```text
Business requirement
  -> model capability profile
  -> provider protocol capability profile
  -> effective capability resolution
  -> validated normalized runtime values
  -> existing provider mapper and adapter
```

## Capability fact sources

`providerContracts[].modelCatalog` remains the verified static model source. Exact catalog entries own modalities, lifecycle, generation protocol, context window, and maximum output facts. `resolveModelCapabilityProfile()` derives the tri-state profile consumed by request guards and tests; it does not create another persisted model database.

Official model discovery proves that a model identifier is exposed. It only contributes optional capability facts when the provider returns explicit metadata and the directory labels the source accordingly. Model discovery is not capability discovery.

Runtime descriptors own only the validated value domains for reasoning and speed. They no longer duplicate model modalities or numeric limits. Voice-specific synthesis fields remain outside the generation contract because they belong to the existing speech adapter.

## Supported, unsupported, and unknown

- `supported`: an exact verified catalog fact or explicit provider metadata proves the capability.
- `unsupported`: an exact verified catalog entry omits the capability, or the current protocol implementation explicitly cannot encode it.
- `unknown`: the repository has no reliable fact.

`unknown != unsupported`, and unknown is never promoted to supported by a model name, provider name, familiar prefix, or compatible endpoint. The only conservative minimum for an otherwise unknown selected generation model is text generation, because the existing connection contract and generation protocol require it. All optional capabilities remain unknown.

## Model capability vs protocol capability

Model capability describes what the model can do. Protocol capability describes what the current project adapter can encode and execute. `resolveEffectiveCapability()` computes their conservative intersection and preserves one of these reasons:

- `model-capability-unsupported`
- `model-capability-unknown`
- `protocol-capability-unsupported`
- `protocol-capability-unknown`

Only `supported + supported` is available. A protocol limitation must not be reported as a model limitation.

## Runtime value validation

The generation boundary resolves the concrete model before reading its secret. Explicit `selectedRuntimeValues` then pass through the exact runtime descriptor and effective protocol capability:

```text
requested values
  -> capability validation
  -> value-domain validation
  -> normalized values and defaults
  -> provider-specific mapper
```

Supported values are preserved. Unsupported, unknown, and out-of-range explicit values produce stable typed failures; they are not silently dropped or replaced. The server mapper repeats the validation so a forged browser request cannot bypass the contract.

## Custom-compatible conservative defaults

Custom and compatible endpoints do not inherit native model facts even when the model ID resembles an official model. Text generation remains available as the protocol minimum. Vision, structured output, streaming, reasoning, speed, audio, tools, and numeric limits remain unknown unless an existing trusted fact source proves them. Existing custom connection capability selections are preserved in storage; they do not become verified model facts.

For business-owned JSON prompts, unknown structured-output support degrades to an ordinary text request with a provider-neutral JSON Schema instruction and omits provider-specific structured-output parameters. The capability fact remains unknown, and the existing response parser still validates the returned JSON. Vision requests and explicit runtime controls do not use this fallback.

Provider protocol compatibility is not model capability equivalence.

## Numeric limit policy

Context-window and maximum-output values exist only when an exact catalog or trusted provider metadata fact supplies them. Unknown models have no synthetic 128K, 1M, 32K, or 4096 fallback.

## Connection-scoped capability resolution

Runtime decisions that depend on discovered metadata use `resolveConnectionModelCapabilityProfile(connection, modelId)`. The resolver combines the verified static catalog with trusted provider metadata cached for the exact connection identity, then returns one `ModelCapabilityProfile` for both pre-routing and the generation contract.

UI consumers must not read `providerModelCache` directly. With no cache entry, resolution falls back to the same static-catalog or conservative unknown result as the pure model resolver. Cache lookup remains scoped by connection ID, provider, and normalized base URL, so compatible endpoints with the same model ID cannot share capability facts.

## Credentials and reasoning privacy

Capability profiles contain no API key, authorization header, encrypted credential, provider private state, user prompt, or raw response. Secret resolution stays in `ai-connection-client` after capability validation.

Reasoning capability only controls public request configuration. It does not grant access to hidden chain-of-thought. Hidden reasoning text, thought signatures, and provider-private reasoning metadata must not enter UI state, learning context, or persistence.

## Consumer behavior

Conversation, Tutoring, Interview, Automation, Import, and other business services continue to call `generateWithConnection`. Text-only flows retain the existing request shape. Known vision models continue through the existing multimodal payload path. Unsupported or unknown vision fails before secret decryption and before the provider request.

Phase 2 below completes the provider protocol normalization that Phase 1 deliberately left unchanged.

## Phase 2 scope

Phase 2 (`Provider Request / Response / Stream / Error Normalization`) establishes the boundary between application behavior and provider protocols. The existing provider registry remains the composition point; this phase does not add a provider, change the Dexie schema, introduce a retry manager, or add provider fallback.

The dependency direction is:

```text
feature / application
  -> AiGenerateRequest and normalized result/event
  -> /api/ai/generate
  -> ProviderAdapter
  -> ProviderTransport
  -> provider
```

## Normalized request

`AiGenerateRequest` is the single application-facing generation input. It contains business-neutral fields (`messages`, `model`, `maxOutputTokens`, `temperature`, `structuredOutput`, `stream`, and normalized runtime values) plus connection transport fields needed for one in-memory request (`provider`, `apiKey`, `baseUrl`, `providerOptions`).

Provider-specific request fields are created only by `app/server/ai/provider-adapter.ts` and the allow-listed runtime mappers. `providerOptions` is never spread into a provider body. The adapter selects the endpoint, authentication header, message shape, token field, structured-output field, and stream flag for the selected protocol.

The seven native registrations are OpenAI Responses, Google model-routed GenerateContent/Interactions, Anthropic Messages, DeepSeek Chat Completions, GLM/Zhipu Chat Completions, MiniMax Messages, and xAI Responses. Unknown or user-defined connections use the explicit custom Chat Completions compatibility boundary; they are not silently treated as a native provider.

Provider HTTP uses the request-scoped DNS/socket binding described in [the private Pilot security boundary](recall-0.3.1-windows-pilot.md#aud-10-security-boundary). Google Interactions uses its existing HTTP protocol adapter because the installed SDK drops the custom dispatcher when constructing a standard Request. Protocol selection, visible completion, `store:false`, normalization and zero automatic generation retries remain unchanged.

## Normalized response

`AiGenerateResult` contains only:

- `content`: visible assistant text;
- `requestId`: a safe request identifier when the provider supplies one;
- `usage`: `inputTokens`, `outputTokens`, and `totalTokens` when known;
- `actualSpeed`: a verified response-side tier when available;
- `generationProtocol`: the protocol confirmed by a connection test.

Token `0` is a valid value. An explicit provider total is preserved; a total is calculated only when both input and output counts are known. Missing usage remains `undefined`.

Response parsing is strict at the provider boundary. A successful HTTP response with no recognized response shape becomes `malformed_response`, rather than an empty assistant answer. Reasoning summaries, thinking blocks, thought-marked Gemini parts, signatures, and other non-visible content are excluded before the result leaves the adapter.

## Normalized stream

`AiGenerateStreamEvent` is limited to `status`, incremental `delta`, `usage`, `done`, and `error`.

`delta` is a newly received fragment, never the provider's full-so-far content. The route accumulates the visible fragments only to build the final `done.content`; it does not expose provider event names or raw payloads.

Completion semantics are explicit:

| Adapter protocol | Completion evidence |
| --- | --- |
| Responses / Messages | provider completion event (`response.completed` / `message_stop`) |
| Chat Completions | `finish_reason` or the provider `[DONE]` sentinel |
| Gemini GenerateContent | normal adapter-declared EOF, with a finish reason when present |
| Google Interactions | `interaction.completed` |

If a stream ends before its completion evidence, the route emits one normalized `error` with `stream_interrupted` and does not emit `done`. The client reconstructs this as `AiProviderFailureError`. A provider parse error is `malformed_response`; transport cancellation, timeout, and network failures keep their own codes.

## Provider failure taxonomy

`AiProviderFailure` is the safe cross-provider failure shape:

```ts
type AiProviderFailure = {
  code: "authentication" | "permission" | "invalid_request" | "model_not_found"
    | "rate_limit" | "quota_exhausted" | "provider_unavailable"
    | "network" | "timeout" | "cancelled" | "malformed_response"
    | "stream_interrupted" | "unknown";
  provider: ApiProvider;
  retry: "safe" | "after-delay" | "manual-only" | "no";
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  retryAfterMs?: number;
};
```

The normalized failure may include bounded, safe provider code and request metadata, but never raw error text, response body, key, authorization header, prompt, or hidden reasoning. Provider failures are returned by the local route with a stable message and HTTP 502. `AiCapabilityContractError` remains a separate HTTP 400 contract error with no provider failure object.

`retry` describes safety and intent; it does not execute a retry. Phase 2 performs no automatic retry and no provider fallback. This matters for generation requests whose side effects or billing cannot be inferred to be idempotent.

## Validation and persistence boundaries

Provider response-shape validation happens in the adapter. Business JSON validation happens later in `app/services/ai-json.ts`, after complete visible content is assembled. These failures are intentionally distinct so malformed provider protocol data is not presented as a user task's invalid JSON, and invalid business JSON is not mislabeled as a provider outage.

Conversation persistence continues to store visible user/assistant content, safe request metadata, and normalized usage only. No schema migration is part of Phase 2.

## Terminal visible-output semantics

The current text, vision, and structured-output-through-text consumers require a supported visible terminal result before a generation is considered successful. Hidden reasoning, reasoning summaries, thought signatures, usage-only data, provider completion metadata, and internal tool metadata are not assistant answers.

For non-stream responses, a recognized provider shape with no visible content fails closed as `malformed_response`; it never becomes `AiGenerateResult.content = ""`. Whitespace-only visible text is also not a successful terminal result. Explicit provider refusal or content-policy terminal outcomes remain deferred until a provider supplies a stable, recognized signal.

For streams, completion evidence and visible output are separate requirements:

- missing completion evidence is `stream_interrupted`;
- valid completion evidence without visible output is `malformed_response`;
- invalid SSE/JSON/provider shape is `malformed_response`;
- visible text followed by a valid completion produces `done`.

Usage does not change these rules. A stream with usage and completion but no visible delta is not a successful assistant turn. Business JSON validation remains a later boundary: visible text that is not valid JSON is a business parsing failure, while no visible text is a provider terminal failure.

For a recognized response shape with no visible terminal text, the normalized failure remains `malformed_response` with `providerCode = empty_visible_output`, but the safe consumer message is `模型未返回可见文本`; an invalid provider shape keeps the generic `AI 服务返回格式异常` message. Neither path exposes raw provider payloads or hidden reasoning.

The browser accepts error details from local AI routes only when they use the normalized JSON error contract. HTML or plain-text responses from a missing/stale local route are discarded rather than exposed or persisted; connection-test history also normalizes legacy HTML entries to a stable local-service recovery message on read and write.

## Consumer failure presentation

`AiProviderFailureError` and `AiProviderFailure.code` cross the local route, client, connection service, and business consumer unchanged. Its constructor rebuilds the safe product message from the failure code and optional provider code, and its typed `recoveryDiagnosis` keeps the network/model recovery mapping at the failure boundary. Conversation presentation uses the same safe mapping; Automation consumes `recoveryDiagnosis` and never reclassifies provider failures from HTTP status text, provider codes, raw provider messages, or `429`/`503`/capacity wording. Ordinary local and business errors may still display their existing safe message.

Conversation persists the user message and an error run step when an external generation fails, but it only appends an assistant message, successful usage, or completed-turn memory after visible terminal content has been validated. There is no fabricated empty assistant answer, automatic retry, provider fallback, usage-success persistence for a failed terminal result, or schema migration.

## Acceptance Matrix

| Boundary | Accepted contract | Evidence |
| --- | --- | --- |
| Capability | Exact catalog and trusted connection metadata produce `supported` / `unsupported` / `unknown`; unknown model names do not grant optional capabilities or numeric limits. | Capability resolution and connection contract tests |
| Runtime | Explicit reasoning/speed values are domain- and capability-validated before secret resolution and provider mapping; invalid, unsupported, and unknown values fail locally. | Runtime and connection-client contract tests |
| Request | Consumers construct only `AiGenerateRequest`; vendor bodies, headers, endpoints, and runtime fields are created inside the adapter boundary. | Provider adapter fixtures and consumer architecture guard |
| Response | Normalized results contain visible content and safe metadata only; recognized empty or non-visible terminal output is `malformed_response`. | Provider normalization and route contract tests |
| Stream | Only normalized `status`, `delta`, `usage`, `done`, and `error` events cross the route; completion evidence and visible output are both required. | Provider stream and route contract tests |
| Failure | `AiProviderFailure.code` and safe metadata survive route, client, connection service, and consumers; unknown stream errors are rebuilt as typed `unknown`. | Failure, client reconstruction, and consumer contract tests |
| Consumer | Conversation, Tutoring, Interview, Automation, and AI-backed Import paths use `generateWithConnection` and do not parse vendor response/SSE fields. | Architecture boundary and consumer contract tests |
| Privacy | API keys, authorization, prompts, raw provider bodies, hidden reasoning, signatures, and raw media do not cross the normalized result/failure/stream or persistence boundary. | Provider, route, and persistence contract tests |

Terminal outcome matrix:

| Situation | Normalized outcome | Business persistence |
| --- | --- | --- |
| Valid capability, runtime, provider response, and visible output | success / `done` | Success may persist normalized content and usage |
| Unsupported or unknown required capability | local capability contract failure | No provider request |
| Invalid explicit runtime value | local runtime contract failure | No provider request |
| Provider HTTP failure | typed `AiProviderFailure` | No assistant success |
| Malformed 2xx provider response | `malformed_response` | No assistant success |
| Missing stream completion evidence | `stream_interrupted` | No `done` or assistant success |
| Completed stream with no visible output | `malformed_response` | No `done` or assistant success |
| Visible output that fails a business JSON schema | business validation error | Provider normalization remains successful; caller decides recovery |

## Deferred / Residual Boundaries

- Live provider protocol drift remains a release-validation risk; acceptance uses protocol fixtures and mocked HTTP/SSE rather than paid calls.
- Provider-specific refusal and content-policy terminal normalization remains deferred until a stable cross-provider signal is verified; unsupported no-visible-output continues to fail closed.
- Provider-generation automatic retry and provider fallback remain disabled. Retry metadata is informational and does not authorize replay of generation or external side effects. The existing knowledge-evolution structured-repair retry is a separate, visible business-validation path after a visible response and is not a provider-failure recovery mechanism.
- Benchmark scoring, leaderboard/evaluation datasets, user capability overrides, and a cloud model catalog are outside 0.5.x.
- Cached provider metadata freshness continues to follow the existing connection-scoped cache lifecycle; this closure does not add a persistence table or migration.

## Evidence

Direct fixtures cover all seven native registrations and the custom compatibility path for requests, non-stream responses, incremental streams, hidden-reasoning exclusion, usage edge cases, representative provider failures, malformed responses, route interruption, client error reconstruction, and capability/business validation separation. Live paid-provider calls are intentionally outside the local contract suite.
