# Recall Wave 3 / S1 — Learner-State Scalability and Determinism

This note records the implementation based on the exact Wave 2 parent
`76006a365ee0a907090c8a01c291fa121ea7ab5b`.

## Bounded LearningEvent reads

Before S1, learner-state loaded one LearningEvent query per filtered mistake
or knowledge subject (`N` subject queries). S1 adds
`learningEventRepository.listForSubjects(subjects)` and keeps
`listForSubject(...)` compatible by delegating to it.

The repository canonicalizes and sorts unique subject references, then reads
the existing `[subjectType+subjectId]` compound index with `anyOf(...)` in
fixed batches of 256 keys. Empty input performs no event query. Returned
persisted rows are filtered to the requested exact subject keys and retain the
repository's deterministic newest ordering.

| unique subject keys | bounded event-query batches |
| ---: | ---: |
| 0 | 0 |
| 1 | 1 |
| 256 | 1 |
| 257 | 2 |
| 1,000 | 4 |

No table, index, migration, schema version, denormalized cache, or persisted
learner-state snapshot was added. Dexie remains v17.

## Weakness derivation

Before S1, each subject assessment rescanned the complete canonical
LearningEvent array with `events.filter(...)`. S1 groups the already
canonical and deterministically ordered events once in a
`Map<subjectType:subjectId, LearningEvent[]>`, then performs direct lookup for
each subject. This eliminates N×E subject/event rescanning; existing
deterministic sorting costs remain.

The grouping change preserves unique-event selection, event ordering,
same-day collapse, the eight distinct-study-day window, risk scoring,
recovery guard, repeated-reason clusters, and explicit `errorCause` clusters.

## Due-review determinism

For `due_review` signal evidence, each category now derives its evidence,
orders it by descending `observedAt`, then canonical evidence type and ID, and
takes at most two entries. The underlying due arrays are not reordered. Due
counts, recommendation targets, priorities, and recommendation ordering are
unchanged under equivalent input permutations.

## Preserved invariants and deferred work

S1 does not change L2 mastery/interval/lapse/streak or same-day policy, the L3
Tutor Protocol or micro-assessment authority, L4 formulas and eligibility, L5
metrics or presentation semantics, source-record counting, Attempt and
KnowledgeAttempt authority, LearningEvent optional metadata merging, study-day
semantics, or personal/ui-review/sample provenance isolation.

The following remain deferred:

- broader review/knowledge snapshot I/O optimization;
- CSS budget cleanup;
- L5 wording/range semantics debt;
- historical `errorCause` “current” wording;
- general locale ordering debt;
- retention and calibration features.
