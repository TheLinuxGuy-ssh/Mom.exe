/**
 * Whether a note is a request to change the plan, decided in code rather than by a model.
 *
 * There is exactly one class of note where guessing is not acceptable: someone explicitly asking
 * for a task to be moved, added, swapped or dropped. "i can't study at 8:30 because i'm meeting
 * my friends, could you shift it" is not small talk, and a router that files it as a conversation
 * leaves the student typing at a wall. The classifier reads the sentence around the ask and can
 * read "meeting my friends" as social and lose the request underneath, so the verbs are matched
 * here instead, where the answer cannot wobble.
 *
 * Deliberately narrow. The bar is an explicit instruction to alter the plan, not a feeling about
 * it: "i can't focus" is a conversation, "i can't study at 8:30" is a constraint on the schedule.
 */

/**
 * The things a day is actually made of. Used as the object of a movement or removal verb, so
 * "delay dinner" and "cancel study" are instructions while "drop out" and "move on" are not: none
 * of those nouns can follow the verbs where they appear in ordinary conversation.
 */
const NOUN = String.raw`(?:it|that|this|them|those|these|my|the|a|an|dinner|lunch|breakfast|snack|tea|chai|class|classes|study|revision|gym|walk|run|exercise|sleep|nap|test|tuition|lab|lecture|seminar|assignment|homework|everything)`;
/** note `.source`: interpolating the RegExp itself would splice in its /pattern/flags text */
const OBJECT = String.raw`\b${NOUN}\b`;

/** Verbs that only make sense as an instruction to change the plan. */
const MUTATION_PATTERNS: RegExp[] = [
	/\b(reschedule|re-schedule)\b/i,
	// "delay dinner", "push my class", "swap study and the gym"
	new RegExp(String.raw`\b(postpone|delay|shift|push|pull|bring|drag|swap|trade|exchange)\b[^.?!]{0,26}${OBJECT}`, 'i'),
	// "cancel study", "drop the 6am run", "remove the evening block". "drop out" and "skip class
	// tomorrow" are the risk: neither can match, because "out" and "tomorrow" are not nouns above.
	new RegExp(String.raw`\b(cancel|delete|remove|skip|scrap|kill|drop)\b[^.?!]{0,18}${OBJECT}`, 'i'),
	/\b(start|begin|come|wake|get|go)\b[^.?!]{0,18}\b(later|earlier|sooner)\b/i,
	// "wake me up at 9", "get me up earlier"
	/\b(wake|get)\s+me\b[^.?!]{0,20}\b(at|to)\b/i,
	/\b(make|find|leave)\s+(some\s+)?(room|space|time)\b/i,
	// "change my schedule", "redo the day", "reshuffle the order", "update tonight"
	/\b(move|shuffle|rearrange|reorganise|reorganize|reshuffle|rework|redo|fix|change|adjust|edit|tweak|update)\b[^.?!]{0,26}\b(plan|schedule|timetable|it|that|this|today|tonight|tomorrow|day|evening|morning|afternoon|night|everything|my \w+|the \w+)\b/i,
	/\binstead of\b/i,
	// "fit my dinner in at 9", "squeeze in a walk"
	/\b(add|put|slot|fit|squeeze|schedule)\b[^.?!]{0,22}\b(in|into)\b/i,
	/\b(new plan|plan again|re-?plan|start over)\b/i,
	// "the 9pm block has to go"
	/\bblock\b[^.?!]{0,26}\b(has to go|has got to go|cannot stay|needs to move|has to move)\b/i
];

/**
 * A named time in the note. Used to unlock the weaker clash patterns, because mentioning a clock
 * is not a request on its own: "i woke up at 7 and it was horrible" is a complaint.
 */
const TIME_TOKEN = /\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(1[0-2]|[1-9])\s?(am|pm)\b/;

/** Unambiguous signs of a double booking. "my parents clash" is not one; "a clash at 6" is. */
const HARD_CLASH = [
	/\b(double[- ]?booked)\b/i,
	/\b(running|ran)\s+late\b/i,
	// needs a time or a counterpart to go with it, which is what separates a scheduling clash from
	// a row at home
	/\b(clash|clashes|clashing|conflict|conflicts|overlap|overlaps|overlapping)\b[^.?!]{0,14}\b(at|with)\b/i
];

/**
 * A need that was not met, in the student's own words: "couldn't eat till 3", "didn't hydrate
 * till 6", "could not sleep till 4".
 *
 * The "till" is required and "sleep" is not on the list. Both were learned the hard way: with an
 * optional preposition, "couldn't sleep at 3" matched, and that is insomnia at 3am, which wants a
 * conversation and not a schedule.
 */
const NEED_MISSED = [
	new RegExp(
		String.raw`\b(?:could ?n[o']?t|couldn'?t|did ?n[o']?t|didn'?t|was ?n[o']?t|wasn'?t)\b[^.?!]{0,28}\b(eat|drink|hydrate|nap|attend|make it|finish|breathe)\b[^.?!]{0,18}\b(till|until|by)\s*\d{1,2}\b`,
		'i'
	)
];

/**
 * A clash stated against a time, or a clash in the shape of an obligation. "my parents clash" is
 * not a scheduling problem; "i have a clash at 6" is.
 */
const SOFT_CLASH: RegExp[] = [
	/\b(clash|clashes|clashing|conflict|conflicts|overlap|overlaps|overlapping)\b[^.?!]{0,14}\b(at|with|today|tonight|tomorrow)\b/i,
	// "i can't be there at 6", "won't make the 8:30 slot"
	//
	// "could not" and "couldn't" belong here and did not used to. The README's own headline
	// example — "couldn't hydrate at 9:30" — was being routed to chat, so the promise that a missed
	// need reschedules the day only held for students who typed the contraction.
	/\b(can'?t|could ?n[o']?t|couldn'?t|cannot|won'?t|will not|unable to|not able to)\b[^.?!]{0,32}\b(at|by|before|after|until|till|from)\b/i,
	// "i have to meet my friends at 6"
	/\b(have to|has to|need to|have got to|got to|must)\b[^.?!]{0,28}\b(meet|meeting|meetup|hang out|class|lecture|lab|tut|test|exam|shift|travel|commute|family|doctor|dentist|work)\b/i
];

/**
 * Asking about tomorrow's shape rather than changing today is still a planning question.
 *
 * "what now" is here because a student who types it wants the day sorted, and the live harness
 * caught it being answered with small talk. It is the shortest form of the request and it was the
 * only one missing.
 */
const PLANNING_QUESTION =
	/\b(what should i|what do i|should i|how do i|can i|do i need to|what time should|help me plan|plan my|what now|now what|what'?s the plan|what is the plan)\b/i;

/**
 * True when the note is unmistakably asking for the plan to change. Used to override both the
 * classifier and the model's own declaration, so an explicit instruction cannot be filed as a
 * conversation no matter which one is feeling chatty that day.
 */
export function isTaskMutationRequest(note: string | null): boolean {
	if (!note) return false;
	const text = note.trim();
	if (!text) return false;

	for (const re of MUTATION_PATTERNS) {
		if (re.test(text)) return true;
	}

	for (const re of HARD_CLASH) {
		if (re.test(text)) return true;
	}

	for (const re of NEED_MISSED) {
		if (re.test(text)) return true;
	}

	// a constraint tied to a clock time is a change of plan, however casually it is phrased:
	// "i cant study at 8:30" is the schedule being wrong, not a mood
	if (TIME_TOKEN.test(text)) {
		for (const re of SOFT_CLASH) {
			if (re.test(text)) return true;
		}
	}

	return PLANNING_QUESTION.test(text);
}

/**
 * What she is being asked to do about the day, for the planner and for tests: an explicit
 * mutation beats both other signals.
 */
export function intentHint(note: string | null): 'plan' | 'chat' | null {
	return isTaskMutationRequest(note) ? 'plan' : null;
}
/** Romanized Hindi markers. Two is a deliberate threshold: one is usually an English word. */
const HINGLISH_MARKERS =
	/\b(arre|yaar|theek|nahi|nahin|haan|hain|hai|kya|bhai|abhi|bahut|rakh|sochna|piyo|paani|khana|bhookh|jaldi|chalo|pita|mummy|papa|dar|laga|kare|karo|liye|waala|kharab|thak|bhookh|samajhti|pata hai|gaya|kar liya|khaya|liya)\b/i;

/**
 * A note written in Hindi that is saying how the day felt, rather than asking for a schedule.
 *
 * The classifier reads romanized Hindi as a fragment often enough to matter: "arre mom, aaj kuch
 * theek nahi lag raha, bas thak gaya hu" came back as a planning request, and answering a tired
 * feeling with a timetable is the worst thing this app can do. Used only to stop a plan being
 * forced — the model still decides, it just is not overruled by a routing guess here.
 */
export function isHinglishFeeling(note: string | null): boolean {
	if (!note) return false;
	const t = note.trim();
	if (!t) return false;
	const marks = t.match(new RegExp(HINGLISH_MARKERS.source, 'gi')) ?? [];
	if (marks.length < 2) return false;
	// anything with a clock, an obligation or an explicit instruction is a scheduling note, in any
	// language the student happens to be typing it in
	if (TIME_TOKEN.test(t)) return false;
	for (const re of [...MUTATION_PATTERNS, ...HARD_CLASH, ...NEED_MISSED]) {
		if (re.test(t)) return false;
	}
	if (PLANNING_QUESTION.test(t)) return false;
	// the same question in Hindi is still a question. without this, "kya karun ab, thak gaya hu"
	// counted as a feeling and lost the request in the second half of the sentence
	if (/\b(kya karu?n?|ka karu?n|kya kare|kaise|kis din)\b/i.test(t)) return false;
	return true;
}
