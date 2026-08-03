# Private-server fishing bot

Status: live-tested on 2026-08-03

## Goal

The fishing supervisor moves the fast, repetitive cast/reel/release loop out of
model turns while leaving the meaningful gameplay outcomes with LandSandBoat.
It is deliberately narrow and is not a general packet sender or retail bot.

The validated starter setup is:

- Port Bastok (zone 236) or Bastok Mines (zone 234);
- Willow Fishing Rod (item 17391) in the ranged slot;
- Little Worm (item 17396) in the ammo slot;
- no open menu, an idle logged-in character, and inventory headroom;
- the exact `START PRIVATE SERVER FISHING BOT` confirmation phrase.

Gelzerio's local-lab vendor sells one Willow Fishing Rod and up to 99 Little
Worms using normal gil and inventory checks. Fishing is enabled explicitly with
`XI_MAP_FISHING_ENABLE=true` in Compose.

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
server-generated hook special value; AgentBridge echoes it only in the fixed
reel request. The decoder supports both full-packet and payload-relative Ashita
event layouts without allowing callers to supply this value. Catch/loss text
triggers the normal release request.

The run stops on target skill, time limit, cast limit, inventory pressure,
missing rod, missing bait, logout, zoning, disabled control, or unavailable
player identity. Status reports fishing skill, phase, equipment, inventory,
casts, hooks, reel requests, catches, failures, and timeouts.

After a disconnect, unknown stop, missing equipment, or inventory pressure,
diagnose authoritative player state before restarting. `mcp:fishing-stop` also
sends the normal release packet so a completed or interrupted minigame does not
leave the character stuck in fishing status.

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

During the 2026-08-03 bring-up, more than 100 aggregate test casts produced
the verified catches above but no observable skill progress, alongside an
abnormally high rate of generic reel losses. After stopping the bot, the local
administrator set fishing to level 1 once so later automation work could
continue. That was a documented private-server testing fallback, not a bot
feature or evidence that normal skill-up RNG succeeded. Do not automate that
admin command or represent it as earned progression; diagnose or repair the
upstream experimental fishing path before using targets above level 1.
