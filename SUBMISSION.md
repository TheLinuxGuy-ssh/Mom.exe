# Dev.to submission post — Hacktoberfest Weekend Challenge: Build for a Friend

*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

## What I Built

**Mom.exe — a wellness coach for my friend, who moved out of home for the first time this year.**

She is a first-year hostel student. Not my imagination: mess timings that close at 9:30, a 9am lab
after a 2am finish, a roommate who comes back loud, and nobody around who knows what time she should
be in bed. She asked me to just tell her what to do each day. She also, immediately, hated being told
what to do.

So I built the thing she actually wanted instead: something that plans her day around her real class
schedule, mess windows and deadlines, and never once tells her she has failed at anything.

What it does:

- You write a note in your own words — *"couldn't hydrate at 9:30, friends were in"* — and it
  returns a concrete plan for the rest of the day and night, with the missed need folded into a later
  block rather than a lecture.
- Chatting and planning are the same box. The model decides which one you meant, so asking for a change
  from inside a conversation redoes the day and hands you back the timeline.
- It remembers across weeks. The last 20 messages are resent verbatim, older weeks are compressed
  into digests, so the conversation stays bounded without going amnesiac.
- It has a mother.

The load-bearing decision was negative. There is no streak counter, no "you missed breakfast again",
no reopening a block you already failed to do. The entire point is that she already knows. What the
app is allowed to do is notice a pattern once you point it out, and quietly rearrange the remainder.

It also has a deterministic planner written in plain code, used when the model is unreachable or
untrustworthy. That sounds like a fallback, but it turned out to be the honest answer to a problem I
could not solve with prompting — see the measurements below.

## Demo

- Live: [momexe.vercel.app](https://momexe.vercel.app)
- Code: https://github.com/TheLinuxGuy-ssh/Mom.exe

The code is the more honest demo. Everything below is reproducible from a clean checkout with one
provider key, and I would rather you run it than watch me.

```bash
npm install
cp .env.example .env      # add NIM_API_KEY and your Supabase values
npm run dev               # works with no configuration at all
npm run check-nim         # proves the model answers before you trust anything
npm run test:student      # 32 first-person student exchanges through the real pipeline
npm run eval              # plan validity, medical claims, shame, latency
```

## Code

{% embed https://github.com/TheLinuxGuy-ssh/Mom.exe %}

## How I Built It

**Open-weight AI at the core, with nothing hidden behind it.** `openai/gpt-oss-20b` on NVIDIA NIM,
called through a Supabase edge function so the key never reaches the browser.

The architecture is a SvelteKit SPA (Svelte 5, Tailwind 4) with Supabase for Postgres, auth and
storage, and a code planner that is a genuine peer of the model rather than a stub.

The parts I spent the weekend on were not the parts that look impressive:

- **A strict JSON contract with independent validation.** Every reply is one envelope of `intent`,
  `understanding`, `advice`, `plan`, `handoff`. Each section is validated separately, so a broken plan
  never discards a good understanding of what the student said.
- **Prompt engineering against a measured failure.** Not "write a nice prompt" — I ran 32 scripted
  student exchanges through the real pipeline repeatedly and fixed what the harness caught. It found
  things I would never have predicted:
  - The model sometimes spends its entire token budget on reasoning and returns *nothing*. One retry
    with double the room fixes it.
  - It sometimes answers in plain sentences instead of the envelope. Those sentences are the answer;
    discarding them to show a generic schedule was worse than the bug that caused it.
  - When told "I couldn't sleep at 3am" it wanted to answer. Insomnia at 3am wants a conversation, not
    a timetable, so the routing guard distinguishes a mood from a scheduling constraint.
  - `could not` and `couldn't` are a missed need; `cannot` and `can't` were already recognised. So my
    own README's headline example only worked for students who happened to type the contraction.
- **Privacy by construction.** Notes are scrubbed of names, emails, phone numbers and links *before
  they are stored*, so what the model sees is what the history shows, and the schemas have no field
  where PII can land. The scrubber is pattern-based and I documented exactly what it cannot catch: a
  lowercase `im arun` reads exactly like `im tired`, and I would rather lose one name than delete the
  word a note was actually about.
- **Deterministic recovery, everywhere.** Every network call is guarded. A dropped connection used to
  leave the page on its skeleton forever, or make a tap look ignored. Now every failure either
  degrades visibly or rolls back.

### The honest part

I re-measured before writing this, and I am not going to quote numbers I got on a good day:

| Metric | Result |
| --- | --- |
| Intent routing (32 scripted exchanges) | 29–32 of 32, varying by provider load |
| Plan validity (4 synthetic personas) | **5 of 8, and the repair retry does not fix it** |
| No medical claims / no scorekeeper language | 8 of 8 |
| Latency | 7–31s |

An earlier draft of my README claimed 8/8 plan validity. Re-measured honestly it is 5/8, and roughly
one note in four is handled by the code planner instead of the model. That is a real limitation of an
open 21B model asked for a strict envelope, and no amount of prompt wording closed it.

So the code planner stopped being a nice-to-have and became the honest fallback: when the model's plan
cannot be trusted, a day written in code is a better answer than no day. Schema-constrained decoding
is the fix I want next, because it removes invalid output instead of detecting it afterwards.

I also spent real time on **models I could not ship**, because finding out what does not work is part
of the result:

- **Gemma**, to enter the Gemma prize category. NVIDIA is not serving this project a Gemma —
  `gemma-3-27b-it` returns 410 retired, the rest 404 or hang — and locally there is no GPU and 7GB of
  RAM, so the 4B variant would add a minute to every note.
- **OpenRouter**, same model, cleaner plumbing. The migration exposed a genuine bug: `reasoning_effort`
  is an OpenAI/gpt-oss field OpenRouter rejects, and the rejection surfaced to users as "could not
  reach the model" on every note. That became `src/lib/llm/capabilities.ts`, so the request shape is
  now model-aware — which is what makes the next provider swap a one-line change instead of a hunt.

## Why Does Open Innovation Matter?

**Because the interesting parts of this app only exist because the model is inspectable.**

I could have shipped this on a closed API and every feature above would still work. Three things would
not have:

- **The failure modes are the design.** An empty completion, a prose reply instead of JSON, a plan that
  violates its own schema — I found all of them only because I could read the raw output, point a
  script at 32 real student messages, and get the same failure on demand. With a closed API the failure
  is a support ticket.
- **The privacy claim is only honest because of it.** I can say "your note is scrubbed before it is
  stored" and mean it, because I can verify what leaves the browser. Open weights are what makes
  scrub-then-store possible; it would be a promise I could not keep on someone else's inference stack.
- **I can fix the contract instead of the symptom.** When the model returned invalid plans I could add
  a repair path, a stricter prompt, a deterministic planner, and eventually constrained decoding. With a
  closed model I could only file a ticket and hope.

Open weights also mean the honest failure modes are *visible* failure modes. A 21B model getting a
strict JSON envelope wrong three times in eight is something I can measure, publish, and put a number
on. That number is more useful to everyone than a demo that pretends the problem does not exist.

## My Agent Session

<!-- Optional. I worked with an open-source coding agent throughout, and the session log is the more
interesting artifact for several of the fixes above — the malformed-envelope bug in particular was
found by instrumenting the pipeline rather than by reading it. -->

## Prize Categories

<!-- Remove this section if you are not entering a partner category. -->

**Best Use of Entire** — the agent sessions behind this project are genuinely part of the result. The
malformed-JSON, empty-completion and `could not`-vs-`cannot` bugs above were found by instrumenting
and re-running, not by reading code, and the write-up is more useful with the session trail included.

I evaluated several other categories and am **not** claiming them, because claiming a category I did
not genuinely use would defeat the point:

- **Best Use of Gemma** — evaluated and documented above; NVIDIA does not serve a Gemma to this project
  and the hardware cannot run one locally.
- **Best Use of TabPFN, DigitalOcean, Tinker, Render, Arduino** — not used.

The most honest next step for this project is **DigitalOcean**: self-hosting this same open-weight
model on a GPU Droplet would remove the third-party dependency entirely, and it is the provider
fragility — retired model ids, key limits, one rejected parameter taking the whole app down — that
cost more of this weekend than any feature did.