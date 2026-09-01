# @ChatGPT — ideate PLAN packet

The live briefing text is **`prompts/chatgpt/plan.md`** (`id: chatgpt.plan`). Paste your PLAN-engineer prompt there. HQ first mention and IDE `route peer=chatgpt params.promptId=chatgpt.plan` use that file verbatim, then append the Memory packet and the idea quote.

Stub until you replace it: spawn subagents; write a Codex-ready LOOP PLAN (goal, `loop_kind[]`, constraints, files, test plan, **Prompt for Codex**, risk, `cost_class`, MEMORY.md seed). Create images. Write `logs/chatgpt-<ts>.md`. End with exactly:

```
NEXT: @Codex
```

Read the Memory packet in the thread (and MEMORY.md) before acting. Do not assume Codex saw this thread — the PLAN packet must be copy-paste ready.

Switch prompts in a thread with `/prompt list` and `/prompt use chatgpt.plan`.
