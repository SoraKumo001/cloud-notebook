# Hallucination Guard Strategy — Design Notes

> **Status**: Design-phase. Implementation deferred to L3 (RAG chat handler).  
> **Scope**: M2 RAG MVP with Workers AI `@cf/meta/llama-3-8b-instruct`.

---

## 1. Layered Defense Model

Hallucination prevention is organized into three layers, from strongest
(prevention) to weakest (post-hoc detection):

```
Layer 1 — PREVENTION (prompt engineering)
  ├─ System prompt constrains model to context-only answers
  ├─ Explicit "I don't know" fallback instruction
  └─ Citation-enforced factuality (every claim needs a [N])

Layer 2 — DETECTION (output validation)
  ├─ Citation existence check (does [N] map to a real chunk?)
  ├─ Similarity-score threshold gating
  └─ Heuristic pattern matching (fabricated entities, dates)

Layer 3 — REMEDIATION (post-processing)
  ├─ Strip non-existent citations → "[citation missing]"
  ├─ Append low-confidence disclaimer
  └─ Log anomaly for prompt tuning feedback loop
```

---

## 2. Out-of-Context Answer Detection

### 2.1 Prompt-Level Prevention (Primary)

The system prompt explicitly instructs the model:

> "If the answer cannot be found in the context, respond with:
>  'The provided documents do not contain that information.'"

This is the **first and best** line of defense. Llama-3-8B-Instruct
generally follows this instruction well when the context is genuinely
unrelated to the question.

### 2.2 Citation Gap Detection (Secondary)

After the LLM returns an answer, we run `validateCitations()` to check
whether every `[N]` reference in the response maps to an actual chunk
that was provided in the context.

- If the model cites `[7]` but only 5 chunks were provided → fabricated.
- If no citations at all but the answer is assertive → possible
  hallucination (flag for review, but don't reject outright since
  some questions truly don't require specific citations).

### 2.3 Similarity Threshold Gating

Vectorize returns a `score` (cosine similarity) per matched vector.
Before passing chunks to the LLM, the chat handler should:

```typescript
// Pseudo-code (actual implementation in L3 chat handler)
const MIN_SIMILARITY = 0.5;   // conservative for MVP
const relevantChunks = vectorResults
  .filter((r) => r.score >= MIN_SIMILARITY)
  .slice(0, 5);               // top-5 to stay within context window
```

If **zero** chunks pass the threshold, the system should short-circuit
and return: *"The provided documents do not contain relevant information."*
— without calling the LLM at all.

The scores are also passed to `assessHallucinationRisk()` so the caller
can decide whether to annotate the answer with a confidence indicator.

| Max Similarity | Interpretation | Action |
|:---|:---|:---|
| ≥ 0.7 | High confidence | Show answer normally |
| 0.5 – 0.7 | Medium confidence | Show answer with subtle indicator |
| 0.3 – 0.5 | Low confidence | Show answer + "⚠️ limited relevance" note |
| < 0.3 | Very low | Short-circuit (don't call LLM) |

*(Thresholds are tunable and should be adjusted after observing real
query behavior.)*

---

## 3. Citation Verification

### 3.1 Detection

`extractCitations()` uses a regex to find all `[N]`, `[N,M]`, and
`[N-M]` patterns in the LLM output.  `validateCitations()` then
cross-references them against the actual chunk count (1-indexed).

### 3.2 Sanitization

`sanitizeCitations()` replaces invalid citation patterns with
`[citation missing]` so the user sees that the model attempted to cite
something nonexistent.  This is a visible signal that the answer may be
unreliable.

### 3.3 Edge Cases

| Case | Behavior |
|:---|:---|
| Zero context chunks provided | `validateCitations` returns no valid citations; any citation is flagged |
| Model cites `[0]` | Flagged as invalid (chunks are 1-indexed) |
| Model cites `[1, 2, 5-7]` but only 4 chunks | `5,6,7` flagged as invalid |
| Model uses different bracket style (`(1)`, `{1}`) | Not captured — model is instructed to use `[N]` format |

---

## 4. Confidence Scoring Approach

### 4.1 Vectorize Cosine Similarity (Primary)

The Vectorize `query()` response includes a `score` field (0.0–1.0).
We use two aggregate metrics:

- **Max similarity**: The single best-matching chunk.  If this is low,
  nothing in the knowledge base resembles the query.
- **Mean similarity of top-k**: Controls for the case where one chunk
  happens to match well but the rest are noise.

### 4.2 Composite Confidence (Future Enhancement)

For M2, we keep it simple with the threshold table above.  A v2
improvement could combine:

```
confidence = w1 * max_similarity
           + w2 * mean_similarity
           + w3 * (1 - invalid_citation_ratio)
           + w4 * (entity_overlap_ratio)
```

Where `entity_overlap_ratio` is the fraction of named entities in the
answer that appear verbatim in at least one context chunk.

---

## 5. Output Post-Processing Pipeline

The L3 chat handler should run this pipeline on every LLM response:

```
Raw LLM Output
  │
  ├─ 1. sanitizeCitations()        → strip fabricated citations
  │
  ├─ 2. validateCitations()        → log metrics for monitoring
  │
  ├─ 3. assessHallucinationRisk()  → compute risk level
  │
  ├─ 4. (if risk >= medium)        → prepend disclaimer
  │      "⚠️ Some parts of this answer may not be supported by the documents."
  │
  └─ 5. Return to client           → { answer, citations, risk }
```

### 5.1 Disclaimer Wording

| Risk | Disclaimer |
|:---|:---|
| Low | (none — answer shown as-is) |
| Medium | "Note: Some citations in this answer could not be verified against the source documents." |
| High | "⚠️ This answer may be unreliable. The provided documents may not fully support the response." |

---

## 6. Monitoring & Feedback Loop

For continuous improvement, the L3 handler should log (to console or
an analytics binding) every instance where:

- `invalid.length > 0` (fabricated citations)
- `risk === 'high'` (potential hallucination)
- Model returns the "I don't know" disclaimer (track how often context is insufficient)

This data will inform:
- Prompt tuning
- Similarity threshold adjustments
- Chunk size / chunking strategy refinements

---

## 7. Limitations (MVP)

| Limitation | Impact | Mitigation |
|:---|:---|:---|
| No semantic entailment check | Model could paraphrase a chunk's opposite meaning and we wouldn't catch it. | Citation verification partially mitigates; full NLI is overkill for MVP. |
| Regex-based citation parsing | Won't catch `(see chunk 3)` or `as shown above`. | Prompt instructs model to use `[N]` format exclusively. |
| Single-language prompt | Japanese / multilingual queries may get degraded "I don't know" responses. | Acceptable for MVP English-first focus. |
| No streaming post-processing | `sanitizeCitations` processes the full text; not stream-friendly. | M2 MVP uses non-streaming; streaming support deferred to M3+. |
