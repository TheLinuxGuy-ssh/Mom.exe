import { z } from 'zod';
import { ACTIONS, FLAGS } from '../engine/actions';

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PlanBlockSchema = z.object({
	start: z.string().regex(HHMM_RE),
	end: z.string().regex(HHMM_RE),
	action: z.enum(ACTIONS),
	detail: z.string().min(2).max(160),
	why: z.string().max(160).default('')
});

export const PlanOutputSchema = z.object({
	summary: z.string().min(4).max(400),
	data_note: z.string().max(200).optional(),
	blocks: z.array(PlanBlockSchema).min(1).max(12),
	flags: z.array(z.enum(FLAGS)).default([])
});

export const ExtractionSchema = z.object({
	sleep_hours: z.number().min(0).max(16).nullable(),
	slept_at: z.string().regex(HHMM_RE).nullable(),
	woke_at: z.string().regex(HHMM_RE).nullable(),
	meals: z
		.object({
			b: z.boolean().nullable(),
			l: z.boolean().nullable(),
			s: z.boolean().nullable(),
			d: z.boolean().nullable()
		})
		.nullable(),
	mood: z.number().int().min(1).max(5).nullable(),
	quick: z.enum(['rough', 'okay', 'great']).nullable(),
	disturbances: z.array(z.string().max(40)).max(4).default([]),
	deadline_notes: z.string().max(120).nullable()
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
