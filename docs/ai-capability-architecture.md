# AI Capability Architecture

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

## What Phase 1 does not abstract

Phase 2 remains responsible for broader provider request/response/stream/error normalization, including authentication, quota, rate-limit, availability, malformed-response, and interrupted-stream taxonomy. Phase 1 does not change Dexie v16, credentials, HTTP success schemas, Electron, MCP permissions, provider inventory, automatic fallback, model routing, or benchmark execution.
