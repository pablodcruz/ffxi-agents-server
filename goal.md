# Current goal

Last reviewed: 2026-08-04

Farm Argus at the proven Maze of Shakhrami camp on the isolated local
LandSandBoat server. The detached supervisor handles the alternating Leech
King slot as a non-completing support target and stops only after one verified
Argus defeat or a material safety issue.

## Completion evidence required

- Persisted lease reports `objective_kills: 1` and a normal
  `objective_kill_limit` stop.
- Pablo is alive, logged in, menu-free, and no longer in combat.
- The Argus fight and any drop are reconciled from the audit log and
  authoritative inventory state.
- Pablo is returned safely to Bastok Markets.
- New collision/timer findings are tested, documented, committed, and pushed
  to `main` without credentials or runtime logs.

# Latest completed goal

Last reviewed: 2026-08-03

Level Pablo's Red Mage from RDM49 to RDM55 on the isolated local
LandSandBoat server using the detached guarded combat supervisor, with sparse
event-only monitoring and an authoritative stopped-state completion audit.

## Result

- Completed at RDM55 with 231/12,800 EXP and RDM/WHM active.
- Earned exactly 48,215 EXP across 155 fights in Crawler's Nest (zone 197).
- The final lease `e4403ff7-906a-4353-bf17-1f61fa8a312e` stopped normally for
  `target_level`; the persisted control plane reports `active: false`, no
  target, and no error.
- Final live verification found Pablo logged in, not zoning, no menu open, no
  selected item, and the goal overlay reporting `LEVEL 55 REACHED | COMPLETE`.
- The campaign had zero deaths. Trust repair, recovery, combat selection,
  spells, weapon skills, and camp relocation remained inside the detached
  supervisor rather than model-driven gameplay calls.

## Low-token operating result

- Codex listened to filtered supervisor events in five-minute windows instead
  of polling player state after fights.
- Full MCP state reads were reserved for material stops: inventory pressure,
  time-limit renewal, and final completion.
- Two clean one-hour time-limit stops were verified and renewed with the exact
  same guarded configuration. Inventory-pressure stops were diagnosed before
  cleanup and never restarted blindly.

## Inventory findings

- Long Crawler's Nest runs fill Inventory with Insect Wings, crystals, Beetle
  Shells/Jaws, Loam, geodes, seals, and keys.
- `pnpm mcp:inventory-cleanup -- --moghouse-relief` now provides an explicit
  Mog-House-only path that moves accumulated crystal stacks from Inventory,
  Mog Sack, and Mog Case to the unlocked Mog Safe 2 using exact verified item
  transfers.
- The live relief run moved 50 crystal stacks into Safe 2 and reduced Mog Case
  usage from 80/80 to 38/80. Field cleanup later archived newly observed Flame,
  Snow, Aqua, and Shadow Geodes plus the Nest Chest Key.
- Final Inventory is 30/35 and gil is 103,842. Credentials remain ignored and
  all automation remains private-server-only.
