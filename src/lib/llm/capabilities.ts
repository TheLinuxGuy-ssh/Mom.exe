/**
 * What a given model can accept, decided from its id rather than assumed.
 *
 * This exists because the request shape was written for one model family and then quietly sent to
 * another. `reasoning_effort` is an OpenAI/gpt-oss field. Gemma has no such parameter, and sending
 * it is at best ignored and at worst rejected outright — and a rejection is invisible in the app:
 * every note fails with "could not reach the model" and the user sees a generic plan.
 *
 * The rule throughout is to omit rather than risk. An unnecessary field being dropped costs nothing;
 * an unsupported one being sent costs the whole feature.
 */

/** Families that accept OpenAI-style `reasoning_effort`. */
const REASONING_EFFORT_FAMILIES = [/^openai\/gpt-oss/i, /^openai\/o[134]/i];

/**
 * Whether to send `reasoning_effort` for this model.
 *
 * Unknown models return false. That is deliberate: a model we have never heard of is more likely to
 * be a strict, unfamiliar backend than one that happens to share gpt-oss's extensions.
 */
export function supportsReasoningEffort(model: string): boolean {
	const id = (model ?? '').trim();
	if (id === '') return false;
	return REASONING_EFFORT_FAMILIES.some((re) => re.test(id));
}
