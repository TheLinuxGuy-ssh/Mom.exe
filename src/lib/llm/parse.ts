export function extractJsonText(text: string): string | null {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1].trim() : trimmed;
	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	return candidate.slice(start, end + 1);
}

export function tryParseJson(text: string): unknown | null {
	const candidate = extractJsonText(text);
	if (!candidate) return null;
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}

/**
 * Pull the reply out of an envelope that will not parse.
 *
 * The model writes the reply first and the JSON around it second, so when the braces come out wrong
 * the words are usually intact and sitting right there. Live runs returned
 * `{"intent":"chat","understanding":"sleep_hours":3,...}` and a doubled closing brace after the
 * understanding object, both unreadable, both with a perfectly good reply inside. That reply is the
 * answer to somebody who typed a message, so it is worth one regex rather than a second round trip
 * to the model.
 *
 * Deliberately narrow: advice only. A plan cannot be salvaged from a broken string, because a
 * half-understood schedule is worse than the deterministic planner.
 */
export function salvageAdvice(text: string): string | null {
	const m = text.match(/"advice"\s*:\s*"((?:[^"\\]|\\.)*)"/);
	if (!m || !m[1]) return null;
	const out = m[1]
		.replace(/\\n/g, ' ')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\')
		.trim();
	return out.length >= 8 && out.length <= 600 ? out : null;
}
