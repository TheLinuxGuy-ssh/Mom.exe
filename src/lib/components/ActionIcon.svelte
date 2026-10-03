<script lang="ts">
	import MoonStar from 'lucide-svelte/icons/moon-star';
	import Utensils from 'lucide-svelte/icons/utensils';
	import Cookie from 'lucide-svelte/icons/cookie';
	import Coffee from 'lucide-svelte/icons/coffee';
	import LampDesk from 'lucide-svelte/icons/lamp-desk';
	import Sun from 'lucide-svelte/icons/sun';
	import Dumbbell from 'lucide-svelte/icons/dumbbell';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import GraduationCap from 'lucide-svelte/icons/graduation-cap';
	import Users from 'lucide-svelte/icons/users';
	import MonitorOff from 'lucide-svelte/icons/monitor-off';
	import Droplets from 'lucide-svelte/icons/droplets';
	import Armchair from 'lucide-svelte/icons/armchair';
	import Moon from 'lucide-svelte/icons/moon';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import CoffeeCup from 'lucide-svelte/icons/coffee';

	const MAP: Record<string, typeof MoonStar> = {
		nap: MoonStar,
		eat_meal: Utensils,
		snack: Cookie,
		caffeine_cutoff: Coffee,
		wind_down: LampDesk,
		light_exposure: Sun,
		exercise: Dumbbell,
		study_block: BookOpen,
		class: GraduationCap,
		social_time: Users,
		screen_off: MonitorOff,
		hydration: Droplets,
		me_time: Armchair,
		sleep: Moon,
		free: Sparkles
	};

	let { action, size = 18 }: { action: string; size?: number } = $props();
	const Icon = $derived(MAP[action] ?? CoffeeCup);
</script>

<Icon class="shrink-0" width={size} height={size} stroke-width={2.5} />
