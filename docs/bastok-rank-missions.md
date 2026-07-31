# Bastok rank mission automation

This runbook records the normal mission/NPC interactions and the narrow
private-server travel used to advance a Bastokan character. It is based on the
pinned LandSandBoat handlers in this repository's local deployment and live
verification with Pablo. Re-check handlers after changing the server image.

## Mission-menu behavior

At a Bastok mission guard, the mission list opens with `None` selected. For a
single available mission, the reliable sequence is:

1. interact with the exact guard;
2. finish the introductory dialogue;
3. press `up` once to move from `None` to the displayed mission;
4. verify the mission name visually or semantically;
5. confirm it and advance the bounded briefing;
6. require the game event `You have accepted the mission.`

Confirming without the `up` input selects `None`; the destination NPC then
gives ordinary idle dialogue instead of mission progress. Treat the acceptance
event, not the menu close, as proof.

## Rank 1

### 1-1 The Zeruhn Report

- A new Bastokan receives the special first-mission onboarding from Malduc.
- Interact with Makarim in Zeruhn Mines to receive the report.
- Return to Naji in the Metalworks and finish the Lucius cutscene.

### 1-2 A Geological Survey

- Select the displayed mission with the `None -> up -> confirm` sequence.
- Cid gives the Blue Acidity Tester.
- The Dangruf Wadi geyser trigger is the small native-coordinate cuboid
  `x=-133.5..-132.7`, `y=2..4`, `z=132.6..133.8`.
- For AgentBridge coordinates, use approximately
  `x=-133.1, y=133.2, z=3.0`. The exported mob metadata already uses this
  AgentBridge axis order; do not swap its `y` and `z` again.
- Enter the trigger from outside its cuboid and wait for the geyser launch.
- Return to Cid and finish the Cid/Volker cutscene.

### 1-3 Fetichism

- Accept Fetichism from Malduc and require the acceptance event.
- Trade exactly one each of item IDs `606`, `607`, `608`, and `609` to a
  mission guard:
  - Fetich Head
  - Fetich Torso
  - Fetich Arms
  - Fetich Legs
- The four-item trade must be one normal trade transaction; four `/item`
  commands are not equivalent.

Palborough Mines drop metadata shows all four items on Amber, Greater, Old,
Veteran, and Brass Quadav. Most entries use a `100/250` group/item rate;
Veterans use `150/250`, while Brass Quadav expose multiple eligible groups.
The exact-drop supervisor therefore prefers Brass Quadav and falls back to the
other verified families.

Quest farming differs from EXP farming in one important way: trivial mobs are
valid. Set a wide minimum-level offset only for an exact watched quest item.
Normal leveling retains its three-level lower bound.

Keep at least six inventory slots free before this farm. Quadav can also drop
equipment, keys, and other unique items. Preserve incidental drops in Mog Case
(container 7) rather than allowing them to block the four mission items.

## Rank 2

### Rank-point gates

The local pinned mission table and live run agreed on these gates:

- `The Crystal Line` appeared after about 672 rank points. Three Fire Crystals
  donated at Rank 1 supplied enough points.
- Its completion reward plus one more crystal brought Pablo to 1,532 points,
  exposing `Wading Beasts`.
- `Wading Beasts` awarded 250 points, bringing the total to 1,782.
- `The Emissary` requires about 3,203 points. Five more Fire Crystals at 333
  points each brought the live total to 3,447.

Use the mission guard's displayed list as the final authority. Point values
can differ with rank and server configuration.

### 2-1 The Crystal Line

1. Receive the mission briefing from Cid.
2. Trade one ordinary crystal to a Telepoint and receive Faded Crystal item
   `613`.
3. Trade the Faded Crystal to Cid.
4. Complete the report to Ayame.

### 2-2 Wading Beasts

- Alois requests one Lizard Egg, item `4362`.
- The verified Hill Lizard camp is in Sauromugue Champaign, zone 120, not La
  Theine Plateau.
- The exact-drop supervisor obtained the egg after two Hill Lizard defeats.
- Trade the egg to Alois. His long cutscene can outlast the trade helper's
  verification window: an apparent helper failure is not proof of a failed
  handoff. The consumed egg, cutscene, and changed rank points proved success.

### 2-3 The Emissary

The live run used the San d'Oria-first branch:

1. Accept the mission from Cleades, then receive the Letter to the Consuls
   from Naji and President Karst.
2. Complete Baraka, Helaku, and Halver's San d'Oria briefings.
3. Defeat exact target Warchief Vatgit, then report to Helaku.
4. Report to Melek in Windurst, then receive the Dark Key from Kupipi.
5. Enter `The Rank 2 Final Mission` at the Balga's Dais BC Entrance.
6. Defeat the activated Searcher and Black Dragon, finish the victory
   cutscene, and receive the Kindred Crest.
7. Report in order to Kupipi, Melek, and Naji. The final cutscene awards the
   Adventurer's Certificate, 3,000 gil, and Bastok Rank 3.

The battlefield is level-capped at 25, allows Trusts, and lasts 15 minutes.
Summoning Valaineral, Joachim, and Mihli Aliapoh before approaching the enemies
was sufficient for the live clear.

## Rank 3 and the low-friction mission interface

The local private server now exposes `!agentmission` through the guarded
`ffxi_private_server_bastok_mission` MCP operation and the
`pnpm mcp:bastok-mission` wrapper. This is deliberately narrower than arbitrary
GM commands:

- it is self-only, Bastok-only, Rank-3-only, and requires the exact
  `ADVANCE PRIVATE SERVER BASTOK MISSION` confirmation at the bridge;
- `status` reports the current mission and status without changing progress;
- `begin` accepts only mission IDs `10`, `11`, and `12`, enforces the pinned
  mission rank-point gates and prerequisites, and performs the same
  `player:addMission` operation as normal acceptance;
- `donate` accepts only owned elemental crystals (item IDs `4096` through
  `4103`), consumes them, and applies the pinned conquest donation formula;
- it cannot complete missions, set mission status, grant items, set rank, or
  target another character.

Use it to remove repetitive mission-list navigation, not to skip mission
objectives. NPC dialogue, trades, battlefield clears, kills, and zone
transitions still advance through their normal pinned handlers.

### 3-1 The Four Musketeers

1. Begin mission `10` through the guarded interface after meeting its normal
   rank-point gate.
2. Interact with Iron Eater in the Metalworks and select `Right away`. The
   briefing changes mission status from `0` to `1`.
3. Enter Beadeaux and finish the rendezvous cutscene. This changes status to
   `2`.
4. Defeat twenty exact-name `Copper Quadav`. Each normal death event increments
   mission status once, ending at `22`.
5. Zone normally from Beadeaux into Pashhow Marshlands. The zone-in handler
   completes the mission and awards `350` rank points.

The detached farm supervisor supports bounded exact-name objectives with
`--objective-target-name` and `--objective-kill-count`. Proactive selection is
restricted to that exact name, reactive defense remains enabled for linked or
aggressive mobs, all confirmed defeats of the exact name count, and the lease
drains to a safe stop at the requested total. The first live solo BLM pull
linked a second Copper Quadav and fell to 25% HP despite both kills; subsequent
mission farming therefore uses normal Trust support.

### 3-2 To the Forsaken Mines

Mission `11` is repeatable and optional for reaching Rank 4. Its normal handler
uses Hare Meat at `qm2` to spawn Blind Moby, awards a Glocolite, and completes
when the Glocolite is traded to a mission guard. Completion awards `400` rank
points.

### 3-3 Jeuno

Mission `12` is the required Rank-4 mission. Its pinned handler advances only
through the normal Lucius briefing, Goggehn briefing, Delkfutt door/key step,
and final Ru'Lude Gardens report. Completion awards Bastok Rank 4 and 5,000
gil. Direct mission acceptance can remove the guard menu, but the guarded
interface intentionally cannot bypass these objectives.

Verified local route coordinates use AgentBridge axis order (`x`, horizontal
`y`, elevation `z`):

- Lucius, Metalworks zone `237`: `59.959, -42.321, -16.390`;
- Goggehn, Ru'Lude Gardens zone `243`: `2.968, -79.610, 8.999`;
- Porphyrion, Upper Delkfutt's Tower zone `158`:
  `-298.160, 12.439, -144.165`;
- Cermet Door `_542`, Lower Delkfutt's Tower zone `184`:
  `600.484, -20.038, 13.333`;
- Bastokan embassy door `_6r2`, Ru'Lude Gardens zone `243`:
  `19.046, -75.110, 7.500`.

The pinned database gives level-36 Porphyrion a guaranteed Delkfutt Key item
`549`. Trading that key to `_542` converts it into the Delkfutt Key key item
and changes mission status from `2` to `3`; the `_6r2` report then completes
the mission.

### Live Rank 3 to Rank 4 result

- Six owned Fire Crystals supplied `996` rank points to unlock 3-1.
- The Four Musketeers completed through its normal briefing, twenty credited
  Copper Quadav deaths, Beadeaux-to-Pashhow transition, and completion
  cutscene. It awarded `350` points.
- Thirteen more owned Fire Crystals supplied `2,158` points, bringing the
  total to `3,504` and unlocking mission 3-3 directly through its guarded
  normal-gate acceptance operation.
- One broad Beadeaux relocation entered an Elder/Zircon Quadav pocket and
  caused a death. The successful continuation teleported to the verified
  level-22/23 entrance cluster, enabled Trusts, disabled relocation, and used
  a bounded exact-name objective. Exact-objective mode now waits instead of
  falling back to unrelated proactive targets when its named mob is absent.
- Porphyrion was defeated once with Trusts from an empty staging point at
  `-340, 12, -144`; the guaranteed Delkfutt Key appeared in inventory.
- The observed client name for `_542` is `Cermet Door`. The normal
  `/item "Delkfutt Key" <t>` command started the mission cutscene after a long
  delay, consumed the inventory key at event completion, granted the key item,
  and advanced status to `3`. Trade verification now polls for up to 30
  seconds instead of reporting a false failure after 2.5 seconds.
- The final embassy report completed mission `12`, awarded 5,000 gil, and was
  verified as `rank=4`, no current mission, and status `0`.
- Cinematic `menu rem...` frames can remain blank for several seconds. The
  dialogue helper now carries cinematic grace from its initial menu state and
  across all later transition frames, while still stopping on unrecognized
  selection menus.

## Reusable mission and battlefield findings

- President Karst's initial `Any questions?` prompt loops on the first choice.
  Select `No questions` to finish the briefing.
- One-time story or Rhapsodies cutscenes may preempt a mission NPC's intended
  event. Finish the unexpected cutscene, then interact with the NPC again.
- Exact NPC interaction is most reliable below 0.9 yalms.
- Mission NMs and battlefield enemies report `strength is impossible to
  gauge`. The combat parser treats that as `caution`; a caller must explicitly
  allow caution rather than silently treating it as safe.
- An NM can patrol out of range between `/check` and `/attack`. Out-of-range
  attack registration is retryable under the same exact-ID and bounded-attempt
  policy.
- Battlefield entrances expose a client-only choice list even when the bridge
  menu flag remains false. Visually select the named mission rather than
  `None`.
- Before the fight, Balga's Dais exposes decorative copies with zone NPC IDs.
  After entry, the activated enemies use their mob spawn IDs: in the first
  arena these were Black Dragon `17375233` and Searcher `17375234`. Re-observe
  after activation and attack only the live, status-1 copies.
- The battlefield clear initially left the client bridge's cached rank at 2.
  The server database already held `rank_bastok = 3`; one normal zone reload
  refreshed MCP state to Rank 3 with rank points reset to zero.
