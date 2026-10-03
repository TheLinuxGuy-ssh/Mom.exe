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
