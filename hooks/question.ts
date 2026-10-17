// The one question the router asks Jev, for a user's prompt and for a
// subagent's brief alike. `state` carries `prompt` and, for a main-loop turn,
// the previous exchange (`previous_user_prompt`, `previous_assistant_reply`,
// each cut to 300 characters) so that a short follow-up ("and the other
// one?") is judged in context; the wording tells Jev not to let an unrelated
// previous task move the tier of a prompt that starts something new.
//
// Each tier is described by what the task needs (steps, judgment, how clear
// the goal is, how long it must run on its own), then by examples from
// several kinds of work. Tiers described only as coding work left research
// and writing prompts between tiers, at low confidence; a probe of real and
// written prompts found this wording no worse on the first and better on the
// second. Jev's confidence is (K·max(p) − 1)/(K − 1) for K choices, so with
// four tiers min_confidence 0.6 asks for a top tier at 70%.
export const question = {
  model: 'jev-1.13.0',
  questions: {
    tier: {
      type: 'choice',
      instructions: 'An AI assistant received `prompt`. `previous_user_prompt` and `previous_assistant_reply`, when present, are the exchange just before it; the prompt may continue that exchange or start something new. Pick the cheapest model tier that can do the task well. Judge by what the task needs (how many steps, how much judgment, how clear the goal is, and how long it must run on its own), not by its subject (code, writing, research or operations) and not by the length of the text. Use the previous exchange only to resolve what a short prompt refers to. The examples under each tier show typical cases from several kinds of work; they are not a complete list.',
      criteria: {
        haiku: 'One step with one obvious answer. Code: find a file, symbol or value; rename; fix a typo; run a known command. Writing: reformat, convert or translate a short text. Research: answer a short factual question. Operations: check a status or read a setting.',
        sonnet: 'A few steps toward a clear goal by a known method. Code: implement a small function or feature; fix a bug with a clear reproduction; write tests; explain how a module works. Writing: draft a document from a clear outline. Research: summarise one source, or compare a few known options on stated criteria. Operations: write a script, config or CI job for a known setup.',
        opus: 'Many steps that need judgment. Code: design with trade-offs; debug an unknown cause across files; large refactors; security or concurrency review. Writing: organise scattered material into a long structured document. Research: study a large codebase or several sources in depth and reconcile conflicting claims. Operations: diagnose an incident or plan a migration. Also any goal that is unclear or under-specified.',
        fable: 'Long-horizon work that must run largely on its own, where opus would likely fall short. Code: build or migrate a whole system end to end. Research: a multi-stage investigation whose findings shape the next stage, or an open problem with no known approach.',
      },
    },
  },
} as const

// How much of each previous message goes to Jev.
export const CONTEXT_CHARS = 300
