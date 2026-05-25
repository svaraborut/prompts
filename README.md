# prompts

**Prompts that read like prompts.**

[![npm](https://img.shields.io/npm/v/@svara/prompts.svg)](https://www.npmjs.com/package/@svara/prompts) [![size](https://img.shields.io/bundlephobia/minzip/@svara/prompts)](https://bundlephobia.com/package/@svara/prompts) [![license](https://img.shields.io/npm/l/@svara/prompts.svg)](./LICENSE)

A tiny tagged-template utility for assembling LLM prompts in TypeScript. Indentation-aware, multi-line safe, with escape hatches for JSON, Zod, and your own classes.

## Before / after

Plain template literals leak your source indentation into the prompt, lose line prefixes on multi-line interpolations, and render objects as `[object Object]`:

```ts
function build(context: string, items: string[], schema: object) {
  return `
    You are a helpful assistant.

    Context:
    > ${context}

    Items:
    ${items.map(i => `- ${i}`).join('\n')}

    Schema:
    ${schema}
  `
}

build('line one\nline two', ['apple', 'banana'], { type: 'object' })
// ←  4-space indent on every line
// ←  "line two" loses its `> ` prefix
// ←  list items lose their `    ` indent
// ←  schema renders as "[object Object]"
```

Same prompt with `prompts`:

```ts
import { ai } from '@svara/prompts'

function build(context: string, items: string[], schema: object) {
  return ai`
    You are a helpful assistant.

    Context:
    > ${context}

    Items:
    - ${items}

    Schema:
    ${schema}
  `
}

build('line one\nline two', ['apple', 'banana'], { type: 'object' })
// You are a helpful assistant.
//
// Context:
// > line one
// > line two
//
// Items:
// - apple
// - banana
//
// Schema:
// ```json
// {
//   "type": "object"
// }
// ```
```

## Install

```sh
bun add @svara/prompts
# or: npm i @svara/prompts
```

Zero runtime dependencies. Ships ESM + CJS + types.

## Why prompts?

- **Indentation-aware.** Write prompts indented with your code. The common leading indent is stripped from the output.
- **Line-prefix preservation.** `- ${items}` and `> ${quote}` work for multi-line values without per-line string manipulation.
- **Escape hatches built in.** Plain objects render as JSON fences. Zod schemas render as JSON Schema. Your own classes opt in via the `renderPrompt` symbol.
- **Two-pass truncation.** Per-value and whole-output budgets, with built-in `end` / `start` / `middle` modes or a custom function — useful for keeping context windows under control.

## Quick start

```ts
import { ai } from '@svara/prompts'

const prompt = ai`
  Summarize the following text in one sentence.

  Text:
  > ${userInput}
`
```

`ai` is an alias for `prompt` — same function, reads better at call sites.

## Recipes

### Lists and quotes with multi-line values

The prefix of the line a value sits on is re-applied to every line of the rendered value.

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
  > ${'line one\nline two'}
`
// > line one
// > line two
```

### Embed JSON data

Any plain object is auto-rendered as a JSON code fence. Wrap in `JsonValue` only when you need to force an array or primitive into the JSON path.

```ts
import { JsonValue, ai } from '@svara/prompts'

ai`
  Config:
  ${{ retries: 3, timeoutMs: 5_000 }}
`
// Config:
// ```json
// {
//   "retries": 3,
//   "timeoutMs": 5000
// }
// ```

ai`
  Tags:
  ${new JsonValue(['urgent', 'billing'])}
`
// Tags:
// ```json
// [
//   "urgent",
//   "billing"
// ]
// ```
```

### Embed a Zod schema

Any object exposing `toJSONSchema()` renders as its schema. Works with Zod v4 out of the box.

```ts
import { z } from 'zod'
import { ai } from '@svara/prompts'

const UserSchema = z.object({ id: z.string(), name: z.string() })

ai`
  Return data matching this schema:
  ${UserSchema}
`
// Return data matching this schema:
// ```json
// {
//   "type": "object",
//   "properties": {
//     "id": { "type": "string" },
//     "name": { "type": "string" }
//   },
//   "required": ["id", "name"]
// }
// ```
```

### Render your own classes

Opt in by exposing the `renderPrompt` symbol. The returned value is itself a `PromptValue` and is re-flattened — return a string, an array, another `ai\`...\`` result, or a `JsonValue`.

```ts
import { renderPrompt, ai } from '@svara/prompts'

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

  ${new Document('Onboarding', 'Welcome to the team.\nRead the handbook.')}
`
// Read the document below and answer the question.
//
// # Onboarding
//
// Welcome to the team.
// Read the handbook.
```

### Cap prompt size

`promptCreate` returns a configured tag. Two independent truncation passes: per-value (each `${...}` is capped on its own) and whole-output (a safety net on the final string).

```ts
import { promptCreate } from '@svara/prompts'

const ai = promptCreate({
  valueMaxChars: 2_000,
  valueTruncate: 'middle',
  maxChars: 8_000,
  truncate: 'end',
})
```

For full control, pass a function. It receives a `ctx` with `ctx.truncate(text, mode?)` to delegate back into the built-in algorithm.

```ts
const ai = promptCreate({
  maxChars: 8_000,
  marker: (removed) => `\n…[dropped ${removed} chars]`,
  truncate: (text, ctx) => {
    if (text.length <= ctx.maxChars) return text
    const mid = ctx.truncate(text, 'middle')
    return mid.length <= ctx.maxChars ? mid : ctx.truncate(text, 'end')
  },
})
```

### Compose prompts

Every `ai\`...\`` returns a string. Compose by ordinary interpolation. Conditionals are plain JS — falsy values render as nothing and surrounding blank lines collapse.

```ts
const persona = ai`You are a senior reviewer. Be concise.`
const task = ai`Review the diff and list risks.`

ai`
  ${persona}

  ${task}

  ${user.isAdmin && ai`
    Admin notes:
    ${adminNotes}
  `}

  Diff:
  ${diff}
`
```

## API

```ts
export class JsonValue<T = unknown>
export const renderPrompt: unique symbol
export type  PromptValue
export type  PromptOptions
export function prompt(strings: TemplateStringsArray, ...values: PromptValue[]): string
export function promptCreate(options?: PromptOptions): typeof prompt
export const ai: typeof prompt
```

### `PromptOptions`

All optional, all flat. Discriminated unions enforce that a mode string requires its matching `maxChars`.

- `dedent` — strip common leading indentation from the static template parts. Default `true`.
- `maxChars` — cap on the whole assembled output. Required when `truncate` is a mode string.
- `truncate` — `'end' | 'start' | 'middle'` or a custom `(text, ctx) => string`. Default `'end'` when `maxChars` is set.
- `marker` — string or `(removedChars) => string` used by the built-in modes. Default ``…[truncated N chars]``.
- `valueMaxChars`, `valueTruncate`, `valueMarker` — same three, applied per-interpolated-value inside `flatten`. The custom function additionally receives the original `PromptValue`.

Both passes are independent and can both fire on the same render — per-value first, whole-output as a safety net.

### Detection order in `flatten`

1. `renderPrompt` symbol — your own opt-in.
2. `JsonValue` — explicit JSON-fence wrapper.
3. `toJSONSchema()` — Zod-like schemas.
4. Arrays — flatten each element, drop `null`/`undefined`/`false` (keeps `0` and `''`), join with newlines.
5. Other objects — `JSON.stringify` in a ```` ```json ```` fence.
6. Primitives — `String(value).trim()`.
7. Nullish or `false` — empty string.

## Non-goals

Kept deliberately out of scope:

- token counting (model-specific; belongs in the API client layer)
- async / `Promise` values (await before passing in)
- message arrays, roles, tools, multi-modal content
- helper sugar like `section()`, `when()`, `list()` (use plain JS)
- markdown / XML escaping (caller's responsibility)

## License

MIT
