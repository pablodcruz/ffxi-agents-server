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

- Character: Pablo, Hume male, Monk level 12.
- Progress: 1,359/3,000 EXP.
- Gil goal: 1,139/10,000 gil. The local stream overlay is synchronized to this
  verified balance.
- Records of Eminence: `Vanquish Multiple Enemies I` at 69/200. A completed
  objective awarded 1,500 bonus EXP and a Copper Voucher; the new sparks
  balance still needs an authoritative menu check.
- Trust: Naji acquired and validated; he uses Provoke after Pablo engages.
- Control: AgentBridge 0.20.0, guarded service travel, exact-ID combat,
  automatic Combo, allowlisted loot sales, and a bounded reactive aggro guard.
- Travel: Metalworks Home Point #2 and Bastok Markets Home Point #3 are
  registered and cached.
- Farming exclusions: no proactive worms, Stone Eaters, Huge Hornets, or
  Vultures.
- Treasure Caskets are ignored during farming. Disposable casket prompts and
  the player menu are canceled; caskets will be revisited only for a specific
  quest or a known valuable reward.
- Inventory is currently 8/30 after a batched allowlisted sale and Beastmen's
  Seal storage. FFXI Auto-Sort is enabled for future stackable drops; the next
  seal drop must verify that it joins one stack. Existing loose seals did not
  merge immediately when Auto-Sort or Manual was selected.
- Shami in Port Jeuno stores 14 Beastmen's Seals for Pablo. Deposit future
  batches there instead of consuming inventory slots; his first Cloudy Orb
  costs 20 stored seals. The guarded helper accepts only item 1126 and exact
  Shami server ID 17784905.
- Vulture finding: coarse positioning, facing, and a target-locked `/follow
  <t>` approach down to 1.13 yalms all failed to register combat against
  multiple exact IDs. The family stays excluded pending separate diagnosis.
- Known dangerous area: the western South Gustaberg Quadav pocket around
  `(10, -170)` is excluded until multi-aggro handling passes.
- High-elevation pocket `(-380, -312)` is diagnostic-only: its first two
  Saplings were defeatable, but target-follow moved away from another spawn and
  exposed a heal-to-idle race. Do not use it for the clean baseline until the
  movement behavior is understood.

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

- Consecutive approved unattended fights without a preventable death:
  **30/30 — passed**. The final nineteen wins included automatic recovery,
  bounded line-of-sight and registration retries, casket/menu dismissal, and
  two add handoffs. No proactive excluded family was engaged, and no teleport
  or recovery action ran during combat.
- Controlled multi-enemy handoffs: **2/3**. A Young Quadav and a linked Rock
  Lizard were queued while another target was active, then defeated without
  disengaging.
- Reactive defense: **validated with repeated sub-second samples** at 551 ms,
  476 ms, and 206 ms. In the 206 ms Amber Quadav case, FFXI had already
  selected the aggressor; the supervisor explicitly preserved that exact
  target, issued attack, followed from 7.83 to 0.84 yalms, and won.
- Reactive timing now reports queued-add wait separately from aggro response.
  Finishing the current enemy before switching to an add is intentional queue
  time and no longer pollutes the sub-second latency metric.
- Automatic weapon skill: **validated** with two Combo uses in that reactive
  fight.
- Safe recovery: **validated** from 38% to above 90% while idle. A level-up
  revealed that queued `/heal` toggles could briefly report a stale idle
  snapshot; the supervisor now observes the live stance, sends the stand toggle
  only when status 33 is present, and requires two fresh idle samples before
  service positioning. Lease `1ef05ac3-6f0e-42a1-80f3-d849b2363636` validated
  the repair in live play.
- MCP lease controls: **validated** for start, status, cooperative stop,
  fight-limit stop, heartbeat, counters, and structured logs.
- Reward accounting: **validated** against FFXI control-byte suffixes and a
  clean per-lease event baseline.
- Fight-limit safety: **validated live**. Lease
  `c9713602-84a4-4383-9639-59affe30b6d3` defeated one Walking Sapling, returned
  exactly to its safe-camp origin, observed no live combat, and only then
  disabled control. This follows a live Amber Quadav aggro that occurred after
  an older lease stopped beside an aggressive pocket.
- Remaining Goal 1 gaps: one controlled add handoff and death/Home Point
  recovery.

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
