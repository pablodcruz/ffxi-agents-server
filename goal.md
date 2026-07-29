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

- Character: Pablo, Hume male, Monk level 13.
- Progress: 2,599/3,200 EXP.
- Gil goal: **completed at 28,815/10,000 gil**. One Acheron Shield bought
  normally for 2,755 earned Sparks sold to Balthilda for 27,550 gil, moving
  the verified balance from 1,265 to 28,815.
- Records of Eminence: `Vanquish Multiple Enemies I` at 92/200. The repeatable
  `Spoils (Treant Bulb)` objective completed during the latest farm batch,
  awarding 300 EXP and bringing the authoritative Sparks balance to 3,200.
  The verified Acheron Shield exchange left 445 Sparks.
- Trust: Naji acquired and validated; he uses Provoke after Pablo engages.
- Control: AgentBridge 0.21.0, guarded service travel, exact-ID combat,
  automatic Combo, allowlisted loot sales, and a bounded reactive aggro guard.
- Stream visibility: the bounded goal overlay now names the active
  Records of Eminence/Unity objective and shows `VANQUISH: 92 / 200`; the
  sanitized local-only Agent Activity feed is enabled.
- Travel: Metalworks Home Point #2 and Bastok Markets Home Point #3 are
  registered and cached.
- Farming exclusions: no proactive worms, Stone Eaters, Huge Hornets, or
  Vultures.
- Treasure Caskets are ignored during farming. Disposable casket prompts and
  the player menu are canceled; caskets will be revisited only for a specific
  quest or a known valuable reward.
- Inventory is currently 9/30 after a batched allowlisted sale, Beastmen's
  Seal storage, and a verified inventory sort. Persistent Auto-Sort is enabled
  under `Config -> Gameplay -> Inventory -> Sort: ON`. A one-time
  `Items -> Sort -> Auto` pass combined two loose seals into one
  `Beastmen's Seal x2` stack and two loose bulbs into one `Treant Bulb x2`
  stack, reducing inventory from 12/30 to 10/30. Subsequent live drops joined
  both stacks automatically: seals and bulbs each reached three without using
  another slot. The three-bulb stack then sold for 120 gil.
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

Status: **completed**

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
- Controlled multi-enemy handoffs: **3/3 — passed**. A Young Quadav, a linked
  Rock Lizard, and a linked Walking Sapling were queued while another target
  was active. The final flat-terrain Sapling pair was won in 36 seconds with
  one proactive and one reactive engagement, no attack rejection, death,
  excluded pull, target-cycle error, combat teleport, or combat recovery.
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
- Death/Home Point recovery: **validated end to end**. Lease
  `a1681beb-34ad-4748-b3f8-8546d5c933af` encountered a linked lizard that
  remained invisible to melee at 1.07 yalms, detected Pablo's real defeat,
  navigated only the exact observed `dead` and `comyn` menus, selected the
  safety-defaulted confirmation once, returned to registered Bastok Markets,
  verified 100% HP, and stopped with `deaths: 1`, `home_point_returns: 1`, and
  no combat teleport.
- Reactive handoff race: **repaired and live-validated**. A first `/attack`
  can register while target-follow closes distance; the supervisor now samples
  the fresh stance before deciding whether to reissue, avoiding a second
  `/attack` that would toggle combat off. The final Sapling handoff recorded
  `reactive_attack_registered_during_follow` and won.
- Line-of-sight recovery: a bounded non-teleport nudge through the exact live
  target is implemented for fresh `cannot see` events. It is unit-tested but
  has now fired in live farming. It remained bounded and combat-safe, although
  two moving Sapling spawns still failed registration and remain poor targets.
- Disposable-menu race: **repaired and live-validated**. A casket/player menu
  can close after observation but before the cancel pulse. The supervisor now
  refreshes menu state and treats only AgentBridge's exact closed-menu rejection
  as a safe no-op. Lease `bb7454ae-69e7-4237-826f-d023e93db92d` then defeated
  one Rock Lizard for 90 EXP and stopped normally with zero rejections, deaths,
  excluded pulls, target-cycle errors, combat teleports, or combat recovery.

## Goal 2 — reach 10,000 gil while leveling

Status: **completed**

- Continue selling only fixed allowlisted loot in sensible batches.
- Check inventory between farming batches, not after every fight.
- Keep the numeric stream overlay synchronized with verified gil events.
- Prefer normal drops and Records of Eminence rewards over administrative
  grants.
- The normal Acheron Shield Sparks-to-vendor conversion was live-validated.
  The shop deducted exactly 2,755 Sparks, inventory gained exact item ID 12385,
  and exact vendor Balthilda removed that one item for exactly 27,550 gil.
  Final verified balance: 28,815 gil.
- `mcp:sell-sparks` is intentionally separate from the ordinary loot
  allowlist. It requires exact item ID 12385, exact Balthilda server ID
  17739803 within six yalms in zone 235, exactly one shield, the open sell
  list, and exact item/gil deltas.

## Goal 3 — compound normal play with Records of Eminence

Status: **active**

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
