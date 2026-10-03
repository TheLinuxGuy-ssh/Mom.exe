export const ACTIONS = [
	'nap',
	'eat_meal',
	'snack',
	'caffeine_cutoff',
	'wind_down',
	'light_exposure',
	'exercise',
	'study_block',
	'class',
	'social_time',
	'screen_off',
	'hydration',
	'me_time',
	'sleep',
	'free'
] as const;

export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
	nap: 'Nap',
	eat_meal: 'Eat a meal',
	snack: 'Snack',
	caffeine_cutoff: 'Caffeine cutoff',
	wind_down: 'Wind down',
	light_exposure: 'Light + movement',
	exercise: 'Exercise',
	study_block: 'Study block',
	class: 'Class',
	social_time: 'People time',
	screen_off: 'Screens off',
	hydration: 'Hydrate',
	me_time: 'Me time',
	sleep: 'Sleep',
	free: 'Free time'
};

export const ACTION_ICON: Record<Action, string> = {
	nap: 'moon-star',
	eat_meal: 'utensils',
	snack: 'cookie',
	caffeine_cutoff: 'coffee',
	wind_down: 'lamp-desk',
	light_exposure: 'sun',
	exercise: 'dumbbell',
	study_block: 'book-open',
	class: 'graduation-cap',
	social_time: 'users',
	screen_off: 'monitor-off',
	hydration: 'droplets',
	me_time: 'armchair',
	sleep: 'moon',
	free: 'sparkles'
};

export const FLAGS = [
	'suggest_professional_help',
	'persistent_late_sleep',
	'meal_skipping_risk',
	'high_caffeine_evening',
	'deadline_crunch',
	'low_mood_signs'
] as const;

export type Flag = (typeof FLAGS)[number];

export const FLAG_LABEL: Record<Flag, string> = {
	suggest_professional_help: 'Worth talking to someone professional',
	persistent_late_sleep: 'Sleep has been rough for a while',
	meal_skipping_risk: 'Meals keep getting skipped',
	high_caffeine_evening: 'Late caffeine is stealing your nights',
	deadline_crunch: 'Deadline crunch detected',
	low_mood_signs: 'Mood seems low lately'
};
