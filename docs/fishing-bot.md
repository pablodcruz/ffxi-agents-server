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
- one explicitly selected starter bait in the ammo slot or main inventory:
  Lugworm (17395), Little Worm (17396), or Insect Ball (16998);
- no open menu, an idle logged-in character, and inventory headroom;
- the exact `START PRIVATE SERVER FISHING BOT` confirmation phrase.

Gelzerio sells Willow Fishing Rods, Lugworms, and Little Worms using normal gil
and inventory checks. Toji Mumosulah sells Insect Balls (the client resource
name for Ball of Insect Paste). The exact-vendor purchase helper remains pinned
to each NPC and item and verifies the inventory and gil deltas. Fishing is
enabled explicitly with `XI_MAP_FISHING_ENABLE=true` in Compose.

The local lab also sets `XI_MAP_FISHING_SKILL_MULTIPLIER=5.0`. LandSandBoat
describes its default `1.0` rate as “very hard”; the higher rate makes bounded
automation tests finish in a practical window without manufacturing skill.
The server still requires an eligible fish catch and owns the skill-up roll,
amount, rank cap, bait use, and inventory result. This is a private-lab rate,
not a claim about retail progression speed.

## Starter progression bands

The local server's authoritative fishing tables define Cobalt Jellyfish at
skill 5, Bastore Sardine at 9, Crayfish at 7, and Moat Carp at 11. Port Bastok
gives Little Worm affinity 3 for Cobalt Jellyfish. Lugworm then has affinity 2
for Bastore Sardine and affinity 3 for Quus, so it can continue the same scenic
harbor camp toward skill 9. Bastok Markets groups 5 and 6 contain Moat Carp;
Insect Ball has affinity 3 for Moat Carp and provides the final 9-to-10 band.
AgentBridge allowlists only these three Bastok starter zones and three starter
baits; it still cannot run in arbitrary zones or with arbitrary bait.

The stream-friendly Port camp is at AgentBridge coordinates
`x=60, y=-164, z=5.5` with heading `1.5708`. The fishing camera frames Pablo,
open harbor water, the drawbridge, ship traffic, skyline, and sky. The staged
route is Little Worm to authoritative database value 50, Lugworm toward 90,
then Insect Ball in Markets toward 100. This avoids spending bait after the
current catch reaches its skill cap while preserving the scenic view for most
of the run.

The stream-friendly Markets camp used for the level-10 run is at AgentBridge
coordinates `x=-198, y=-73, z=-6`. Heading `3.1415` plus one client camera
reset (`Numpad 5`) frames the canal on the right with open sky, trees, and city
architecture rather than the wall at the original Mines test point. The
heading is part of the supervisor renewal command; the camera reset is only a
stream-composition step and is not required by the fixed fishing packets.

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
  --bait-item-id 16998 \
  --maximum-seconds 1800 \
  --maximum-casts 100 \
  --minimum-free-inventory-slots 3 \
  --heading 3.1415 \
  --confirmation 'START PRIVATE SERVER FISHING BOT'
```

Inspect or cooperatively stop it:

```sh
pnpm mcp:fishing-status
pnpm mcp:fishing-stop
```

`--bait-item-id` defaults to Little Worm and accepts only 17395, 17396, or
16998. `--heading` is optional and limited to `-pi..pi`. It is useful for a
readable stream view, but hook checks no longer depend on camera orientation.

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

AgentBridge 0.32.10 handles split equipment stacks without a model turn. During
cooldown, if the selected bait stack empties but another exact stack remains in
main inventory, the bot queues only that bait's fixed `/equip ammo` command.
It does the same for an available spare Willow Fishing Rod. FFXI can reject the
first equip command while a catch result is still resolving, so recovery
retries no faster than every three seconds for at most twenty seconds. It still
stops with `missing_bait` or `missing_rod` when no exact replacement exists or
the bounded re-equip cannot be verified.

LandSandBoat reports successful catches as `<player> caught a ...`, rather
than only the retail-style `You caught ...` text. Version 0.32.10 recognizes
both forms, increments the stream counter, and sends the fixed release packet
immediately instead of waiting for the five-second resolution fallback.

Version 0.32.11 also adds the four ordinary Port Bastok catches used by the
leveling route (Bastore Sardine, Zafmlug Bass, Cobalt Jellyfish, and Quus) to
the duplicated host-and-client NPC-sale allowlist. Cleanup still requires an
open normal vendor context, an exact main-inventory slot and quantity, and
verification of both the item decrease and gil increase. Fishing gear, bait,
rare items, and broken rods remain outside this catch-specific expansion.

Version 0.32.12 adds only Gelzerio's Willow Fishing Rod to the duplicated
direct-vendor purchase allowlist. The helper still requires Gelzerio's live
shop context, a single-unit request, a caller price ceiling, free inventory,
and exact verification of the rod increase and gil decrease.

After a disconnect, unknown stop, missing equipment, or inventory pressure,
diagnose authoritative player state before restarting. `mcp:fishing-stop` also
sends the normal release packet so a completed or interrupted minigame does not
leave the character stuck in fishing status.

For inventory pressure, the private-server `!agentshop` path allowlists only
the verified fishing catches and junk produced by these camps: Rusty Bucket,
Moat Carp, Tricolored Carp, Gold Carp, Crayfish, Copper Ring, Rusty Leggings,
and Rusty Subligar. The same bounded cleanup also includes four exact old
combat-loot stacks observed blocking this run: Fruit Seeds, Beetle Jaw, Loam,
and Royal Jelly. Pablo must be within six yalms of Balthilda in Bastok
Markets. The command removes only main-inventory items, reads each item's
normal server base-sale value, removes the exact quantity before adding gil,
and permits stack quantities only for the explicit stackable cleanup items.
The MCP wrapper independently verifies the exact inventory decrease and gil
increase before reporting success. Broken rods have a zero NPC value and are
intentionally excluded.

The same item list is also available through the normal `0x084`/`0x085` sale
packet helper as a live-compatible fallback when the running map process has
cached an older `!agentshop` module. The fallback requires opening Balthilda's
normal shop once, sells only an exact main-inventory slot and quantity, and
verifies the inventory decrease plus positive gil change. On 2026-08-03 it
sold 7 Crayfish for 70 gil, 1 Gold Carp for 300 gil, 4 Moat Carp for 40 gil,
and 2 Tricolored Carp for 104 gil. After a future map restart, live-proof the
lower-friction proximity-gated path before replacing this fallback in the
monitor.

AgentBridge 0.32.5 extended that exact normal-packet fallback to the four old
combat-loot stacks that blocked the level-10 run. A single verified cleanup
sold 51 Loam for 19,329 gil, 15 Beetle Jaws for 1,815 gil, 5 Fruit Seeds for
400 gil, and 1 Royal Jelly for 150 gil. Together with the fishing catch and
junk cleanup, main inventory fell from 34/35 to 21/35 while all food, seals,
equipment, bait, usable rods, and broken rods were preserved. Goblin Mask and
Goblin Helm produced no verified normal sale, so the monitor leaves them alone
instead of retrying blindly.

## Live proof

The full level-10 goal completed on 2026-08-03 without an administrative
skill-set command. The authoritative `char_skills` row for Pablo
(`charid=1`, fishing `skillid=48`) reached `value=100, rank=0`; after a
stability wait, AgentBridge independently reported integer skill 10, capped,
and the detached supervisor remained stopped with `stop_reason=target_skill`.
Final client state was logged in and idle with inventory 32/35, six Insect
Balls, and three usable Willow Fishing Rods (one equipped and two spares).

The final live route also corrected an important camp assumption. Five
Insect Ball catches at the scenic Port Bastok saltwater dock produced no
authoritative skill gain. Moving only the 9-to-10 stage to the Bastok Markets
freshwater canal at `x=-198, y=-73, z=-6`, heading `3.1415`, produced Moat
Carp and advanced the database from 90 to 100 through normal server skill-up
rolls. The Port dock remains the stream-friendly Little Worm/Lugworm camp for
the earlier bands; it is not the verified Insect Ball finish.

The completion run exercised both bounded recovery paths. Inventory-pressure
stops were diagnosed before exact allowlisted catches and rusty junk were sold
through a live normal vendor context. Missing-bait stops were followed by
verified one-unit normal `0x083` purchases from Toji Mumosulah. Two broken
spare rods were replaced with exact verified Gelzerio purchases, leaving three
usable rods at completion. A future friction improvement may add a separately
bounded stack purchase for bait, but the live bridge and helper intentionally
remain one-unit-per-verified-packet in this proof.

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
