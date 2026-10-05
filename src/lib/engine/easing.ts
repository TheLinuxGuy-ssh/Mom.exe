/**
 * Cubic-bezier easing solved by Newton-Raphson, so custom transitions can share exact curves
 * without pulling in a dependency or hand-rolling keyframe percentages.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
	const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
	return (t: number): number => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		let x = t;
		for (let i = 0; i < 8; i++) {
			const err = sampleX(x) - t;
			if (Math.abs(err) < 1e-6) break;
			const d = sampleDX(x);
			if (Math.abs(d) < 1e-6) break;
			x -= err / d;
		}
		return ((ay * x + by) * x + cy) * x;
	};
}

/** Decelerating curve for things arriving on screen. */
export const EASE_OUT = cubicBezier(0.16, 1, 0.3, 1);

/**
 * Near-linear and symmetric. A crossfade needs the two layers to stay complementary, so the
 * curve must not run fast at the start and trail off, which is what a front-loaded ease-out
 * would do. Holds easing(0.5) at exactly 0.5.
 */
export const EASE_SOFT = cubicBezier(0.45, 0, 0.55, 1);
