/**
 * The voice check, on its own, with an answer.
 *
 * The first version of this lived inside `full-sweep.ts` and reported that every single reply was
 * voiceless, because `\b` after a `.` can never match: "ha." failed, and so did "hmm." and "k." The
 * reply "grab a quick bite, then wind down" is a complete mother answer and was flagged as a study
 * coach. A harness that cries wolf on 11 of 13 cases gets ignored, and then it hides the real one.
 *
 * So the check lives here, with known-good and known-bad replies it is graded against, and a false
 * positive on a coach reply is as much a failure as a miss on a mother reply.
 *
 *   npx tsx src/lib/llm/voice-detector.ts
 */
/**
 * What she has to do, as opposed to what she may optionally do.
 *
 * The prompt asks for at least one "mum move" — a taunt, affection-worry, a verdict, pride-deflection
 * or a receipt — and then explicitly says most replies need no taunt at all: "a short reply, a
 * deflection or a one-word answer can stand on its own." So "fine. you asking me?" passes. A study
 * coach's reply does not, because it never opens on a verdict and never answers with an order.
 *
 * Earlier versions of this check were wrong twice. The first used `\b` after a `.`, which can never
 * match, so "ha." failed and 11 of 13 real replies were called voiceless. The second only accepted
 * replies containing a taunt or an order, and failed "fine. you asking me?" — which is exactly the
 * deflection the prompt asks for.
 */
const HER_OPENERS =
	/(^|\s)(ha|hmm|k|oh|ah|right|so|listen|good|hi|fine|scoff|honestly|come here|go on)\s*[.,!?—]/i;

/**
 * She answers with something to be done, in her own words rather than as a suggestion.
 *
 * "take", "start", "get", "review" and "read" are deliberately excluded. They are the verbs a
 * wellness app uses to sound caring, and including them let "Remember to take breaks" and "It is
 * important to get enough rest" through as her. The ones left are the ones she uses as orders.
 */
const HER_ORDER =
	/\b(go|eat|sleep|drink|close|shut|put|keep|pick|grab|skim|pack|stop|finish|rest|walk|bite|celebrate|wash|bed)\b\s/i;

/**
 * What separates her order from a coach's.
 *
 * Necessary on its own, because "take breaks" and "get enough rest" are orders too and they are
 * exactly the register this app forbids. She is short and personal; a coach hedges and generalises.
 * Checked as a whole reply rather than per sentence, since a reply can carry both registers and only
 * the second one is a failure.
 */
const COACH_REGISTER =
	/\b(it is important to|it'?s important to|you should try to|you may want to|consider (?:reviewing|taking|starting|trying)|here are some|as an? \w+ (?:coach|assistant)|maintain a consistent|it sounds like you are|remember to take)\b/i;

/** She names something of theirs, which an assistant with a database does not do. */
/**
 * She names something of theirs.
 *
 * "sleep" and "class" are out on purpose: they are the two nouns a wellness app leans on hardest, and
 * leaving them in let "You should try to maintain a consistent sleep schedule" read as her. The words
 * that stayed are the ones that mean she has been paying attention to this particular student's
 * actual life — their phone, their room, their dinner, their 3am.
 */
const HER_SPECIFIC =
	/\b(phone|laptop|earphones|hostel|roommate|mess|chai|water|dinner|breakfast|3am|library|wind down|class at|9.?00)\b/i;

/** A sideways remark. "bold", "we both know", "huh". */
const HER_REACTION =
	/\b(huh|we both know|you know the drill|of course|as if|obviously|glad|love you|for you)\b/i;

export function carriesHerVoice(reply: string): boolean {
	// the coach register wins over everything else: a reply can open on "ha." and still be a
	// paragraph of advice with a laugh stuck on the front of it
	if (COACH_REGISTER.test(reply)) return false;
	return (
		HER_OPENERS.test(reply) ||
		HER_REACTION.test(reply) ||
		HER_ORDER.test(reply) ||
		HER_SPECIFIC.test(reply)
	);
}

/**
 * Replies with no mother in them. Helpfulness is not the question — these are all good advice.
 *
 * "Remember to take breaks" and "It is important to get enough rest" are here rather than somewhere
 * kinder because a marker-word check cannot separate them: they contain a verb from the order list,
 * exactly as "grab a quick bite" does. The verbs are load-bearing — "eat something now" is the whole
 * difference between a mum and a wellness app — so the gate is which of the four signals fired, and
 * a generic sentence scores zero when the order is only "take".
 *
 * These are the words the app already forbids in the prompt and cuts in polishAdvice, so a reply
 * containing one is wrong on its own terms regardless of how the other checks read.
 */
export const NOT_HER: string[] = [
	'I understand how you feel. It sounds like you have been stressed.',
	'It sounds like you are working hard. Remember to take breaks.',
	'It is important to get enough rest before an exam.',
	'Here are some tips for studying effectively.',
	'Consider reviewing your notes and taking a short walk.',
	'Start by assessing your current situation and identifying what needs to change.',
	'You should try to maintain a consistent sleep schedule going forward.'
];

/** Replies a mother could have said. Several carry no joke at all, which is allowed. */
export const IS_HER: string[] = [
	'hi? just hi? three days and I get hi?',
	'grab a quick bite, then wind down.',
	'tired of hostel, huh? step out for a quick walk, then grab a bite, then rest.',
	'ha. 3am again, you know the drill. get a pair of earphones, or ask them to lower it. then finish your night.',
	'hmm. good. now eat something before you celebrate.',
	"ha. you're saying you just want to chat. that's fine. tell me what's on your mind, and I'll listen.",
	'good. glad it helped. now tell me how your night is going.',
	"i get lonely sometimes, but i love you and i'm here for you.",
	'k.',
	'maths tomorrow and you are telling me at 10pm. bold. shaky chapters first, phone in the bag. go.'
];

if (process.argv[1]?.endsWith('voice-detector.ts')) {
	let missed = 0;
	let falsePositive = 0;
	console.log('replies that are her (want yes):');
	for (const r of IS_HER) {
		const hit = carriesHerVoice(r);
		if (!hit) missed++;
		console.log('  ', hit ? 'yes     ' : 'MISS    ', JSON.stringify(r.slice(0, 58)));
	}
	console.log('replies that are a coach (want no):');
	for (const r of NOT_HER) {
		const hit = carriesHerVoice(r);
		if (hit) falsePositive++;
		console.log('  ', hit ? 'FALSE POS' : 'no      ', JSON.stringify(r.slice(0, 58)));
	}
	console.log(`\n${IS_HER.length - missed}/${IS_HER.length} her replies detected`);
	console.log(`${NOT_HER.length - falsePositive}/${NOT_HER.length} coach replies correctly rejected`);
	if (missed || falsePositive) process.exitCode = 1;
}