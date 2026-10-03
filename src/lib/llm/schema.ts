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
	sleep_hours: z.number().min(0).max(16).nullish(),
	slept_at: z.string().regex(HHMM_RE).nullish(),
	woke_at: z.string().regex(HHMM_RE).nullish(),
	meals: z
		.object({
			b: z.boolean().nullish(),
			l: z.boolean().nullish(),
			s: z.boolean().nullish(),
			d: z.boolean().nullish()
		})
		.nullish(),
	mood: z.number().int().min(1).max(5).nullish(),
	quick: z.enum(['rough', 'okay', 'great']).nullish(),
	disturbances: z.array(z.string().max(40)).max(4).default([]),
	deadline_notes: z.string().max(120).nullish()
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * What the note was actually for. "chat" means the student wanted to talk, not be replanned:
 * mom answers, nothing is scheduled, and no plan row is written. "plan" is the normal path.
 */
export const IntentSchema = z.enum(['plan', 'chat']);
export type Intent = z.infer<typeof IntentSchema>;

/** Set when a chat should hand control back to the planner. */
export const HandoffSchema = z.enum(['replan']);
export type Handoff = z.infer<typeof HandoffSchema>;

export const WeekDigestSchema = z.object({
	week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	text: z.string().min(1).max(600)
});

export type WeekDigestOut = z.infer<typeof WeekDigestSchema>;
