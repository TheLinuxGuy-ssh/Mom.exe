/**
 * Situation-aware display words, in one place.
 *
 * The stored fields and the model's action vocabulary stay neutral ('class_start', the 'class'
 * action) so the contract never changes; what a person actually reads adapts to the situation
 * they picked at signup. Legacy profiles without a situation resolve to student_hostel via
 * situOf(), which keeps every old account byte-identical.
 */
import { ACTION_LABEL, type Action } from './actions';
import { situOf, type Situation } from '../storage/types';

/**
 * The label for the fixed start-of-day field. Same field for everyone (profile.class_start,
 * empty means nothing is fixed); only the words change.
 */
export const DAY_FIELD: Record<Situation, string> = {
	student_hostel: 'first class starts',
	student_flat: 'first class starts',
	student_home: 'first class starts',
	work_office: 'workday starts',
	work_remote: 'workday starts',
	own_gig: 'any fixed start (optional)',
	between_things: 'any fixed start (optional)'
};

/**
 * The model can emit 'class' / 'study_block' for anybody — in the prompt vocabulary they mean
 * "their fixed anchor" and "their focused work". What those are *called* in the timeline depends
 * on whose day it is. Situations missing from the overrides keep the neutral ACTION_LABEL.
 */
const ACTION_LABEL_OVERRIDES: Record<Situation, Partial<Record<Action, string>>> = {
	student_hostel: {},
	student_flat: {},
	student_home: {},
	between_things: {},
	work_office: { class: 'Work', study_block: 'Focus block' },
	work_remote: { class: 'Work', study_block: 'Focus block' },
	own_gig: { class: 'Fixed work', study_block: 'Deep work' }
};

/** Display label for a plan block action, personalised by situation. */
export function actionLabel(action: string, situation?: Situation): string {
	const overrides = ACTION_LABEL_OVERRIDES[situOf(situation)];
	return overrides[action as Action] ?? ACTION_LABEL[action as Action] ?? action;
}
