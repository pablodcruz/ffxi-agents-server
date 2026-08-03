# Private-server fishing bot

Status: live-tested on 2026-08-03

## Goal

The fishing supervisor moves the fast, repetitive cast/reel/release loop out of
model turns while leaving the meaningful gameplay outcomes with LandSandBoat.
It is deliberately narrow and is not a general packet sender or retail bot.

The validated starter setup is:

- Bastok Mines (zone 234), Bastok Markets (zone 235), or Port Bastok
  (zone 236);
- Willow Fishing Rod (item 17391) in the ranged slot;
- Little Worm (item 17396) in the ammo slot;
- no open menu, an idle logged-in character, and inventory headroom;
- the exact `START PRIVATE SERVER FISHING BOT` confirmation phrase.

Gelzerio's local-lab vendor sells one Willow Fishing Rod and up to 99 Little
Worms using normal gil and inventory checks. Fishing is enabled explicitly with
`XI_MAP_FISHING_ENABLE=true` in Compose.

The local lab also sets `XI_MAP_FISHING_SKILL_MULTIPLIER=5.0`. LandSandBoat
describes its default `1.0` rate as “very hard”; the higher rate makes bounded
automation tests finish in a practical window without manufacturing skill.
The server still requires an eligible fish catch and owns the skill-up roll,
amount, rank cap, bait use, and inventory result. This is a private-lab rate,
not a claim about retail progression speed.

## Starter progression bands

The local server's authoritative fishing tables define Crayfish at skill 7 and
Moat Carp at skill 11. Little Worm has positive affinity for both. Bastok Mines
group 8 contains Crayfish but not Moat Carp, so it is suitable only through
skill 7. Bastok Markets groups 5 and 6 contain Moat Carp and provide the
verified 7-to-10 progression band. AgentBridge therefore allowlists Markets as
the third narrow Bastok fishing zone; the bot still cannot run in arbitrary
zones.

The stream-friendly Markets camp used for the level-10 run is at AgentBridge
coordinates `x=-198, y=-73, z=-6`. It faces the canal with open sky, trees,
and city architecture rather than the wall at the original Mines test point.

Do not infer a fish cap from client text or the AgentBridge raw skill field.
For exact progress in tenths, query the server-owned `char_skills.value` for
skill ID 48. Change camps before the current catch reaches its table cap so a
healthy bot does not spend bait without a possible skill-up.

## Why the bot uses fixed fishing packets

The normal `/fish` command first performs a Windows-client camera/collision
check. During live testing it returned `You cannot fish here` at visually valid
waterfront positions, making unattended fishing depend on camera geometry.

LandSandBoat's ordinary new-fishing protocol separates the process into one
action and three fixed requests:

1. packet `0x01A`, action `Fish`, which runs the server's `StartFishing`;
2. packet `0x110` mode 2, `RequestCheckHook`, after the server hook delay;
3. packet `0x110` mode 3, `RequestEndMiniGame`;
4. packet `0x110` mode 4, `RequestRelease`.

AgentBridge constructs only those fixed packet layouts from the logged-in
player's server ID and target index. Callers cannot choose a packet ID, mode,
item, catch, stamina result, or special value. The server still selects the
catch, validates fishing configuration and equipment, performs `ReelCheck`,
consumes bait, breaks rods, updates inventory/fatigue, and awards skill-ups.
The mode-4 release is required after both a catch and a lost catch; omitting it
leaves the client in fishing status and prevents the next cast.
The next cast waits six seconds after release or a no-bite result so it clears
LandSandBoat's five-second per-character fishing cooldown.

This is a typed native-client operation under the private-server automation
policy: it removes a broken camera gate, but does not grant fish or skill.

## Commands

Start a bounded run toward fishing skill 10:

```sh
pnpm mcp:fishing-start -- \
  --target-skill 10 \
  --maximum-seconds 1800 \
  --maximum-casts 100 \
  --minimum-free-inventory-slots 3 \
  --heading 0 \
  --confirmation 'START PRIVATE SERVER FISHING BOT'
```

Inspect or cooperatively stop it:

```sh
pnpm mcp:fishing-status
pnpm mcp:fishing-stop
```

`--heading` is optional and limited to `-pi..pi`. It is useful for a readable
stream view, but hook checks no longer depend on camera orientation.

## State machine and stops

The loop is
`cooldown -> starting -> queued -> hooked -> resolving -> release -> cooldown`.
No-bite text returns directly to cooldown. Incoming packet `0x115` provides the
server-generated hook special value; AgentBridge immediately echoes it only in
the fixed reel request. Reeling in that packet callback prevents the native
minigame from racing the supervisor with its own failed end request. The
decoder supports both full-packet and payload-relative Ashita event layouts
without allowing callers to supply this value. Catch/loss text triggers the
normal release request.

The run stops on target skill, time limit, cast limit, inventory pressure,
missing rod, missing bait, logout, zoning, disabled control, or unavailable
player identity. Status reports fishing skill, phase, equipment, inventory,
casts, hooks, reel requests, catches, failures, and timeouts.

AgentBridge 0.32.4 handles split equipment stacks without a model turn. During
cooldown, if the equipped Little Worm stack empties but another exact stack
remains in main inventory, the bot queues the fixed `/equip ammo "Little
Worm"` command and waits up to eight seconds for verification. It does the
same for an available spare Willow Fishing Rod. It still stops with
`missing_bait` or `missing_rod` when no exact replacement exists or the
re-equip cannot be verified.

After a disconnect, unknown stop, missing equipment, or inventory pressure,
diagnose authoritative player state before restarting. `mcp:fishing-stop` also
sends the normal release packet so a completed or interrupted minigame does not
leave the character stuck in fishing status.

For inventory pressure, the private-server `!agentshop` path allowlists only
the verified fishing catches and junk produced by these camps: Rusty Bucket,
Moat Carp, Tricolored Carp, Gold Carp, Crayfish, Copper Ring, Rusty Leggings,
and Rusty Subligar. Pablo must be within six yalms of Balthilda in Bastok
Markets. The command removes only main-inventory items, reads each item's
normal server base-sale value, removes the exact quantity before adding gil,
and permits stack quantities only for fish. The MCP wrapper independently
verifies the exact inventory decrease and gil increase before reporting
success. Broken rods have a zero NPC value and are intentionally excluded.

The same item list is also available through the normal `0x084`/`0x085` sale
packet helper as a live-compatible fallback when the running map process has
cached an older `!agentshop` module. The fallback requires opening Balthilda's
normal shop once, sells only an exact main-inventory slot and quantity, and
verifies the inventory decrease plus positive gil change. On 2026-08-03 it
sold 7 Crayfish for 70 gil, 1 Gold Carp for 300 gil, 4 Moat Carp for 40 gil,
and 2 Tricolored Carp for 104 gil. After a future map restart, live-proof the
lower-friction proximity-gated path before replacing this fallback in the
monitor.

## Live proof

Bounded live proofs caught two Rusty Subligars in Port Bastok and one Crayfish
in Bastok Mines, with inventory changes verified through authoritative client
state. The corrected sequence also showed normal no-bite results, server hook
packet `0x115`, fixed reel requests, losses, and normal releases back to idle.
The bot continued across casts without model-driven cast or reel calls.

Upstream ships `FISHING_ENABLE = false` with an explicit “enable at your own
risk” warning, and describes the default fishing skill-up multiplier as very
hard. This lab opts in only on the isolated private server. Catch and skill-up
rates remain server RNG; the supervisor does not manufacture fish or skill.

During the initial 2026-08-03 bring-up, more than 100 aggregate test casts
produced the verified catches above but no observable skill progress, alongside
an abnormally high rate of generic reel losses. After stopping the bot, the
local administrator set fishing to level 1 once so later automation work could
continue. That remains a documented private-server testing fallback, not a bot
feature or evidence of earned progression.

Inspection of the exact server revision (`2949f26b`) showed that the packet
layouts and server intuition check were correct. The failure was a client-side
race: AgentBridge waited 0.8 seconds after packet `0x115`, allowing the native
minigame to submit a failed end request first. Version 0.32.1 reels immediately
from that hook callback. The first bounded live proof after this change caught
nine Crayfish with normal bait consumption and advanced the authoritative
server fishing value from 10 to 14 (skill 1.0 to 1.4), without any admin skill
command. Targets above level 1 are therefore allowed only with this corrected
server-authoritative path; never automate or represent an admin skill command
as earned fishing progress.
