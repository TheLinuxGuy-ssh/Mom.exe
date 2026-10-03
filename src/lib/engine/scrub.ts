export function scrubText(text: string): string {
	return text
		.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
		.replace(/https?:\/\/\S+/g, '[link]')
		.replace(/\b(?:my name is|i am|i'm|im|call me)\s+[A-Z][a-z]+/gi, '[name removed]')
		.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (/[a-z]/i.test(m) ? m : '[phone number]'))
		.trim();
}

export function ageBand(birthYear: number | null, nowYear: number): string {
	if (!birthYear) return 'unknown';
	const age = nowYear - birthYear;
	if (age < 18) return 'under_18';
	if (age <= 21) return '18-21';
	if (age <= 25) return '22-25';
	return '26_plus';
}
