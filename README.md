# Mom.exe

Your mom, but as an executable. A wellness coach for students who moved out of home and lost the one scheduler that ever worked. It looks at your real classes, mess timings, deadlines and sleep, and plans the rest of your day and tonight. It works even if you never check in.

Wellness coach, **not medical advice**. No streaks. No guilt. Missing days are unknown, never zero.

## Quickstart

```bash
npm install
npm run dev
```

The app starts in **local mode** out of the box: all data stays in your browser's localStorage, and the plan generator falls back to a deterministic in-code template plan when no model is reachable.

### Bring your own open-weight model

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.1:8b`
2. Run it with CORS open: `OLLAMA_ORIGINS=* ollama serve`
3. In Mom.exe: Settings -> the brain -> local -> check connection -> done.

Swapping models is a config change (try `qwen2.5:7b`, `mistral`, anything Ollama serves). The LLM client is a plain OpenAI-compatible wrapper: base URL, model, key.

### Hosted mode (Supabase + NVIDIA NIM)

1. Create a Supabase project, run `supabase/migrations/schema.sql`.
2. Deploy the edge function: `supabase/functions/plan` (it holds `NIM_API_KEY` server-side).
3. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_NIM_MODEL` in `.env`.
4. `npm run build` and deploy anywhere static.

Hosted mode is honest: anonymized context (never your name, email or birth date) goes to an open-weight model on NVIDIA NIM. Local mode keeps everything on your machine.

#### Email sign-in setup (do this or users get links with no code)

Supabase's Magic Link and Email OTP share one implementation (`signInWithOtp`); the email content decides which you get. The default template sends **only a link**, so the 6-digit code field would be useless. Two dashboard changes:

1. **Auth → URL Configuration**: set the Site URL to your deployed URL and add `http://localhost:5173/**` plus your production URL to Redirect URLs. Mom.exe passes `emailRedirectTo: <origin>/login`, which must be on this list.
2. **Auth → Email Templates → Magic Link**: paste the full template from [`supabase/templates/magic-link.html`](supabase/templates/magic-link.html) (subject suggestion: `Check in with Mom — your code inside`). It contains both `{{ .ConfirmationURL }}` and `{{ .Token }}`, styled to match the app.

The link path needs no code: the user taps it on the same device, lands back on `/login`, and the app catches the session automatically (`token_hash`/URL detection + `onAuthStateChange`). The code path calls `verifyOtp({ email, token, type: 'email' })` and accepts 6-10 digits (Supabase's OTP length is configurable under Auth → Email). Codes and links expire after 1 hour; one request per 60 seconds (Supabase defaults).

## How it works

```
note ("slept at 4am, woke at 10, didn't eat breakfast. how do i fix this?")
  -> PII scrubber (code)
  -> ONE open-weight model call: note + context in,
       { understanding, advice, plan } out
       understanding = AI-verified intent (negation-aware: "didn't eat" = skipped)
       advice        = direct answer to the question in the note
       plan          = the rest of today + tonight (fixed action vocabulary)
  -> normalize: alias-map actions/flags (lunch -> eat_meal), repair times,
       drop overlaps, sort (small open models drift; the app doesn't)
  -> stored structurally (Supabase w/ RLS, or localStorage)
       merge precedence: your taps > AI understanding > keywords > existing row
  -> schema-constrained, zod-validated; bad output? one repair retry,
       then the deterministic in-code template planner (the app always plans)
  -> dashboard: one NOW hero card with countdown, one-line "then:",
       full day on tap, done/skip marks, replan from now
```

- Frontend: SvelteKit (SPA mode) + TypeScript + Tailwind CSS 4, icons by Lucide.
- Storage: one small interface, two implementations (localStorage today, Supabase when env is set; SQLite/Electron is a planned third).
- AI: OpenAI-compatible client, configurable base URL/model/key. NVIDIA NIM (open weights) hosted, Ollama local. If the model is slow or down, the app still plans.

## Evaluate plan quality

```bash
NIM_API_KEY=... npm run eval
```

Runs four synthetic personas (freshman, night owl, exam crunch, ghost/stale-data) through the pipeline and reports schema validity, no-medical-claims and no-shame checks, and latency. Without a key it evaluates the template fallback.

## Repo layout

```
src/lib/engine     time, stats, context builder, note extraction, PII scrubber
src/lib/llm        client, prompts, zod schemas, parser, template fallback
src/lib/storage    storage interface + localStorage + Supabase impls
src/lib/components Composer, Timeline, StickyNote, Mascot, strips...
src/routes         landing, login, onboarding, dashboard, history, settings
supabase/          schema.sql (RLS) + plan edge function (NIM proxy)
dev-fixtures/      synthetic personas
scripts/eval.ts    model evaluation harness
```

## Privacy, honestly

- The model never sees your name, email or exact birth date. Notes are scrubbed before anything leaves; the extraction and plan schemas have no field where PII could land; the edge proxy drops unknown keys.
- Hosted mode sends anonymized behavioral context to a third-party API (NVIDIA NIM, open-weight models). Local mode (Ollama) sends nothing anywhere.
- Export or wipe all your data from Settings at any time.

## Deploy to Vercel

This is a static SPA (`adapter-static` -> `build/`), and `vercel.json` already wires the important parts.

```bash
npx vercel            # preview
npx vercel --prod     # production
```

What `vercel.json` handles for you:

- `framework: null` + `buildCommand` + `outputDirectory: build` so Vercel treats this as a plain static site instead of applying its SvelteKit (SSR) preset, which would look for `.svelte-kit/output`.
- A catch-all rewrite to `/index.html`, excluding `_app`. Without it a shared link like `/dashboard` would 404, because an SPA build emits **only** `index.html` (verified: `build/` contains no per-route HTML). Real files (`og-image.png`, `robots.txt`, `favicon.svg`, `_app/*`) are served from the filesystem first, so they are never rewritten.
- Long-lived immutable caching for hashed `_app` assets, plus `nosniff`, `Referrer-Policy`, `X-Frame-Options` and a locked-down `Permissions-Policy`.

Set these as Vercel environment variables (**Settings -> Environment Variables**, for both Preview and Production, then redeploy — `VITE_*` values are baked in at build time):

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | for hosted mode | your project URL; setting it flips the app into proxy mode |
| `VITE_SUPABASE_ANON_KEY` | for hosted mode | public anon key, safe in the browser |
| `VITE_NIM_MODEL` | recommended | a **live** NVIDIA NIM model id, e.g. `openai/gpt-oss-20b` (`npm run check-nim` to verify) |

`NIM_API_KEY` must **not** be a Vercel build env var. Only `VITE_*` variables reach the browser bundle, and the key is only ever read by the Supabase edge function. Store it as a Supabase secret:

```bash
supabase link --project-ref <your-ref>
supabase secrets set NIM_API_KEY=nvapi-...
supabase functions deploy plan
```

Without `VITE_SUPABASE_URL` the app runs fully local: localStorage storage, and it plans via Ollama (or the in-code template planner) with no backend at all. That is the fastest way to demo, and it needs zero configuration.

Two post-deploy chores: set your real domain in `src/app.html`, `static/robots.txt` and `static/sitemap.xml` (currently the `mom-exe.vercel.app` placeholder) so link previews point at the right origin, and upload `static/og-image.png` under repo Settings -> Social preview for the GitHub card.

## SEO, thumbnail and logo

Link previews (GitHub, X, Discord, LinkedIn, Slack) read tags from `src/app.html` — they never run JS, so the Open Graph + Twitter Card tags live there, not in `svelte:head`.

When you deploy, replace the placeholder domain:

- `src/app.html`: swap every `https://mom-exe.vercel.app` for your real URL (canonical, og:url, og:image, twitter:image, robots.txt sitemap reference).
- `static/og-image.svg`: the thumbnail source of truth (1200×630). Edit it, then run `npm run og` to regenerate `static/og-image.png`. PNG is what crawlers actually render — keep the SVG in sync.
- `static/favicon.svg`: the logo (the wobbling mug). Replace freely; also used as the apple-touch-icon.
- `static/robots.txt` + `static/sitemap.xml`: update the domain in both.

## Troubleshooting: "planned in code, not by the model"

That banner means the model call failed and Mom.exe fell back to its deterministic code planner (it always has a plan, so the app never hard-fails). The banner now prints the actual reason. Work through it in this order:

1. **Is the edge function deployed?** `curl -i <VITE_SUPABASE_URL>/functions/v1/plan/health` → `200` means deployed; **`404` means it does not exist yet** and no env var can fix that. Deploy it:

   ```bash
   supabase link --project-ref <your-ref>
   supabase secrets set NIM_API_KEY=nvapi-...     # server-side only, never in the client bundle
   supabase functions deploy plan
   ```

2. **Is the model still on NVIDIA NIM?** Model IDs get retired. Verify yours live:

   ```bash
   npm run check-nim
   ```

   This probes NIM with your key and prints `LIVE / EOL / NOPE` per model. As of writing, `openai/gpt-oss-20b` and `moonshotai/kimi-k3` respond; `meta/llama-3.1-8b-instruct` returns `410 Gone` (retired), and several older Qwen/Mistral/Nemotron IDs return `404`. Keep `VITE_NIM_MODEL` set to a LIVE id.

3. **Are you signed in?** Hosted mode is the proxy, and the proxy requires a Supabase user JWT. In browser-local mode (the "skip, use this browser" button) there is no token, so the proxy correctly refuses. Settings -> the brain says so explicitly. Either sign in with email, or switch the base url to Ollama for local.

4. **Local mode?** Start Ollama with CORS open: `OLLAMA_ORIGINS=* ollama serve`, then `ollama pull llama3.1:8b`, and Settings -> check connection. A dead Ollama now reports its own address instead of "unreachable".

Two structural guarantees behind these paths: `NIM_API_KEY` is only ever read by the edge function (a `NIM_API_KEY` in `.env` cannot reach the browser bundle — only `VITE_*` vars can, which is exactly why the key must be a Supabase secret), and the client accepts either an OpenAI-shaped response or the flat `{ content }` shape the proxy returns.

### Measured behaviour (gpt-oss-20b on NIM, this repo's own eval)

| Metric | Value |
|---|---|
| Plan validity, first shot | 8/8 across 4 synthetic personas |
| Plan validity after one repair retry (what the app does) | 8/8 |
| Note-understanding field accuracy (AI + merge, 10 notes x 2 runs) | 22/22 |
| Latency, one combined call | 7-17s typical |
| Model output length | ~2.3k chars |

That latency is inherent to *reasoning* models on a long context, and it is why `reasoning_effort` matters: at the default `medium`/high the same call burned the entire token budget on reasoning and returned **zero content** (41s, `finish_reason: length`), which surfaced as the unreachable banner. `reasoning_effort: 'low'` (now the default) cut the same call to ~12s with full output. If you want a snappier demo, swap to a smaller non-reasoning model in Settings, or use Ollama locally.

Because open models drift outside the fixed vocabulary (`"action": "lunch"`, invented flag names), `src/lib/llm/normalize.ts` repairs near-miss output before validation: it alias-maps actions and flags (`lunch` → `eat_meal`, `late_caffeine` → `high_caffeine_evening`), repairs loose times (`9.30` → `09:30`), truncates over-long fields, drops overlaps, and sorts the day. Only if nothing usable survives does the deterministic template planner take over.

Keyword heuristics are demoted to a typing-preview and offline fallback, with a negation-aware parser (`"didn't eat breakfast"` = skipped, never eaten; negation never leaks across a comma into the next clause). Run `EVAL_NOTES=1 npm run eval` to reproduce the note-understanding table.

## License

MIT. Built for a friend, for the Hacktoberfest Weekend Challenge. Open weights at the core: local inference when you want it, hosted open-weight models when you don't.
