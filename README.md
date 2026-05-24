# prompt

A tiny, ergonomic tagged-template utility for assembling LLM prompts in TypeScript.

It turns this:

```ts
const p = ai`
  You are a helpful assistant.

  Context:
  > ${context}

  Items:
  - ${items}

  Schema:
  ${UserSchema}
`
```

...into a clean, well-indented prompt string ready to send to a model.

The library is intentionally small: a single tagged template (`prompt` / `ai`) plus a factory (`promptCreate`) for advanced configuration. All conditionals, loops, and composition stay in plain JavaScript inside `${...}` — no DSL, no helpers to learn.

## Install

Copy `prompt.ts` into your project. No runtime dependencies.

## Quick start

```ts
import { prompt, ai } from './prompt'

const p = ai`
  Summarize the following text in one sentence.

  Text:
  > ${userInput}
`
```

`prompt` and `ai` are the same function — `ai` is just an alias that reads nicely at call sites.

## How it works

The tag walks the template and, for each interpolated value, captures the **prefix of the line that value sits on**. Every line of the rendered value is then re-emitted with that prefix. This is what makes lists, block quotes, and multi-line interpolations look right:

```ts
ai`
  Items:
  - ${['apple', 'banana', 'cherry']}
`
// Items:
// - apple
// - banana
// - cherry

ai`
  > ${"line one\nline two"}
`
// > line one
// > line two
```

After assembly the output is cleaned up:

- common leading indentation is stripped (auto-dedent)
- whitespace-only lines are collapsed to empty
- runs of 3+ blank lines are reduced to 2
- the result is trimmed

## Interpolated value types

`flatten` decides how each `${value}` renders. Detection order:

1. **`renderPrompt` symbol** — your own opt-in render protocol (see below).
2. **`JsonValue`** — explicit "render me as a JSON code fence" wrapper.
3. **Zod-like** — anything exposing `toJSONSchema()` (e.g. Zod schemas) renders as its JSON Schema in a fenced block.
4. **Arrays** — each element is flattened and joined with newlines. `null`, `undefined`, and `false` are dropped; `0` and `''` are kept.
5. **Other objects** — `JSON.stringify`d in a ```` ```json ```` fence.
6. **Primitives** — `String(value).trim()`.
7. **Nullish / `false`** — empty string.

### `JsonValue<T>`

Wrap a value to force JSON-fence rendering even when it would otherwise be treated as a primitive or skipped:

```ts
import { JsonValue, ai } from './prompt'

ai`
  Config:
  ${new JsonValue({ retries: 3, timeoutMs: 5_000 })}
`
```

### Zod (and other schema libs)

Any object with a `toJSONSchema()` method is rendered as its schema. Zod v4 is the typical case:

```ts
import { z } from 'zod'

const UserSchema = z.object({ id: z.string(), name: z.string() })

ai`
  Return data matching this schema:
  ${UserSchema}
`
```

### Custom render protocol

For your own classes, opt in via the exported `renderPrompt` symbol:

```ts
import { renderPrompt, ai } from './prompt'

class Document {
  constructor(public title: string, public body: string) {}
  [renderPrompt]() {
    return ai`
      # ${this.title}

      ${this.body}
    `
  }
}

ai`
  Read the document below and answer the question.

  ${new Document('Onboarding', '...')}
`
```

The value returned from `[renderPrompt]()` is itself a `PromptValue` and gets re-flattened — so you can return a string, an array, another `ai\`\`` result, or a `JsonValue`.

## The factory: `promptCreate(options?)`

`promptCreate` returns a configured `prompt` tag. With no arguments it behaves identically to bare `prompt`.

```ts
import { promptCreate } from './prompt'

const ai = promptCreate({
  dedent: true,
  maxChars: 8_000,
  truncate: 'end',
})

ai`...`
```

### Options

All options are optional and flat.

```ts
type TruncateMode   = 'end' | 'start' | 'middle'
type TruncateMarker = string | ((removedChars: number) => string)

interface TruncateCtx {
  maxChars: number
  mode: TruncateMode
  marker: TruncateMarker
  truncate: (text: string, mode?: TruncateMode) => string
}

type OutputTruncateFn = (text: string, ctx: TruncateCtx) => string
type ValueTruncateFn  = (rendered: string, original: PromptValue, ctx: TruncateCtx) => string

type OutputTruncate =
  | { maxChars: number; truncate?: TruncateMode; marker?: TruncateMarker }
  | { truncate: OutputTruncateFn; maxChars?: number; marker?: TruncateMarker }

type ValueTruncate =
  | { valueMaxChars: number; valueTruncate?: TruncateMode; valueMarker?: TruncateMarker }
  | { valueTruncate: ValueTruncateFn; valueMaxChars?: number; valueMarker?: TruncateMarker }

type PromptOptions =
  { dedent?: boolean }
  & Partial<OutputTruncate>
  & Partial<ValueTruncate>
```

| Option            | Default                     | Effect                                                                 |
|-------------------|-----------------------------|------------------------------------------------------------------------|
| `dedent`          | `true`                      | Strip common leading indentation from the static template parts.       |
| `maxChars`        | —                           | Cap on the whole assembled output. Required when `truncate` is a mode. |
| `truncate`        | `'end'` (when `maxChars` set) | Built-in mode or full custom function for the whole-output pass.     |
| `marker`          | `…[truncated N chars]`      | Marker for the whole-output pass. String or `(removed) => string`.     |
| `valueMaxChars`   | —                           | Per-value cap. Required when `valueTruncate` is a mode.                |
| `valueTruncate`   | `'end'` (when `valueMaxChars` set) | Built-in mode or full custom function for the per-value pass.    |
| `valueMarker`     | `…[truncated N chars]`      | Marker for the per-value pass.                                         |

The discriminated unions enforce at compile time that:
- a mode string requires its matching `maxChars` (or `valueMaxChars`),
- a function in `truncate` / `valueTruncate` takes over and may read `maxChars` / `marker` from `ctx` or ignore them.

### Truncation passes

Both passes are independent and both can fire on the same render:

1. **Per-value pass** runs inside `flatten`, on each interpolated value after it is rendered to a string.
2. **Whole-output pass** runs once on the final assembled string after whitespace cleanup, as a safety net.

#### Built-in modes

- `'end'` — keep the head, drop the tail, append the marker.
- `'start'` — drop the head, keep the tail, prepend the marker.
- `'middle'` — keep head and tail, drop the middle, insert the marker between them.

The default marker is `…[truncated N chars]`, where `N` is the number of characters removed.

#### Custom truncation functions

A function in `truncate` or `valueTruncate` fully owns the decision. It receives a `ctx` containing the resolved options plus `ctx.truncate(text, mode?)` — a delegate back into the library's built-in algorithm.

```ts
const ai = promptCreate({
  maxChars: 8_000,
  marker: (removed) => `\n…[dropped ${removed} chars]`,
  truncate: (text, ctx) => {
    if (text.length <= ctx.maxChars) return text
    // Custom rule: try middle first, fall back to end.
    const mid = ctx.truncate(text, 'middle')
    return mid.length <= ctx.maxChars ? mid : ctx.truncate(text, 'end')
  },
})
```

The per-value variant additionally receives the original `PromptValue`, so it can branch on type — e.g. render a giant array differently from a long string:

```ts
const ai = promptCreate({
  valueMaxChars: 1_000,
  valueTruncate: (rendered, original, ctx) => {
    if (Array.isArray(original) && original.length > 50) {
      return ctx.truncate(rendered, 'end')
    }
    return ctx.truncate(rendered, 'middle')
  },
})
```

## Composition

Because every `prompt\`...\`` call returns a plain string and accepts plain strings as values, prompts compose by ordinary interpolation:

```ts
const persona = ai`
  You are a senior reviewer. Be concise.
`

const task = ai`
  Review the diff and list risks.
`

const full = ai`
  ${persona}

  ${task}

  Diff:
  ${diff}
`
```

Conditionals are plain JS — no `when` / `if` helpers:

```ts
ai`
  ${user.isAdmin && ai`
    Admin notes:
    ${adminNotes}
  `}
`
```

A falsy interpolation renders as nothing and its surrounding blank lines are collapsed by the cleanup pass.

## API surface

```ts
export class JsonValue<T = any>
export const renderPrompt: unique symbol
export type  PromptValue
export type  PromptOptions
export function prompt(strings: TemplateStringsArray, ...values: PromptValue[]): string
export function promptCreate(options?: PromptOptions): typeof prompt
export const ai: typeof prompt
```

## Non-goals

Kept deliberately out of scope to stay simple:

- token counting (needs a model-specific tokenizer; belongs in the API client layer)
- async / `Promise` values (await before passing in)
- message arrays, roles, tools, multi-modal content (caller's responsibility)
- helper sugar like `section()`, `when()`, `list()` (use plain JS)
- markdown / XML escaping (caller's responsibility)
