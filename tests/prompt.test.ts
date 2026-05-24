import { test, expect } from 'bun:test'
import { ai, prompt, promptCreate, JsonValue, renderPrompt } from '../src'

test('alias ai === prompt', () => {
	expect(ai).toBe(prompt)
})

test('auto-dedent on by default', () => {
	const r = ai`
		Hello ${'world'}
	`
	expect(r).toBe('Hello world')
})

test('multi-line dedent', () => {
	const r = ai`
		line one
		line two
	`
	expect(r).toBe('line one\nline two')
})

test('preserves line prefix for arrays', () => {
	const r = ai`
		- ${['a', 'b', 'c']}
	`
	expect(r).toBe('- a\n- b\n- c')
})

test('preserves line prefix for multi-line strings', () => {
	const r = ai`
		> ${'line one\nline two'}
	`
	expect(r).toBe('> line one\n> line two')
})

test('keeps 0 and empty string in arrays, drops null/undefined/false', () => {
	const r = ai`${[0, '', false, null, undefined, 1]}`
	expect(r).toBe('0\n\n1')
})

test('JsonValue renders as fenced json', () => {
	const r = ai`${new JsonValue({ a: 1 })}`
	expect(r).toContain('```json')
	expect(r).toContain('"a": 1')
})

test('Zod-like toJSONSchema is rendered', () => {
	const schema = { toJSONSchema: () => ({ type: 'string' }) }
	const r = ai`${schema}`
	expect(r).toContain('"type": "string"')
})

test('renderPrompt symbol opt-in', () => {
	class Doc {
		[renderPrompt]() {
			return ai`# Title`
		}
	}
	const r = ai`${new Doc()}`
	expect(r).toBe('# Title')
})

test('renderPrompt result is re-flattened (can return array)', () => {
	class List {
		[renderPrompt]() {
			return ['a', 'b']
		}
	}
	const r = ai`
		- ${new List()}
	`
	expect(r).toBe('- a\n- b')
})

test('trailing text after a value is preserved', () => {
	const r = ai`foo ${'X'} bar`
	expect(r).toBe('foo X bar')
})

test('promptCreate() with no options matches prompt', () => {
	const p = promptCreate()
	expect(
		p`
			foo ${'bar'}
		`,
	).toBe('foo bar')
})

test('dedent can be disabled', () => {
	const p = promptCreate({ dedent: false })
	const r = p`
      one
      two
    `
	// outer trim() strips the leading newline + first line's indent,
	// but the inner line's indent is preserved.
	expect(r).toBe('one\n      two')
})

test('output truncation: end mode', () => {
	const p = promptCreate({ maxChars: 10, truncate: 'end', marker: '…' })
	const r = p`${'a'.repeat(100)}`
	expect(r.length).toBeLessThanOrEqual(10)
	expect(r.endsWith('…')).toBe(true)
})

test('output truncation: start mode', () => {
	const p = promptCreate({ maxChars: 10, truncate: 'start', marker: '…' })
	const r = p`${'a'.repeat(100)}`
	expect(r.length).toBeLessThanOrEqual(10)
	expect(r.startsWith('…')).toBe(true)
})

test('output truncation: middle mode', () => {
	const p = promptCreate({ maxChars: 11, truncate: 'middle', marker: '…' })
	const r = p`${'a'.repeat(100)}`
	expect(r.length).toBeLessThanOrEqual(11)
	expect(r.includes('…')).toBe(true)
})

test('per-value truncation', () => {
	const p = promptCreate({ valueMaxChars: 5, valueTruncate: 'end', valueMarker: '…' })
	const r = p`X${'a'.repeat(100)}Y`
	expect(r).toBe('Xaaaa…Y')
})

test('custom output truncate can delegate to built-in', () => {
	const p = promptCreate({
		maxChars: 20,
		marker: '…',
		truncate: (text, ctx) => ctx.truncate(text, 'middle'),
	})
	const r = p`${'a'.repeat(50)}`
	expect(r.length).toBeLessThanOrEqual(20)
	expect(r.includes('…')).toBe(true)
})

test('per-value custom truncate receives original value', () => {
	let seenOriginal: unknown
	const p = promptCreate({
		valueMaxChars: 100,
		valueTruncate: (rendered, original, ctx) => {
			seenOriginal = original
			return ctx.truncate(rendered, 'end')
		},
	})
	const arr = [1, 2, 3]
	p`${arr}`
	expect(seenOriginal).toBe(arr)
})

test('function marker reports removed chars', () => {
	const p = promptCreate({
		maxChars: 20,
		truncate: 'end',
		marker: (n) => `[-${n}]`,
	})
	const r = p`${'a'.repeat(100)}`
	expect(r).toMatch(/\[-\d+\]$/)
})

test('falsy interpolation collapses cleanly', () => {
	const cond = false
	const r = ai`
		head
		${cond && 'never'}
		tail
	`
	expect(r).toBe('head\n\ntail')
})

test('nested ai composition', () => {
	const inner = ai`
		inner
	`
	const outer = ai`
		start
		${inner}
		end
	`
	expect(outer).toBe('start\ninner\nend')
})
