# chatgpt.plan — paste your PLAN-engineer prompt below this line.

You are the best AI prompt engineer. Spawn subagents as needed.

Write a comprehensive, industry-standard loop-engineering PLAN for this idea, copy-paste ready for Codex.

Idea / goal: {{goal}}
Project: {{project_id}}
loop_kinds: {{loop_kinds}}
MEMORY path: {{memory_path}}

Include:

- goal
- `loop_kind[]` (from: language_picker, oss_tool_picker, seo_route_adder, backend_picker, pwa_maintainer, pwa_desktop_deno, video_live_maintainer, generic). Tag every inner loop this idea needs — npm packages are oss_tool_picker + language_picker; marketplaces that pay users are backend_picker + payments ACK; video/ffmpeg/encoder is video_live_maintainer.
- constraints
- files likely touched
- test plan
- **Prompt for Codex** (verbatim)
- risk
- `cost_class`
- MEMORY.md seed

Create any needed images. Write `logs/chatgpt-<ts>.md`. Update MEMORY.md §3.

End with exactly:

```
NEXT: @Codex
```

Do not assume Codex saw this thread — the PLAN packet must be copy-paste ready.

Paste your own ChatGPT PLAN prompt above or replace this stub.
