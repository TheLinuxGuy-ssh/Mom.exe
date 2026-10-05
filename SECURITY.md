# Security Policy

## What this app does and does not hold

Mom.exe is a wellness coach, and the honest summary of its security posture is one sentence: **the
model never holds anything that identifies you, because the note is scrubbed before it is stored,
let alone before it is sent.**

Specifically:

- Notes, plans and conversation history are written to Supabase Postgres only after
  `scrubText` has replaced names, email addresses, phone numbers, and links. The history tab shows
  the same scrubbed text the model saw.
- The schemas have no field for a name, an email address, or a birth date. `birth_year` is stored,
  never a date of birth, and the model receives an age band rather than a year wherever it matters.
- The NVIDIA NIM key lives only in the Supabase function environment. It is never a `VITE_*`
  variable, so it cannot be inlined into the browser bundle.
- The browser talks to the model only through the Supabase edge function, which requires a signed-in
  user's JWT and drops unknown keys from the payload.
- Export and permanent deletion of everything are both available in Settings. Deletion removes
  profiles, check-ins, plans, messages, and weekly digests.

## What this app is not

It is not medical software, and it is not a place to put anything you would not want a stranger
reading. A wellness coach that writes your day is not a place for medical records, and the prompt
refuses medical framing by design.

## Reporting a vulnerability

Please **do not open a public issue first.** Use GitHub's private reporting:

**Security → Report a vulnerability** on this repository.

Include what an attacker could do, which surface it touches (browser, edge function, storage), and a
reproduction if you have one. You can expect an acknowledgement within a few days and a fix or an
explanation of why it is not a vulnerability.

If private reporting is unavailable to you, email the maintainer rather than filing a public issue.

## Scope

In scope:

- the Supabase edge function in `supabase/functions/`
- anything reachable from the browser bundle
- the storage backends in `src/lib/storage/`
- the PII scrubber in `src/lib/engine/scrub.ts`

Out of scope:

- your Supabase project configuration, keys, or database policies
- `NIM_API_KEY` handling inside NVIDIA's own infrastructure
- reports from automated scanners with no demonstrated impact
- the wellness advice itself. Disagreeing with what the coach says is a product conversation, and
  issues are the right place for it