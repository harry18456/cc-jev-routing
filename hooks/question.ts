// The one question the router asks Jev, for a user's prompt and for a
// subagent's brief alike. `state` carries `prompt` and, for a main-loop turn,
// the previous exchange (`previous_user_prompt`, `previous_assistant_reply`,
// each cut to 300 characters) so that a short follow-up ("and the other
// one?") is judged in context; the wording tells Jev not to let an unrelated
// previous task move the tier of a prompt that starts something new.
export const question = {
  model: 'jev-1.13.0',
  questions: {
    tier: {
      type: 'choice',
      instructions: 'A coding assistant received `prompt`. `previous_user_prompt` and `previous_assistant_reply`, when present, are the exchange just before it; the prompt may continue that exchange or start something new. Pick the cheapest model tier that can answer the prompt well. Judge the task the prompt itself asks for, using the previous exchange only to resolve what a short prompt refers to; do not let the previous task raise or lower the tier of an unrelated prompt. Judge by the reasoning the task needs, not by the length of the text.',
      criteria: {
        haiku: 'Lookup or mechanical work with one obvious answer: find a file, symbol or value; rename; reformat or convert text; fix a typo; answer a short factual question; run or repeat a known command.',
        sonnet: 'Ordinary coding work with a clear specification: implement a small function or feature; fix a bug that has a clear reproduction; write tests for existing code; explain how a module works; review a small change.',
        opus: 'Work that needs deep reasoning or judgment: architecture or design decisions with trade-offs; debugging with an unknown root cause across several files; large refactors; security or concurrency analysis; ambiguous or under-specified requirements.',
      },
    },
  },
} as const

// How much of each previous message goes to Jev.
export const CONTEXT_CHARS = 300
