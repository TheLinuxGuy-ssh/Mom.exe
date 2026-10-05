import { describe, expect, it } from 'vitest';
import { supportsReasoningEffort } from './capabilities';

describe('reasoning_effort support', () => {
	it('is sent for the gpt-oss family, which is what the field belongs to', () => {
		expect(supportsReasoningEffort('openai/gpt-oss-20b')).toBe(true);
		expect(supportsReasoningEffort('openai/gpt-oss-120b')).toBe(true);
		expect(supportsReasoningEffort('openai/gpt-oss-20b:free')).toBe(true);
	});

	it('is never sent to gemma, which has no such parameter', () => {
		// this is the whole point of the gate. sending it is ignored at best and rejected at worst,
		// and a rejection reaches the student as "could not reach the model" on every single note
		expect(supportsReasoningEffort('google/gemma-3-27b-it')).toBe(false);
		expect(supportsReasoningEffort('google/gemma-3-12b-it')).toBe(false);
		expect(supportsReasoningEffort('google/gemma-4-31b-it')).toBe(false);
		expect(supportsReasoningEffort('gemma-3-27b-it')).toBe(false);
	});

	it('is omitted for anything unrecognised, because dropping a field is cheaper than a 4xx', () => {
		expect(supportsReasoningEffort('some/unknown-model-v2')).toBe(false);
		expect(supportsReasoningEffort('')).toBe(false);
		expect(supportsReasoningEffort('   ')).toBe(false);
	});

	it('tolerates surrounding whitespace', () => {
		expect(supportsReasoningEffort('  openai/gpt-oss-20b  ')).toBe(true);
		expect(supportsReasoningEffort('\tgoogle/gemma-3-27b-it\n')).toBe(false);
	});
});
