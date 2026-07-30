function profile(value) {
  return Object.freeze({
    ...value,
    placeholder_server_ids: Object.freeze([...value.placeholder_server_ids]),
    notorious_monster_server_ids: Object.freeze([
      ...value.notorious_monster_server_ids,
    ]),
    watched_items: Object.freeze(
      value.watched_items.map((item) => Object.freeze({ ...item })),
    ),
    sweep_positions: Object.freeze(
      value.sweep_positions.map((position) => Object.freeze({ ...position })),
    ),
  });
}

export const NM_ROUTE_PROFILES = Object.freeze([
  profile({
    id: "leaping_lizzy",
    name: "Leaping Lizzy",
    zone_id: 107,
    placeholder_server_ids: [17215867],
    notorious_monster_server_ids: [17215868, 17215888],
    watched_items: [{ item_id: 15351, name: "Bounding Boots" }],
    maximum_placeholder_kills_per_visit: 1,
    maximum_elevation_difference: 10,
    sweep_positions: [
      { x: -270, y: -410, z: 22 },
      { x: -340, y: -420, z: 30 },
      { x: -270, y: -340, z: 22 },
      { x: -335, y: -345, z: 30 },
    ],
  }),
  profile({
    id: "stinging_sophie",
    name: "Stinging Sophie",
    zone_id: 106,
    placeholder_server_ids: [
      17211531,
      17211532,
      17211533,
      17211534,
      17211535,
      17211536,
      17211556,
      17211557,
      17211558,
      17211559,
      17211560,
    ],
    notorious_monster_server_ids: [17211537, 17211561],
    watched_items: [{ item_id: 16486, name: "Beestinger" }],
    maximum_placeholder_kills_per_visit: 3,
    maximum_elevation_difference: 25,
    sweep_positions: [
      { x: 220, y: 470, z: -40 },
      { x: 340, y: 470, z: -40 },
      { x: 220, y: 570, z: -40 },
      { x: 330, y: 590, z: -40 },
      { x: 290, y: 525, z: -50 },
    ],
  }),
  profile({
    id: "jaggedy_eared_jack",
    name: "Jaggedy-Eared Jack",
    zone_id: 100,
    placeholder_server_ids: [17187110],
    notorious_monster_server_ids: [17187111],
    watched_items: [{ item_id: 13112, name: "Rabbit Charm" }],
    maximum_placeholder_kills_per_visit: 1,
    maximum_elevation_difference: 15,
    sweep_positions: [
      { x: -260, y: -220, z: -20 },
      { x: -350, y: -230, z: -15 },
      { x: -260, y: -315, z: -15 },
      { x: -355, y: -310, z: -15 },
    ],
  }),
  profile({
    id: "spiny_spipi",
    name: "Spiny Spipi",
    zone_id: 116,
    placeholder_server_ids: [17252656],
    notorious_monster_server_ids: [17252657],
    watched_items: [{ item_id: 13607, name: "Mist Silk Cape" }],
    maximum_placeholder_kills_per_visit: 1,
    maximum_elevation_difference: 12,
    sweep_positions: [
      { x: 270, y: 150, z: -12 },
      { x: 210, y: 215, z: -10 },
      { x: 285, y: 235, z: -8 },
      { x: 360, y: 240, z: -5 },
      { x: 410, y: 270, z: -5 },
    ],
  }),
]);

export const NM_ROUTE_SAFE_EXIT = Object.freeze({
  name: "Bastok Markets",
  zone_id: 235,
  position: Object.freeze({
    x: -304,
    y: -161.5,
    z: -10.32,
  }),
});
