import { describe, expect, it } from 'vitest';
import { intentHint, isTaskMutationRequest, isHinglishFeeling } from './mutation';

/**
 * The note that started this: "i cant study at 8:30 because i have to hang out with my friends a
 * bit, could you shift it ..." was filed as a chat. It names a time, states a clash, and asks for a
 * block to be moved, which is a planning request by any reading. The classifier read "hang out with
 * my friends" as social and lost the request underneath it.
 *
 * These are decided in code, so they hold whatever the model is having for tea that day.
 */
describe('explicit requests to change the plan', () => {
	const MUST_BE_PLAN = [
		// the real one
		'i cant study at 8:30 because i have to hang out with my friends a bit, could you shift it',
		'could you shift it',
		'shift my study block to later',
		'move the gym to tomorrow',
		'push my class to the evening',
		'pull the wind down earlier',
		'postpone the 6pm block',
		'delay dinner till 9',
		'bring the walk forward',
		'swap study and the gym',
		'drop the 6am run',
		'cancel study today',
		'remove the evening block',
		'skip the library, i am not going',
		'make room for dinner with family',
		'fit my dinner in at 9',
		'squeeze in a walk before bed',
		'start later tomorrow',
		'wake me up at 9 instead',
		'change my schedule please',
		'fix the plan, study is wrong',
		'update tonight, lab ran late',
		'replan my evening',
		'new plan for tomorrow',
		'redo the day',
		'reschedule my test prep',
		'reshuffle the order',
		'i am running late for the 4pm class',
		'i double booked myself at 7',
		'i cannot make the 8:30 slot, have to meet my friends',
		'will not be able to study at 8:30, family dinner',
		'i have a clash at 6',
		'study at 8:30 is impossible, shift it',
		'the 9pm block has to go',
		'no time for the gym tonight, move it',
		'instead of chai can i have water at 4'
	];

	for (const note of MUST_BE_PLAN) {
		it(`treats this as a change request: "${note.slice(0, 46)}${note.length > 46 ? '...' : ''}"`, () => {
			expect(isTaskMutationRequest(note)).toBe(true);
			expect(intentHint(note)).toBe('plan');
		});
	}
});

describe('things that must stay a conversation', () => {
	/**
	 * The guard is only worth having if it stays narrow. Every one of these was a chat case in the
	 * live evaluation, and turning any of them into a plan would be a regression: the student is
	 * talking, and a schedule in reply is exactly what the prompt says not to do.
	 */
	const MUST_BE_CHAT = [
		'today was awful',
		"i'm so tired of this hostel",
		'seminar ran over again',
		'thanks mom, that helped',
		"you're the only one who gets it",
		'my friends are coming home for the weekend',
		'i had a fight with my roommate',
		'i feel so lazy today',
		'i cant focus at all',
		'love the plan but i know i wont follow it',
		'worried about the exam tomorrow',
		'had a fight with my roommate',
		'my RA was mean to me today',
		'went out with friends, it was fun',
		'i want to drop out',
		'feeling low about my marks',
		'do you ever get lonely',
		'my parents keep calling',
		'laughed so hard at that',
		'i had a good day for once'
	];

	for (const note of MUST_BE_CHAT) {
		it(`leaves this as conversation: "${note.slice(0, 46)}${note.length > 46 ? '...' : ''}"`, () => {
			expect(isTaskMutationRequest(note)).toBe(false);
		});
	}

	it('has no opinion on an empty note, since that is already handled as a plan request', () => {
		// null/empty means "plan my day" and is decided by isContentFree, not here
		expect(isTaskMutationRequest(null)).toBe(false);
		expect(isTaskMutationRequest('   ')).toBe(false);
		expect(intentHint(null)).toBeNull();
	});

	it('does not fire on a bare time, because mentioning a clock is not a request', () => {
		expect(isTaskMutationRequest('i woke up at 7 and it was horrible')).toBe(false);
		expect(isTaskMutationRequest('study was at 8:30 and it dragged')).toBe(false);
	});
});

describe('intentHint contract', () => {
	it('returns null when it has no opinion, so the models decide', () => {
		expect(intentHint('today was awful')).toBeNull();
		expect(intentHint('hey')).toBeNull();
	});

	it('never returns chat, because only certainty is worth overriding a model with', () => {
		// a code-level "chat" would veto the model on any false positive here and quietly swallow
		// real planning requests. Only "plan" is a safe override.
		const samples = [...MUST_BE_CHAT_SAMPLE];
		for (const note of samples) expect(intentHint(note)).not.toBe('chat');
	});
});

const MUST_BE_CHAT_SAMPLE = [
	'today was awful',
	'could you shift it',
	'thanks mom',
	'i cant focus',
	'drop the 6am run'
];
describe('needs that could not be met', () => {
	/**
	 * The README's headline example is "couldn't hydrate at 9:30, friends were in", and the promise
	 * is that the remaining day gets rescheduled. The pattern knew `cannot` and `can't` but not
	 * `could not` or `couldn't`, so which of those a student happened to type decided whether the
	 * feature worked at all.
	 */
	it('treats a need that could not be met as a change to the day', () => {
		expect(isTaskMutationRequest("couldn't hydrate at 9:30, friends were in")).toBe(true);
		expect(isTaskMutationRequest('could not drink water at 9:30, we talked until late')).toBe(true);
		expect(isTaskMutationRequest('couldnt eat till 3')).toBe(true);
		expect(isTaskMutationRequest("didn't hydrate till 6")).toBe(true);
	});

	it('leaves an ordinary complaint about the day alone', () => {
		// mentioning a clock is not a request. this one is a mood, and it stays a conversation
		expect(isTaskMutationRequest('i woke up at 3 and it was horrible')).toBe(false);
		expect(isTaskMutationRequest('could not focus at all today')).toBe(false);
		// insomnia at 3am is a feeling, not a need that was scheduled and missed
		expect(isTaskMutationRequest("i couldn't sleep at 3 again")).toBe(false);
	});

	it('hears the shortest request for help there is', () => {
		expect(isTaskMutationRequest('slept like 4 hrs skipped dinner too what now')).toBe(true);
		expect(isTaskMutationRequest("what's the plan")).toBe(true);
		// a question about her is still a question, not a scheduling change
		expect(isTaskMutationRequest('why do i keep waking up at 3am?')).toBe(false);
	});
});

describe('hinglish feelings', () => {
	it('hears how the day felt, not a request for a timetable', () => {
		expect(isHinglishFeeling('arre mom, aaj kuch theek nahi lag raha, bas thak gaya hu')).toBe(true);
	});

	it('still hears an instruction written in Hindi', () => {
		expect(isHinglishFeeling('arre, dinner 7pm par shift kar do')).toBe(false);
		expect(isHinglishFeeling('aaj 9:30 paani nahi piya, yaar')).toBe(false);
		expect(isHinglishFeeling('kya karun ab, thak gaya hu')).toBe(false);
	});

	it('does not touch English notes', () => {
		expect(isHinglishFeeling('i am tired, everything is a lot today')).toBe(false);
		expect(isHinglishFeeling('ha, that sounds rough')).toBe(false);
	});
});
