# Active goal

Last reviewed: 2026-07-28

Build an agent-controlled FFXI character that can fight, recover, travel,
progress, and earn currency reliably on the isolated LandSandBoat server while
keeping fast reactions in deterministic local code and higher-level decisions
in MCP/Codex.

This file is the current gameplay source of truth. `docs/roadmap.md` remains the
server and infrastructure roadmap. The original deployment-research goal is
complete: the local server, Windows client, AgentBridge/MCP control plane,
streaming setup, live gameplay loop, documentation, and public source
repository now exist.

## Current state

- Character: Pablo, Hume male, Monk level 10.
- Progress: 1,369/2,600 EXP.
- Gil goal: 469/10,000 gil.
- Records of Eminence: 900 sparks; `Vanquish Multiple Enemies I` at 40/200.
- Trust: Naji acquired and validated; he uses Provoke after Pablo engages.
- Control: AgentBridge 0.19.0, guarded service travel, exact-ID combat,
  automatic Combo, allowlisted loot sales, and a bounded reactive aggro guard.
- Travel: Metalworks Home Point #2 and Bastok Markets Home Point #3 are
  registered and cached.
- Farming exclusions: no proactive worms, Stone Eaters, Huge Hornets, or
  Vultures.
- Vulture finding: coarse positioning, facing, and a target-locked `/follow
  <t>` approach down to 1.13 yalms all failed to register combat against
  multiple exact IDs. The family stays excluded pending separate diagnosis.
- Known dangerous area: the western South Gustaberg Quadav pocket around
  `(10, -170)` is excluded until multi-aggro handling passes.

## Goal 1 — validate and harden the new combat system

Status: **active**

Keep testing combat before expanding the progression route. Combine proactive
mob selection with the reactive aggro guard so one local supervisor owns the
whole encounter instead of competing scripts.

### Required behavior

- Detect unexpected aggro and begin defending without an LLM decision.
- Keep fighting the current live target; queue nearby adds and switch after a
  defeat instead of disengaging.
- Target by exact server ID in a full 360-degree observation.
- Let Naji Provoke after engagement.
- Use Combo automatically at 1,000 TP.
- Never proactively select worms, Stone Eaters, Huge Hornets, or Vultures.
- Never teleport while Pablo is attacked or engaged.
- Stop on logout, zoning, death, lease expiry, or emergency stop.
- Recover between fights only when safe; return to the Home Point after death.
- Keep concise state changes visible in the Agent Activity overlay.

### Test sequence

1. Run ordinary single-target fights against Walking Saplings; diagnose
   Vulture registration separately before re-enabling that family.
2. Validate continuous multi-fight operation without per-fight model calls.
3. Trigger one controlled low-level aggro while idle.
4. Trigger a controlled two-enemy add case in an open area.
5. Validate target handoff after the first enemy dies.
6. Validate automatic weapon-skill use.
7. Validate safe recovery between encounters.
8. Validate automatic death detection and Home Point return separately.

### Exit criteria

- 30 consecutive approved fights without a preventable aggro death.
- At least three controlled multi-enemy encounters won with correct target
  handoff.
- Aggro-to-attack latency measured and consistently below one second on the
  local bridge.
- No proactive excluded-family pulls.
- No teleport or recovery action issued during combat.
- A single start/status/stop farm lease is exposed through MCP.

### Validation scoreboard

- Consecutive clean unattended fights: **3/30**. Lease
  `840c0fee-3e26-4f79-9e25-b991dec0d691` defeated two Walking Saplings and one
  Rock Lizard, stopped itself at the fight limit, and had zero rejected
  attacks, target-cycle errors, deaths, excluded pulls, or forbidden actions.
- Controlled multi-enemy handoffs: **0/3**.
- Reactive defense: **1 clean live win**. A Young Quadav that had already
  aggroed Pablo was engaged in 551 ms, defeated, and awarded 80 EXP and 6 gil.
- Automatic weapon skill: **validated** with two Combo uses in that reactive
  fight.
- Safe recovery: **validated** from 38% to above 90% while idle. The supervisor
  now waits for the post-rest stand-up state before service positioning.
- MCP lease controls: **validated** for start, status, cooperative stop,
  fight-limit stop, heartbeat, counters, and structured logs.
- Reward accounting: **validated** against FFXI control-byte suffixes and a
  clean per-lease event baseline.
- Remaining Goal 1 gaps: 27 clean fights, three controlled add handoffs,
  repeated sub-second reactive samples, and death/Home Point recovery.

## Goal 2 — reach 10,000 gil while leveling

Status: queued behind Goal 1

- Continue selling only fixed allowlisted loot in sensible batches.
- Check inventory between farming batches, not after every fight.
- Keep the numeric stream overlay synchronized with verified gil events.
- Prefer normal drops and Records of Eminence rewards over administrative
  grants.
- Reach 2,755 sparks and validate the normal Acheron Shield sparks-to-vendor
  conversion if it remains available on this server. Its local base sell value
  is 27,550 gil, so one legitimate conversion completes this milestone.

## Goal 3 — compound normal play with Records of Eminence

Status: in progress passively

- Keep only objectives matching the current camp and combat behavior active.
- Continue the general damage, weapon-skill, defeat, and spoils counters.
- Complete at least ten objectives to unlock Unity Concord.
- Join a useful Unity and validate accolades, Unity warps, and its Trust.
- Use Sparks first for the gil milestone and then for appropriate leveling
  equipment.

## Goal 4 — build a balanced Trust party

Status: queued

- Keep Naji as the first validated damage/provoke companion.
- Acquire and test a tank, healer, and support option.
- Record each Trust's observed combat role rather than relying only on guide
  descriptions.
- Test party composition under the same combat-supervisor metrics.
- Later unlock fourth and fifth Trust slots through Rhapsodies progression.

## Goal 5 — expand reliable fast travel

Status: partially implemented

- Register every nearby safe Home Point and Survival Guide.
- Cache Waypoints and verified outpost access for route planning.
- Use normal registered travel when it is reliable.
- Keep guarded private-server teleport as the default fallback until
  collision-aware navigation passes its own reliability target.
- Never confuse discovering a travel object with registering it.

## Goal 6 — follow the early-game progression path

Status: queued after combat reliability

The progression checklist is based on VelnerXI's
[Starting Final Fantasy XI in 2026!? New Player Starting Guide Tips & Tricks](https://www.youtube.com/watch?v=jZhna6hBcr8),
cross-checked against Square Enix's
[FFXI Starter Guide](https://forum.square-enix.com/ffxi/threads/64413-FINAL-FANTASY-XI-Starter-Guide)
and our live server.

- Obtain Signet before field sessions and verify its expiry/state.
- Continue the Bastok nation missions and raise national rank.
- Begin Rhapsodies of Vana'diel when its prerequisites are met.
- Prioritize Rhapsodies rewards that improve EXP, travel fees, and Trust party
  capacity.
- Test Fields or Grounds of Valor only after the unattended combat loop is
  stable, selecting pages that match the current safe camp.
- Register travel nodes encountered during every progression step.

## Goal 7 — quests and broader autonomy

Status: later

- Resume ordinary quests after combat, travel, recovery, and gil are reliable.
- Add reusable MCP workflows for accepting, tracking, and completing quests.
- Prefer authoritative menu, event, inventory, and server-state evidence over
  camera interpretation.
- Validate another real client/agent before inviting human players.
- Do not expose the server publicly without a separate legal, moderation,
  recovery, monitoring, and abuse-testing decision.

## Working rules

- Retail FFXI is out of scope; automation runs only on the isolated private
  server.
- Deterministic supervisors handle sub-second reactions. Codex chooses goals,
  policies, routes, and exceptions.
- MCP is the typed control and observation boundary, not the real-time combat
  loop.
- Exact IDs and authoritative events outrank names, screenshots, or remembered
  state.
- Prefer bounded leases, explicit allowlists, audit logs, and emergency stops.
- Document reproducible failures and milestone results.
- Batch commits at meaningful milestones instead of pushing after every fight.

## Review cadence

Update this file when a goal changes state, an exit criterion is met, or live
evidence changes the plan. Do not rewrite completed evidence as if it were
future work.
