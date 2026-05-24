export class JsonValue<T = unknown> {
	constructor(public readonly value: T) {}
}

export const renderPrompt = Symbol('prompt.render')

type ZodLike = { toJSONSchema(input?: { io: 'input' | 'output' }): object }
type Renderable = { [renderPrompt](): PromptValue }

type Primitive =
	| string
	| number
	| boolean
	| null
	| undefined
	| object
	| JsonValue
	| ZodLike
	| Renderable

export type PromptValue = Primitive | readonly PromptValue[]

export type TruncateMode = 'end' | 'start' | 'middle'
export type TruncateMarker = string | ((removedChars: number) => string)

export interface TruncateCtx {
	maxChars: number
	mode: TruncateMode
	marker: TruncateMarker
	truncate: (text: string, mode?: TruncateMode) => string
}

export type OutputTruncateFn = (text: string, ctx: TruncateCtx) => string
export type ValueTruncateFn = (rendered: string, original: PromptValue, ctx: TruncateCtx) => string

type OutputTruncate =
	| { maxChars: number; truncate?: TruncateMode; marker?: TruncateMarker }
	| { truncate: OutputTruncateFn; maxChars?: number; marker?: TruncateMarker }

type ValueTruncate =
	| { valueMaxChars: number; valueTruncate?: TruncateMode; valueMarker?: TruncateMarker }
	| { valueTruncate: ValueTruncateFn; valueMaxChars?: number; valueMarker?: TruncateMarker }

export type PromptOptions =
	& { dedent?: boolean }
	& Partial<OutputTruncate>
	& Partial<ValueTruncate>

const defaultMarker: TruncateMarker = (removed) => `…[truncated ${removed} chars]`

function resolveMarker(m: TruncateMarker | undefined, removed: number): string {
	const mk = m ?? defaultMarker
	return typeof mk === 'function' ? mk(removed) : mk
}

function builtinTruncate(
	text: string,
	mode: TruncateMode,
	maxChars: number,
	marker: TruncateMarker,
): string {
	if (text.length <= maxChars) return text
	const estRemoved = text.length - maxChars
	const markerStr = resolveMarker(marker, estRemoved)
	const budget = Math.max(0, maxChars - markerStr.length)
	if (budget <= 0) return markerStr.slice(0, maxChars)
	switch (mode) {
		case 'end':
			return text.slice(0, budget) + markerStr
		case 'start':
			return markerStr + text.slice(text.length - budget)
		case 'middle': {
			const head = Math.ceil(budget / 2)
			const tail = budget - head
			return text.slice(0, head) + markerStr + text.slice(text.length - tail)
		}
	}
}

interface ResolvedOutput {
	enabled: boolean
	maxChars: number
	mode: TruncateMode
	marker: TruncateMarker
	custom?: OutputTruncateFn
}

interface ResolvedValue {
	enabled: boolean
	maxChars: number
	mode: TruncateMode
	marker: TruncateMarker
	custom?: ValueTruncateFn
}

function resolveOutput(opts: PromptOptions): ResolvedOutput {
	const t = opts.truncate
	const custom = typeof t === 'function' ? (t as OutputTruncateFn) : undefined
	const mode: TruncateMode = typeof t === 'string' ? t : 'end'
	const maxChars = opts.maxChars ?? 0
	return {
		enabled: custom !== undefined || maxChars > 0,
		maxChars,
		mode,
		marker: opts.marker ?? defaultMarker,
		custom,
	}
}

function resolveValue(opts: PromptOptions): ResolvedValue {
	const t = opts.valueTruncate
	const custom = typeof t === 'function' ? (t as ValueTruncateFn) : undefined
	const mode: TruncateMode = typeof t === 'string' ? t : 'end'
	const maxChars = opts.valueMaxChars ?? 0
	return {
		enabled: custom !== undefined || maxChars > 0,
		maxChars,
		mode,
		marker: opts.valueMarker ?? defaultMarker,
		custom,
	}
}

function makeCtx(r: { maxChars: number; mode: TruncateMode; marker: TruncateMarker }): TruncateCtx {
	return {
		maxChars: r.maxChars,
		mode: r.mode,
		marker: r.marker,
		truncate: (text, mode) => builtinTruncate(text, mode ?? r.mode, r.maxChars, r.marker),
	}
}

function renderRaw(value: PromptValue, valueCfg: ResolvedValue): string {
	if (Array.isArray(value)) {
		return value
			.filter((v) => v !== null && v !== undefined && v !== false)
			.map((v) => flatten(v as PromptValue, valueCfg))
			.join('\n')
	}
	if (value === null || value === undefined || value === false) return ''
	if (typeof value === 'object') {
		const r = (value as Record<symbol, unknown>)[renderPrompt]
		if (typeof r === 'function') {
			return flatten((r as () => PromptValue).call(value), valueCfg)
		}
		let jsonValue: unknown
		if (value instanceof JsonValue) {
			jsonValue = value.value
		} else if (typeof (value as ZodLike).toJSONSchema === 'function') {
			jsonValue = (value as ZodLike).toJSONSchema({ io: 'input' })
		} else {
			jsonValue = value
		}
		return '```json\n' + JSON.stringify(jsonValue, null, 2) + '\n```'
	}
	return String(value).trim()
}

function flatten(value: PromptValue, valueCfg: ResolvedValue): string {
	const rendered = renderRaw(value, valueCfg)
	if (!valueCfg.enabled) return rendered
	const ctx = makeCtx(valueCfg)
	if (valueCfg.custom) return valueCfg.custom(rendered, value, ctx)
	return builtinTruncate(rendered, valueCfg.mode, valueCfg.maxChars, valueCfg.marker)
}

function measureMinIndent(strings: readonly string[]): number {
	// Placeholder for interpolation slots so lines that contain only an indent
	// + a ${value} still count as content lines for indent measurement.
	const joined = strings.join('\x00')
	let min = Infinity
	for (const line of joined.split('\n')) {
		if (!/\S/.test(line)) continue
		const m = /^[ \t]*/.exec(line)
		const ind = m ? m[0].length : 0
		if (ind < min) min = ind
	}
	return min === Infinity ? 0 : min
}

function dedentStrings(strings: readonly string[]): string[] {
	const n = measureMinIndent(strings)
	if (n === 0) return strings.slice()
	const re = new RegExp(`^[ \\t]{0,${n}}`)
	return strings.map((s, i) => {
		const lines = s.split('\n')
		return lines
			.map((line, j) => {
				const isLineStart = j > 0 || i === 0
				return isLineStart ? line.replace(re, '') : line
			})
			.join('\n')
	})
}

function assemble(
	strings: readonly string[],
	values: readonly PromptValue[],
	valueCfg: ResolvedValue,
): string {
	const out: string[] = []
	for (let i = 0; i < strings.length; i++) {
		const lines = strings[i]!.split('\n')
		const lastPrefix = lines.pop() ?? ''
		for (const l of lines) out.push(l, '\n')
		out.push(lastPrefix)
		if (i < values.length) {
			const flat = flatten(values[i]!, valueCfg).split('\n')
			out.push(flat[0]!)
			for (let k = 1; k < flat.length; k++) out.push('\n', lastPrefix, flat[k]!)
		}
	}
	return out.join('')
}

function compose(
	strings: readonly string[],
	values: readonly PromptValue[],
	opts: PromptOptions,
): string {
	const dedent = opts.dedent !== false
	const valueCfg = resolveValue(opts)
	const outputCfg = resolveOutput(opts)
	const prepared = dedent ? dedentStrings(strings) : strings.slice()
	let result = assemble(prepared, values, valueCfg)
	result = result.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
	if (outputCfg.enabled) {
		const ctx = makeCtx(outputCfg)
		result = outputCfg.custom
			? outputCfg.custom(result, ctx)
			: builtinTruncate(result, outputCfg.mode, outputCfg.maxChars, outputCfg.marker)
	}
	return result
}

/**
 * Tagged template that assembles a clean LLM prompt string.
 *
 * Preserves the indentation/prefix of the line each `${value}` sits on so
 * lists, block quotes, and multi-line interpolations render correctly.
 */
export function prompt(strings: TemplateStringsArray, ...values: PromptValue[]): string {
	return compose(strings, values, {})
}

/**
 * Returns a configured `prompt` tag. With no arguments it behaves identically
 * to bare {@link prompt}.
 */
export function promptCreate(options: PromptOptions = {}): typeof prompt {
	return ((strings: TemplateStringsArray, ...values: PromptValue[]) =>
		compose(strings, values, options)) as typeof prompt
}

export const ai: typeof prompt = prompt
