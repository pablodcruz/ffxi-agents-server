--[[
AgentBridge exposes a narrow, localhost-only JSON-lines interface for an AI
agent operating on a private LandSandBoat server.

It intentionally does not support arbitrary GM commands, chat, arbitrary
console commands, scripts, packet injection, or remote network binding.
Dedicated private-server operations expose only validated LandSandBoat !pos
service travel and a few exact, guarded normal-client packet flows.
--]]

addon.name = 'agentbridge';
addon.author = 'FFXI Agent Lab';
addon.version = '0.31.0';
addon.desc = 'Local observation and allowlisted gameplay bridge for private-server agents.';

require 'common';

local ffi = require 'ffi';
local fonts = require 'fonts';
local json = require 'json';
local socket = require 'socket';

local bridge =
{
    listener = nil,
    client = nil,
    client_buffer = '',
    config = nil,
    events = T{},
    next_event_id = 1,
    control_enabled = false,
    control_changed_at = 0,
    control_reason = 'addon_load',
    movement = nil,
    next_movement_check = 0,
    input_pulse = nil,
    heading_hold = nil,
    activity_feed_enabled = false,
    activity_font = nil,
    activity_lines = T{},
    goal_overlay_enabled = false,
    goal_font = nil,
    goal_current_gil = 0,
    goal_target_gil = 10000,
    goal_title = nil,
    goal_progress_label = nil,
    merchant_context_server_id = nil,
    merchant_catalog = {},
};

local allowed_commands =
{
    ['/attack'] = true,
    ['/attackoff'] = true,
    ['/check'] = true,
    ['/equip'] = true,
    ['/follow'] = true,
    ['/heal'] = true,
    ['/item'] = true,
    ['/ja'] = true,
    ['/jobability'] = true,
    ['/lockon'] = true,
    ['/ma'] = true,
    ['/magic'] = true,
    ['/pet'] = true,
    ['/ra'] = true,
    ['/range'] = true,
    ['/refa'] = true,
    ['/ta'] = true,
    ['/target'] = true,
    ['/trade'] = true,
    ['/weaponskill'] = true,
    ['/ws'] = true,
};

local allowed_input_actions =
{
    forward = 0x48,
    backward = 0x50,
    turn_left = 0x4B,
    turn_right = 0x4D,
    camera_left = 0xCB,
    camera_right = 0xCD,
};

local allowed_menu_actions =
{
    cancel = 0x01,
    confirm = 0x1C,
    down = 0xD0,
    left = 0xCB,
    open_context_menu = 0x4E,
    open_equipment = 0x12,
    open_items = 0x17,
    open_job_abilities = 0x24,
    open_magic = 0x32,
    open_main_menu = 0x4A,
    open_weapon_skills = 0x11,
    right = 0xCD,
    show_interface = 0x46,
    up = 0xC8,
};

local modified_menu_actions =
{
    open_equipment = true,
    open_items = true,
    open_job_abilities = true,
    open_magic = true,
    open_weapon_skills = true,
};

local allowed_teleport_reasons =
{
    combat_position = true,
    quest_npc = true,
    vendor = true,
    travel_node = true,
    stuck_recovery = true,
};

local job_change_npc_names =
{
    ['Moogle'] = true,
    ['Nomad Moogle'] = true,
    ['Green Thumb Moogle'] = true,
    ['Pilgrim Moogle'] = true,
};

-- Repository-controlled NPC-sale allowlist. Keep this duplicated in the host
-- wrapper so neither side can expand the destructive scope independently.
local allowed_npc_sale_items =
{
    [505] = true,   -- Sheepskin
    [573] = true,   -- Vegetable Seeds
    [575] = true,   -- Grain Seeds
    [768] = true,   -- Flint Stone
    [847] = true,   -- Bird Feather
    [852] = true,   -- Lizard Skin
    [856] = true,   -- Rabbit Hide
    [881] = true,   -- Crab Shell
    [882] = true,   -- Sheep Tooth
    [924] = true,   -- Fiend Blood
    [925] = true,   -- Giant Stinger
    [926] = true,   -- Lizard Tail
    [936] = true,   -- Rock Salt
    [953] = true,   -- Treant Bulb
    [4570] = true,  -- Bird Egg
    [12385] = true, -- Acheron Shield
    [508] = true,   -- Goblin Helm
    [511] = true,   -- Goblin Mask
    [642] = true,   -- Zinc Ore
    [750] = true,   -- Silver Beastcoin
    [846] = true,   -- Insect Wing
    [912] = true,   -- Beehive Chip
    [922] = true,   -- Bat Wing
    [1984] = true,  -- Snapping Mole
    [4358] = true,  -- Hare Meat
    [4362] = true,  -- Lizard Egg
    [4366] = true,  -- La Theine Cabbage
    [4368] = true,  -- Two-Leaf Mandragora Bud
    [4370] = true,  -- Honey
    [4372] = true,  -- Giant Sheep Meat
    [4387] = true,  -- Wild Onion
    [4400] = true,  -- Land Crab Meat
    [4468] = true,  -- Pamamas
    [5187] = true,  -- Elshimo Coconut
    [12464] = true, -- Headgear
    [12592] = true, -- Doublet
    [12631] = true, -- Hume Tunic
    [12720] = true, -- Gloves
    [12754] = true, -- Hume M Gloves
    [12848] = true, -- Brais
    [12864] = true, -- Slacks
    [12883] = true, -- Hume Slacks
    [12976] = true, -- Gaiters
    [13005] = true, -- Hume M Boots
    [17051] = true, -- Yew Wand
    [17296] = true, -- Pebble
    [17868] = true, -- Humus
};

-- Exact general-shop purchases that may bypass client menu traversal. The
-- server still owns the live merchant container, price check, gil deduction,
-- inventory-capacity check, and item grant. Pinning NPC, item, shop index, and
-- price on both sides prevents this narrow operation from becoming an
-- arbitrary vendor packet primitive.
local allowed_vendor_purchases =
{
    [17739806] = -- Zaira, Bastok Markets
    {
        [4762] = true, -- Aero
        [4767] = true, -- Stone
        [4772] = true, -- Thunder
        [4777] = true, -- Water
        [4828] = true, -- Poison
        [4838] = true, -- Bio
        [4843] = true, -- Burn
        [4844] = true, -- Frost
        [4845] = true, -- Choke
        [4846] = true, -- Rasp
        [4847] = true, -- Shock
        [4848] = true, -- Drown
        [4861] = true, -- Sleep
        [4862] = true, -- Blind
    },
    [17793068] = -- Chutarmire, Selbina
    {
        [4768] = true, -- Stone II
        [4778] = true, -- Water II
        [4797] = true, -- Stonega
        [4807] = true, -- Waterga
    },
};

local interface_hidden_signature = ashita.memory.find(
    'FFXiMain.dll',
    0,
    '8B4424046A016A0050B9????????E8????????F6D81BC040C3',
    0,
    0
);

local function interface_visibility_snapshot()
    if (interface_hidden_signature == 0) then
        return { observable = false, hidden = false };
    end
    local ok, hidden = pcall(function ()
        local ptr = ashita.memory.read_uint32(interface_hidden_signature + 10);
        if (ptr == 0) then
            error('interface visibility pointer is unavailable');
        end
        return ashita.memory.read_uint8(ptr + 0xB4) == 1;
    end);
    return
    {
        observable = ok,
        hidden = ok and hidden or false,
    };
end

local function close_client()
    if (bridge.client ~= nil) then
        bridge.client:close();
    end
    bridge.client = nil;
    bridge.client_buffer = '';
end

local function stop_listener()
    close_client();
    if (bridge.listener ~= nil) then
        bridge.listener:close();
    end
    bridge.listener = nil;
end

local function read_config()
    local path = addon.path .. '/config.json';
    local file = io.open(path, 'rb');
    if (file == nil) then
        print('[AgentBridge] Missing config.json. Copy config.example.json and set a strong token.');
        return nil;
    end

    local content = file:read('*a');
    file:close();

    local ok, config = pcall(json.decode, content);
    if (not ok or type(config) ~= 'table') then
        print('[AgentBridge] config.json is not valid JSON.');
        return nil;
    end

    if (config.bind_host ~= '127.0.0.1') then
        print('[AgentBridge] Refusing to bind outside 127.0.0.1.');
        return nil;
    end
    if (type(config.bind_port) ~= 'number' or config.bind_port < 1024 or config.bind_port > 65535) then
        print('[AgentBridge] bind_port must be between 1024 and 65535.');
        return nil;
    end
    if (type(config.token) ~= 'string' or #config.token < 24 or config.token:find('replace%-with') == 1) then
        print('[AgentBridge] token must be replaced with at least 24 characters.');
        return nil;
    end
    if (config.activity_feed_enabled ~= nil and type(config.activity_feed_enabled) ~= 'boolean') then
        print('[AgentBridge] activity_feed_enabled must be true or false.');
        return nil;
    end
    local overlay_coordinates =
    {
        'overlay_position_x',
        'goal_overlay_position_y',
        'activity_overlay_position_y',
    };
    for _, key in ipairs(overlay_coordinates) do
        local value = config[key];
        if (
            value ~= nil and
            (type(value) ~= 'number' or value < 0 or value > 4096 or value ~= math.floor(value))
        ) then
            print(('[AgentBridge] %s must be an integer from 0 through 4096.'):fmt(key));
            return nil;
        end
    end
    return config;
end

local function display_activity_event(message)
    if (not bridge.activity_feed_enabled) then
        return;
    end

    local display = message
        :gsub('%c', ' ')
        :gsub('%s+', ' ')
        :match('^%s*(.-)%s*$')
        :sub(1, 180);
    local visible =
        display:find('^Agent movement ') ~= nil or
        display:find('^Agent target ') ~= nil or
        display:find('^Agent gameplay command ') ~= nil or
        display:find('^Agent heading ') ~= nil or
        display:find('^Agent .- pulse ') ~= nil or
        display:find('^Agent activity feed ') ~= nil;
    if (visible) then
        local summary = display:gsub('^Agent ', '');
        print(('[Agent Activity] %s'):fmt(summary));
        bridge.activity_lines:append(('[%s] %s'):fmt(os.date('%H:%M:%S'), summary));
        while (#bridge.activity_lines > 6) do
            table.remove(bridge.activity_lines, 1);
        end
        if (bridge.activity_font ~= nil) then
            bridge.activity_font.text =
                'AGENT ACTIVITY - LOCAL ONLY\n' ..
                bridge.activity_lines:concat('\n');
        end
    end
end

local function format_integer(value)
    local text = tostring(math.floor(value));
    while (true) do
        local updated, count = text:gsub('^(-?%d+)(%d%d%d)', '%1,%2');
        text = updated;
        if (count == 0) then
            return text;
        end
    end
end

local function refresh_goal_overlay()
    if (bridge.goal_font == nil) then
        return;
    end
    bridge.goal_font.visible = bridge.goal_overlay_enabled;
    if (not bridge.goal_overlay_enabled) then
        bridge.goal_font.text = '';
        return;
    end
    if (bridge.goal_title ~= nil and bridge.goal_progress_label ~= nil) then
        bridge.goal_font.text =
            'CURRENT GOAL: ' .. bridge.goal_title .. '\n' ..
            'PROGRESS: ' .. bridge.goal_progress_label;
    else
        bridge.goal_font.text =
            'CURRENT GOAL: EARN ' .. format_integer(bridge.goal_target_gil) .. ' GIL BEFORE QUESTING\n' ..
            'PROGRESS: ' .. format_integer(bridge.goal_current_gil) .. ' / ' ..
            format_integer(bridge.goal_target_gil) .. ' GIL';
    end
end

local function add_event(mode, message)
    if (type(message) ~= 'string' or #message == 0) then
        return;
    end

    message = message:gsub('[\r\n]', ' '):sub(1, 512);
    bridge.events:append(
    {
        id = bridge.next_event_id,
        timestamp = os.time(),
        mode = mode,
        message = message,
    });
    bridge.next_event_id = bridge.next_event_id + 1;

    while (#bridge.events > 100) do
        table.remove(bridge.events, 1);
    end
    if (mode == -1) then
        display_activity_event(message);
    end
end

local function stop_movement(reason)
    pcall(function ()
        local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
        auto_follow:SetIsAutoRunning(0);
        auto_follow:SetTargetIndex(0);
        auto_follow:SetTargetServerId(0);
        auto_follow:SetFollowTargetIndex(0);
        auto_follow:SetFollowTargetServerId(0);
        auto_follow:SetFollowDeltaX(0);
        auto_follow:SetFollowDeltaZ(0);
        auto_follow:SetFollowDeltaY(0);
        auto_follow:SetFollowDeltaW(1);
    end);

    local was_active = bridge.movement ~= nil;
    bridge.movement = nil;
    bridge.next_movement_check = 0;
    if (was_active) then
        add_event(-1, ('Agent movement stopped: %s'):fmt(reason or 'requested'));
    end
    return was_active;
end

local function stop_input_pulse(reason)
    local was_active = bridge.input_pulse ~= nil;
    local action = was_active and bridge.input_pulse.action or 'input';
    bridge.input_pulse = nil;
    if (was_active) then
        add_event(-1, ('Agent %s pulse stopped: %s'):fmt(action, reason or 'requested'));
    end
    return was_active;
end

local function stop_heading_hold(reason)
    local was_active = bridge.heading_hold ~= nil;
    bridge.heading_hold = nil;
    if (was_active) then
        add_event(-1, ('Agent heading hold stopped: %s'):fmt(reason or 'requested'));
    end
    return was_active;
end

local function emergency_stop(reason)
    bridge.control_enabled = false;
    bridge.control_changed_at = os.time();
    bridge.control_reason = reason or 'emergency_stop';
    stop_movement(bridge.control_reason);
    stop_input_pulse(bridge.control_reason);
    stop_heading_hold(bridge.control_reason);
    AshitaCore:GetChatManager():QueueCommand(1, '/attackoff');
    add_event(-1, ('Agent control disabled: %s'):fmt(bridge.control_reason));
end

local function require_control_enabled()
    if (not bridge.control_enabled) then
        error('Agent writes are disabled. Explicitly enable control before targeting, moving, or acting.');
    end
end

local function control_snapshot()
    local auto_running = false;
    pcall(function ()
        auto_running = AshitaCore:GetMemoryManager():GetAutoFollow():GetIsAutoRunning() > 0;
    end);
    local movement = nil;
    if (bridge.movement ~= nil) then
        movement =
        {
            kind = bridge.movement.kind,
            server_id = bridge.movement.server_id,
            name = bridge.movement.name,
            target_x = bridge.movement.target_x,
            target_y = bridge.movement.target_y,
            started_at = bridge.movement.started_at,
            deadline = bridge.movement.deadline,
            stop_distance = bridge.movement.stop_distance,
            best_distance = bridge.movement.best_distance,
            last_progress_at = bridge.movement.last_progress_at,
        };
    end
    return
    {
        enabled = bridge.control_enabled,
        changed_at = bridge.control_changed_at,
        reason = bridge.control_reason,
        auto_running = auto_running,
        movement = movement,
        input_active = bridge.input_pulse ~= nil,
        heading_active = bridge.heading_hold ~= nil,
        activity_feed_enabled = bridge.activity_feed_enabled,
    };
end

local function activity_overlay_snapshot()
    local manager_visible = false;
    local object_visible = false;
    pcall(function ()
        manager_visible = AshitaCore:GetFontManager():GetVisible();
    end);
    if (bridge.activity_font ~= nil) then
        pcall(function ()
            object_visible = bridge.activity_font.visible == true;
        end);
    end
    return
    {
        present = bridge.activity_font ~= nil,
        manager_visible = manager_visible,
        object_visible = object_visible,
        line_count = #bridge.activity_lines,
    };
end

local function goal_overlay_snapshot()
    local manager_visible = false;
    local object_visible = false;
    pcall(function ()
        manager_visible = AshitaCore:GetFontManager():GetVisible();
    end);
    if (bridge.goal_font ~= nil) then
        pcall(function ()
            object_visible = bridge.goal_font.visible == true;
        end);
    end
    return
    {
        present = bridge.goal_font ~= nil,
        enabled = bridge.goal_overlay_enabled,
        manager_visible = manager_visible,
        object_visible = object_visible,
        current_gil = bridge.goal_current_gil,
        target_gil = bridge.goal_target_gil,
        title = bridge.goal_title,
        progress_label = bridge.goal_progress_label,
        local_overlay_only = true,
    };
end

local function recent_events(limit)
    limit = math.floor(tonumber(limit) or 20);
    limit = math.clamp(limit, 0, 100);

    local result = T{};
    local first = math.max(1, #bridge.events - limit + 1);
    for index = first, #bridge.events do
        result:append(bridge.events[index]);
    end
    return result;
end

local function entity_snapshot(index, entity_manager)
    if (index == nil or index <= 0) then
        return nil;
    end

    local server_id = entity_manager:GetServerId(index);
    if (server_id == 0) then
        return nil;
    end

    local distance_squared = math.max(0, entity_manager:GetDistance(index));
    return
    {
        index = index,
        server_id = server_id,
        name = entity_manager:GetName(index) or '',
        distance = math.sqrt(distance_squared),
        hp_percent = entity_manager:GetHPPercent(index),
        status = entity_manager:GetStatus(index),
        entity_type = entity_manager:GetType(index),
        heading = entity_manager:GetHeading(index),
        position =
        {
            x = entity_manager:GetLocalPositionX(index),
            y = entity_manager:GetLocalPositionY(index),
            z = entity_manager:GetLocalPositionZ(index),
        },
    };
end

local function party_snapshot(party)
    local result = T{};
    for index = 0, 17 do
        if (party:GetMemberIsActive(index) > 0 and party:GetMemberServerId(index) > 0) then
            result:append(
            {
                slot = index,
                name = party:GetMemberName(index) or '',
                server_id = party:GetMemberServerId(index),
                target_index = party:GetMemberTargetIndex(index),
                hp = party:GetMemberHP(index),
                hp_percent = party:GetMemberHPPercent(index),
                mp = party:GetMemberMP(index),
                mp_percent = party:GetMemberMPPercent(index),
                tp = party:GetMemberTP(index),
                zone_id = party:GetMemberZone(index),
                main_job = party:GetMemberMainJob(index),
                main_job_level = party:GetMemberMainJobLevel(index),
                sub_job = party:GetMemberSubJob(index),
                sub_job_level = party:GetMemberSubJobLevel(index),
            });
        end
    end
    return result;
end

local function current_target(target)
    local slot = target:GetIsSubTargetActive() ~= 0 and 1 or 0;
    return tonumber(target:GetTargetIndex(slot)) or 0, slot;
end

local function observe(params)
    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local party = memory:GetParty();
    local target = memory:GetTarget();
    local entities = memory:GetEntity();

    local radius = math.clamp(tonumber(params.radius) or 20, 1, 50);
    local max_entities = math.floor(math.clamp(tonumber(params.max_entities) or 32, 1, 64));
    local event_limit = math.floor(math.clamp(tonumber(params.event_limit) or 10, 0, 50));
    local player_index = party:GetMemberTargetIndex(0);
    local target_index, target_slot = current_target(target);
    local nearby = T{};
    local entity_map_size = entities:GetEntityMapSize();

    for index = 0, entity_map_size - 1 do
        if (index ~= player_index and entities:GetServerId(index) > 0) then
            local distance_squared = math.max(0, entities:GetDistance(index));
            if (distance_squared <= radius * radius) then
                local snapshot = entity_snapshot(index, entities);
                if (snapshot ~= nil and snapshot.name ~= '') then
                    nearby:append(snapshot);
                end
            end
        end
    end

    table.sort(nearby, function (left, right)
        return left.distance < right.distance;
    end);
    while (#nearby > max_entities) do
        table.remove(nearby);
    end

    return
    {
        observed_at = os.time(),
        login_status = player:GetLoginStatus(),
        player = entity_snapshot(player_index, entities),
        target = entity_snapshot(target_index, entities),
        target_slot = target_slot,
        subtarget_active = target:GetIsSubTargetActive() ~= 0,
        party = party_snapshot(party),
        nearby_entities = nearby,
        recent_events = recent_events(event_limit),
        control = control_snapshot(),
    };
end

local function resource_entry_name(entry, fallback)
    if (entry == nil) then
        return fallback;
    end

    local ok, name = pcall(function ()
        return entry.Name[1];
    end);
    if (not ok or type(name) ~= 'string' or #name == 0) then
        return fallback;
    end
    return name:sub(1, 128);
end

local function buff_name(resource_manager, id)
    local ok, name = pcall(function ()
        return resource_manager:GetString('buffs.names', id);
    end);
    if (not ok or type(name) ~= 'string' or #name == 0) then
        return ('Unknown status %d'):fmt(id);
    end
    return name:sub(1, 128);
end

-- Read the focused menu's internal name using the same pointer chain as
-- Ashita v4's official autologin addon. This is observation only; failures
-- return an empty string instead of exposing or dereferencing arbitrary data.
local function current_menu_name()
    local ok, value = pcall(function ()
        local ptr = AshitaCore:GetPointerManager():Get('menu');
        if (ptr == 0) then return ''; end
        ptr = ashita.memory.read_uint32(ptr);
        if (ptr == 0) then return ''; end
        ptr = ashita.memory.read_uint32(ptr);
        if (ptr == 0) then return ''; end
        ptr = ashita.memory.read_uint32(ptr + 0x04);
        if (ptr == 0) then return ''; end
        return ashita.memory.read_string(ptr + 0x46, 16) or '';
    end);
    if (not ok or type(value) ~= 'string') then
        return '';
    end
    return value:sub(1, 16);
end

local function character_state(params)
    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local login_status = tonumber(player:GetLoginStatus()) or 0;
    if (login_status ~= 2) then
        error('Character state is unavailable until a character is logged in.');
    end

    local resources = AshitaCore:GetResourceManager();
    local target = memory:GetTarget();
    local inventory = memory:GetInventory();
    local menu_open = target:GetIsMenuOpen() ~= 0;
    local selected_item_id = tonumber(inventory:GetSelectedItemId()) or 0;
    local selected_item_index = tonumber(inventory:GetSelectedItemIndex()) or 0;
    local selected_item_name = inventory:GetSelectedItemName() or '';
    if (type(selected_item_name) ~= 'string') then
        selected_item_name = '';
    end
    local result =
    {
        observed_at = os.time(),
        login_status = login_status,
        player =
        {
            hp_max = tonumber(player:GetHPMax()),
            mp_max = tonumber(player:GetMPMax()),
            main_job_id = tonumber(player:GetMainJob()),
            main_job_level = tonumber(player:GetMainJobLevel()),
            sub_job_id = tonumber(player:GetSubJob()),
            sub_job_level = tonumber(player:GetSubJobLevel()),
            exp_current = tonumber(player:GetExpCurrent()),
            exp_needed = tonumber(player:GetExpNeeded()),
            attack = tonumber(player:GetAttack()),
            defense = tonumber(player:GetDefense()),
            title_id = tonumber(player:GetTitle()),
            rank = tonumber(player:GetRank()),
            rank_points = tonumber(player:GetRankPoints()),
            nation_id = tonumber(player:GetNation()),
            zoning = player:GetIsZoning() ~= 0,
        },
        menu_open = menu_open,
        menu_name = menu_open and current_menu_name() or '',
        interface_visibility = interface_visibility_snapshot(),
        activity_overlay = activity_overlay_snapshot(),
        goal_overlay = goal_overlay_snapshot(),
        selected_item =
        {
            active = menu_open and selected_item_id > 0,
            item_id = selected_item_id,
            slot = selected_item_index,
            name = selected_item_name:sub(1, 128),
        },
        equipment = T{},
        statuses = T{},
    };

    local equipment_slot_names =
    {
        [0] = 'main',
        [1] = 'sub',
        [2] = 'range',
        [3] = 'ammo',
        [4] = 'head',
        [5] = 'body',
        [6] = 'hands',
        [7] = 'legs',
        [8] = 'feet',
        [9] = 'neck',
        [10] = 'waist',
        [11] = 'ear1',
        [12] = 'ear2',
        [13] = 'ring1',
        [14] = 'ring2',
        [15] = 'back',
    };
    for equipment_slot = 0, 15 do
        local equipment_entry = inventory:GetEquippedItem(equipment_slot);
        local packed_index = equipment_entry ~= nil and tonumber(equipment_entry.Index) or 0;
        local equipped =
        {
            slot_id = equipment_slot,
            slot_name = equipment_slot_names[equipment_slot],
            equipped = packed_index > 0,
            container_id = 0,
            container_slot = 0,
            item_id = 0,
            name = '',
        };
        if (packed_index > 0) then
            equipped.container_id = bit.band(packed_index, 0xFF00) / 0x0100;
            equipped.container_slot = packed_index % 0x0100;
            local item = inventory:GetContainerItem(
                equipped.container_id,
                equipped.container_slot
            );
            if (item ~= nil and tonumber(item.Id) ~= nil and tonumber(item.Id) > 0) then
                equipped.item_id = tonumber(item.Id);
                local ok, resource_item = pcall(function ()
                    return resources:GetItemById(equipped.item_id);
                end);
                equipped.name = resource_entry_name(
                    ok and resource_item or nil,
                    ('Unknown item %d'):fmt(equipped.item_id)
                );
            end
        end
        result.equipment:append(equipped);
    end

    -- Buff ids are the current effects. Status-icon ids and timers are the
    -- client timer-display slots. The SDK does not document the status timer
    -- unit, so it is deliberately returned as an unconverted raw value.
    local buffs = player:GetBuffs();
    local status_icons = player:GetStatusIcons();
    local status_timers = player:GetStatusTimers();
    for index = 0, 31 do
        local buff_id = tonumber(buffs[index]) or -1;
        local status_icon_id = tonumber(status_icons[index]) or -1;
        if (buff_id > 0 or status_icon_id > 0) then
            local name_id = buff_id > 0 and buff_id or status_icon_id;
            result.statuses:append(
            {
                slot = index,
                buff_id = buff_id,
                status_icon_id = status_icon_id,
                name = buff_name(resources, name_id),
                timer_raw = tonumber(status_timers[index]) or 0,
            });
        end
    end

    if (params.include_recasts ~= false) then
        local max_recasts = math.floor(math.clamp(tonumber(params.max_recasts) or 32, 1, 64));
        local recast = memory:GetRecast();
        result.recasts = T{};

        for index = 0, 31 do
            if (#result.recasts >= max_recasts) then
                break;
            end
            local timer = tonumber(recast:GetAbilityTimer(index)) or 0;
            local timer_id = tonumber(recast:GetAbilityTimerId(index)) or 0;
            if (timer > 0 and (timer_id ~= 0 or index == 0)) then
                local fallback = index == 0 and 'Job one-hour ability' or ('Unknown ability %d'):fmt(timer_id);
                local ok, ability = pcall(function ()
                    return resources:GetAbilityByTimerId(timer_id);
                end);
                result.recasts:append(
                {
                    kind = 'ability',
                    slot = index,
                    timer_id = timer_id,
                    name = resource_entry_name(ok and ability or nil, fallback),
                    timer_ticks = timer,
                    seconds = timer / 60,
                });
            end
        end

        for spell_id = 0, 1024 do
            if (#result.recasts >= max_recasts) then
                break;
            end
            local timer = tonumber(recast:GetSpellTimer(spell_id)) or 0;
            if (timer > 0) then
                local ok, spell = pcall(function ()
                    return resources:GetSpellById(spell_id);
                end);
                result.recasts:append(
                {
                    kind = 'spell',
                    spell_id = spell_id,
                    name = resource_entry_name(ok and spell or nil, ('Unknown spell %d'):fmt(spell_id)),
                    timer_ticks = timer,
                    seconds = timer / 60,
                });
            end
        end
    end

    if (params.inventory_container ~= nil) then
        local container = math.floor(tonumber(params.inventory_container) or -1);
        if (container < 0 or container > 16) then
            error('inventory_container must be between 0 and 16.');
        end

        local max_items = math.floor(math.clamp(tonumber(params.max_items) or 40, 1, 80));
        local container_max = tonumber(inventory:GetContainerCountMax(container)) or 0;
        local snapshot =
        {
            container_id = container,
            count = tonumber(inventory:GetContainerCount(container)) or 0,
            capacity = container_max,
            items = T{},
            truncated = false,
        };

        for slot = 0, math.min(container_max, 80) do
            local item = inventory:GetContainerItem(container, slot);
            if (item ~= nil and tonumber(item.Id) ~= nil and tonumber(item.Id) > 0) then
                if (#snapshot.items >= max_items) then
                    snapshot.truncated = true;
                    break;
                end
                local item_id = tonumber(item.Id);
                local ok, resource_item = pcall(function ()
                    return resources:GetItemById(item_id);
                end);
                snapshot.items:append(
                {
                    slot = slot,
                    item_id = item_id,
                    name = resource_entry_name(ok and resource_item or nil, ('Unknown item %d'):fmt(item_id)),
                    count = tonumber(item.Count) or 0,
                    flags = tonumber(item.Flags) or 0,
                });
            end
        end
        result.inventory = snapshot;
    end

    return result;
end

local function find_target(params)
    local memory = AshitaCore:GetMemoryManager();
    local entities = memory:GetEntity();
    local target = memory:GetTarget();
    local entity_map_size = entities:GetEntityMapSize();
    local requested_id = tonumber(params.server_id);
    local requested_name = type(params.name) == 'string' and params.name:lower() or nil;
    local max_distance = math.clamp(tonumber(params.max_distance) or 30, 1, 50);

    for index = 0, entity_map_size - 1 do
        local server_id = entities:GetServerId(index);
        if (server_id > 0 and entities:GetDistance(index) <= max_distance * max_distance) then
            local name = entities:GetName(index) or '';
            local matches = false;
            if (requested_id ~= nil) then
                -- An explicit server ID must disambiguate duplicate entity names.
                matches = server_id == requested_id;
            elseif (requested_name ~= nil) then
                matches = name:lower() == requested_name;
            end
            if (matches) then
                target:SetTarget(index, true);
                local snapshot = entity_snapshot(index, entities);
                add_event(-1, ('Agent target selected: %s (%u).'):fmt(
                    snapshot.name,
                    snapshot.server_id
                ));
                return snapshot;
            end
        end
    end

    error('No matching entity was found within the requested distance.');
end

local function clear_target()
    require_control_enabled();
    stop_movement('target_clear');
    local target = AshitaCore:GetMemoryManager():GetTarget();
    target:SetTarget(0, true);
    local target_index, target_slot = current_target(target);
    add_event(-1, 'Agent target lock cleared.');
    return
    {
        cleared = target_index == 0,
        target_index = target_index,
        target_slot = target_slot,
        subtarget_active = target:GetIsSubTargetActive() ~= 0,
        control = control_snapshot(),
    };
end

local function set_heading(params)
    require_control_enabled();
    stop_movement('heading_change');

    local heading = tonumber(params.heading);
    if (heading == nil or heading ~= heading or heading < -math.pi or heading > math.pi) then
        error('heading must be a finite number from -pi through pi.');
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot set heading until a character is logged in.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Cannot set heading while an in-game menu or dialogue is open.');
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        error('Could not resolve the local player entity.');
    end

    target:SetTarget(0, true);
    bridge.heading_hold = { heading = heading };
    entities:SetLocalPositionYaw(player_index, heading);
    entities:SetHeading(player_index, heading);
    add_event(-1, ('Agent heading set to %.4f radians.'):fmt(heading));
    return
    {
        heading = entities:GetHeading(player_index),
        local_position_yaw = entities:GetLocalPositionYaw(player_index),
        requested_heading = heading,
        player = entity_snapshot(player_index, entities),
        control = control_snapshot(),
    };
end

local function apply_heading_hold()
    local hold = bridge.heading_hold;
    if (hold == nil) then
        return;
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (not bridge.control_enabled or player:GetLoginStatus() ~= 2) then
        stop_heading_hold('control_disabled_or_logged_out');
        return;
    end
    if (target:GetIsMenuOpen() ~= 0) then
        stop_heading_hold('menu_open');
        return;
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        stop_heading_hold('player_unavailable');
        return;
    end

    entities:SetLocalPositionYaw(player_index, hold.heading);
    entities:SetHeading(player_index, hold.heading);
end

local function start_confirm_pulse(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot inject confirm input until a character is logged in.');
    end
    if (bridge.input_pulse ~= nil) then
        error('A confirm input pulse is already active.');
    end

    local mode = type(params.mode) == 'string' and params.mode:lower() or 'target';
    local entity = nil;
    if (mode == 'target') then
        params.max_distance = math.clamp(tonumber(params.max_distance) or 6, 1, 6);
        entity = find_target(params);
        if (entity.entity_type ~= 1 and entity.entity_type ~= 2 and entity.entity_type ~= 3) then
            error('The requested interaction target is not an NPC or world object.');
        end
        bridge.merchant_context_server_id = entity.server_id;
        bridge.merchant_catalog = {};
    elseif (mode == 'confirm') then
        error('Confirm mode requires the host MCP input adapter.');
    else
        error('Interaction mode must be target or confirm.');
    end

    stop_movement('interaction');
    bridge.input_pulse =
    {
        key = 0x1C,
        action = 'confirm',
        mode = mode,
        down_frames = 2,
        deadline = socket.gettime() + 0.08,
        release_frames = 2,
        requested_at = socket.gettime(),
    };
    add_event(-1, ('Agent confirm pulse queued (%s).'):fmt(mode));
    return
    {
        queued = true,
        mode = mode,
        entity = entity,
        menu_open = target:GetIsMenuOpen() ~= 0,
        control = control_snapshot(),
    };
end

local function start_input_pulse(params)
    require_control_enabled();
    stop_movement('directional_input');

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot inject directional input until a character is logged in.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Cannot inject directional input while an in-game menu or dialogue is open.');
    end
    if (bridge.input_pulse ~= nil) then
        error('An input pulse is already active.');
    end

    local action = type(params.action) == 'string' and params.action:lower() or '';
    local key = allowed_input_actions[action];
    if (key == nil) then
        error('Directional input action is outside the AgentBridge allowlist.');
    end
    local duration_ms = math.floor(tonumber(params.duration_ms) or 250);
    if (duration_ms < 50 or duration_ms > 1000) then
        error('duration_ms must be between 50 and 1000.');
    end

    target:SetTarget(0, true);
    local now = socket.gettime();
    bridge.input_pulse =
    {
        key = key,
        action = action,
        down_frames = 2,
        deadline = now + (duration_ms / 1000),
        release_frames = 2,
        requested_at = now,
    };
    add_event(-1, ('Agent %s pulse queued for %u ms.'):fmt(action, duration_ms));
    return
    {
        queued = true,
        action = action,
        key = key,
        duration_ms = duration_ms,
        input_source = 'agentbridge_directinput',
        control = control_snapshot(),
    };
end

local function start_menu_pulse(params)
    require_control_enabled();
    stop_movement('menu_input');

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot inject menu input until a character is logged in.');
    end
    if (bridge.input_pulse ~= nil) then
        error('An input pulse is already active.');
    end

    local action = type(params.action) == 'string' and params.action:lower() or '';
    local key = allowed_menu_actions[action];
    if (key == nil) then
        error('Menu input action is outside the AgentBridge allowlist.');
    end

    local menu_open = target:GetIsMenuOpen() ~= 0;
    local requires_closed_menu =
        action == 'open_main_menu' or
        action == 'show_interface' or
        modified_menu_actions[action] == true;
    if (requires_closed_menu and menu_open) then
        error('Opening a shortcut menu or showing the interface requires all menus to be closed.');
    end
    if (not requires_closed_menu and not menu_open) then
        error('Confirm, cancel, directional input, and the context menu require an open menu or dialogue.');
    end
    local interface_visibility = interface_visibility_snapshot();
    if (action == 'show_interface') then
        if (not interface_visibility.observable) then
            error('Interface visibility is unavailable; refusing a blind Scroll Lock toggle.');
        end
        if (not interface_visibility.hidden) then
            error('The FFXI interface is already visible.');
        end
    end

    local now = socket.gettime();
    bridge.input_pulse =
    {
        key = key,
        modifier_keys = modified_menu_actions[action] and { 0x1D } or nil,
        action = 'menu ' .. action,
        down_frames = 2,
        deadline = now + 0.08,
        release_frames = 2,
        requested_at = now,
    };
    add_event(-1, ('Agent menu %s pulse queued.'):fmt(action));
    return
    {
        queued = true,
        action = action,
        key = key,
        modifier_keys = bridge.input_pulse.modifier_keys,
        input_source = 'agentbridge_directinput',
        menu_open = menu_open,
        interface_visibility = interface_visibility,
        control = control_snapshot(),
    };
end

local function start_movement(params)
    require_control_enabled();

    local timeout_seconds = math.clamp(tonumber(params.timeout_seconds) or 10, 1, 20);
    local stuck_seconds = math.clamp(tonumber(params.stuck_seconds) or 3, 1, 8);
    local stop_distance = math.clamp(tonumber(params.stop_distance) or 3, 1, 10);
    local max_start_distance = math.clamp(tonumber(params.max_start_distance) or 25, 2, 40);
    if (stop_distance >= max_start_distance) then
        error('stop_distance must be smaller than max_start_distance.');
    end

    params.max_distance = max_start_distance;
    local entity = find_target(params);
    if (entity.distance <= stop_distance) then
        stop_movement('already_within_stop_distance');
        return
        {
            started = false,
            reason = 'already_within_stop_distance',
            entity = entity,
            control = control_snapshot(),
        };
    end

    stop_movement('replaced');
    local now = socket.gettime();
    local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
    auto_follow:SetTargetIndex(entity.index);
    auto_follow:SetTargetServerId(entity.server_id);
    auto_follow:SetFollowTargetIndex(entity.index);
    auto_follow:SetFollowTargetServerId(entity.server_id);
    auto_follow:SetFollowDeltaX(0);
    auto_follow:SetFollowDeltaZ(0);
    auto_follow:SetFollowDeltaY(0);
    auto_follow:SetFollowDeltaW(1);
    auto_follow:SetIsAutoRunning(1);

    bridge.movement =
    {
        kind = 'entity',
        index = entity.index,
        server_id = entity.server_id,
        name = entity.name,
        started_at = now,
        deadline = now + timeout_seconds,
        stop_distance = stop_distance,
        stuck_seconds = stuck_seconds,
        best_distance = entity.distance,
        last_progress_at = now,
    };
    bridge.next_movement_check = now + 0.1;
    add_event(-1, ('Agent movement started toward %s (%u).'):fmt(entity.name, entity.server_id));
    return
    {
        started = true,
        entity = entity,
        control = control_snapshot(),
    };
end

local function player_position()
    local memory = AshitaCore:GetMemoryManager();
    local player_index = memory:GetParty():GetMemberTargetIndex(0);
    local entities = memory:GetEntity();
    if (player_index <= 0 or entities:GetServerId(player_index) == 0) then
        return nil;
    end
    return
        entities:GetLocalPositionX(player_index),
        entities:GetLocalPositionY(player_index),
        entities:GetLocalPositionZ(player_index);
end

local function drive_toward_position(x, y)
    local px, py = player_position();
    if (px == nil) then
        error('Player position is unavailable.');
    end

    local dx = x - px;
    local dy = y - py;
    local distance = math.sqrt((dx * dx) + (dy * dy));
    if (distance > 0.01) then
        dx = dx / distance;
        dy = dy / distance;
    end

    local auto_follow = AshitaCore:GetMemoryManager():GetAutoFollow();
    auto_follow:SetTargetIndex(0);
    auto_follow:SetTargetServerId(0);
    auto_follow:SetFollowTargetIndex(0);
    auto_follow:SetFollowTargetServerId(0);
    auto_follow:SetFollowDeltaX(dx);
    auto_follow:SetFollowDeltaZ(0);
    auto_follow:SetFollowDeltaY(dy);
    auto_follow:SetFollowDeltaW(1);
    auto_follow:SetIsAutoRunning(1);
    return distance;
end

local function start_position_movement(params)
    require_control_enabled();

    local target_x = tonumber(params.x);
    local target_y = tonumber(params.y);
    if (target_x == nil or target_y == nil or target_x ~= target_x or target_y ~= target_y) then
        error('x and y must be finite world coordinates.');
    end
    if (math.abs(target_x) > 10000 or math.abs(target_y) > 10000) then
        error('x and y are outside the supported world-coordinate range.');
    end

    local timeout_seconds = math.clamp(tonumber(params.timeout_seconds) or 15, 1, 60);
    local stuck_seconds = math.clamp(tonumber(params.stuck_seconds) or 3, 1, 8);
    local stop_distance = math.clamp(tonumber(params.stop_distance) or 1, 0.5, 5);
    local max_start_distance = math.clamp(tonumber(params.max_start_distance) or 60, 2, 100);
    local px, py, pz = player_position();
    if (px == nil) then
        error('Player position is unavailable.');
    end
    local dx = target_x - px;
    local dy = target_y - py;
    local distance = math.sqrt((dx * dx) + (dy * dy));
    if (distance > max_start_distance) then
        error('Position waypoint is beyond max_start_distance.');
    end
    if (distance <= stop_distance) then
        stop_movement('already_within_stop_distance');
        return
        {
            started = false,
            reason = 'already_within_stop_distance',
            target = { x = target_x, y = target_y, z = pz },
            distance = distance,
            control = control_snapshot(),
        };
    end

    stop_movement('replaced');
    local now = socket.gettime();
    drive_toward_position(target_x, target_y);
    bridge.movement =
    {
        kind = 'position',
        target_x = target_x,
        target_y = target_y,
        started_at = now,
        deadline = now + timeout_seconds,
        stop_distance = stop_distance,
        stuck_seconds = stuck_seconds,
        best_distance = distance,
        last_progress_at = now,
    };
    bridge.next_movement_check = now + 0.1;
    add_event(-1, ('Agent movement started toward waypoint (%.2f, %.2f).'):fmt(target_x, target_y));
    return
    {
        started = true,
        target = { x = target_x, y = target_y, z = pz },
        distance = distance,
        control = control_snapshot(),
    };
end

local function service_teleport(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Service teleport requires a logged-in private-server character.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Service teleport requires all in-game menus and dialogue to be closed.');
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (
        player_index <= 0 or
        entities:GetServerId(player_index) == 0 or
        entities:GetStatus(player_index) ~= 0
    ) then
        error('Service teleport requires the character to be idle.');
    end
    if (params.confirmation ~= 'TELEPORT PRIVATE SERVER CHARACTER') then
        error('Service teleport requires the exact confirmation phrase.');
    end

    local reason = type(params.reason) == 'string' and params.reason:lower() or '';
    if (not allowed_teleport_reasons[reason]) then
        error('Service teleport reason is not allowlisted.');
    end

    local x = tonumber(params.x);
    local horizontal_y = tonumber(params.y);
    local elevation = tonumber(params.z);
    local zone_id = tonumber(params.zone_id);
    if (
        x == nil or horizontal_y == nil or elevation == nil or zone_id == nil or
        x ~= x or horizontal_y ~= horizontal_y or elevation ~= elevation or zone_id ~= zone_id or
        math.abs(x) > 10000 or math.abs(horizontal_y) > 10000 or math.abs(elevation) > 10000 or
        zone_id < 0 or zone_id > 298 or zone_id ~= math.floor(zone_id)
    ) then
        error('Service teleport coordinates or zone are invalid.');
    end

    stop_movement('service_teleport');
    stop_input_pulse('service_teleport');
    stop_heading_hold('service_teleport');
    target:SetTarget(0, true);

    -- LandSandBoat !pos uses x, elevation, horizontal-y, zone while
    -- AgentBridge observations expose x/y as the horizontal plane and z as
    -- elevation.
    local current_zone_id = party:GetMemberZone(0);
    local same_zone = current_zone_id == zone_id;
    local command;
    if (same_zone) then
        command = ('!pos %.3f %.3f %.3f'):fmt(
            x,
            elevation,
            horizontal_y
        );
    else
        command = ('!pos %.3f %.3f %.3f %u'):fmt(
            x,
            elevation,
            horizontal_y,
            zone_id
        );
    end
    AshitaCore:GetChatManager():QueueCommand(1, command);
    add_event(
        -1,
        ('Agent private-server service teleport queued (%s, zone %u, %s).'):fmt(
            reason,
            zone_id,
            same_zone and 'same-zone' or 'cross-zone'
        )
    );
    return
    {
        queued = true,
        destination = { x = x, y = horizontal_y, z = elevation },
        zone_id = zone_id,
        same_zone = same_zone,
        reason = reason,
        private_server_only = true,
        control = control_snapshot(),
    };
end

local function private_server_bastok_mission(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Bastok mission command requires a logged-in private-server character.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Bastok mission command requires all menus and dialogue to be closed.');
    end
    if (params.confirmation ~= 'ADVANCE PRIVATE SERVER BASTOK MISSION') then
        error('Bastok mission command requires the exact confirmation phrase.');
    end

    local party = memory:GetParty();
    local entities = memory:GetEntity();
    local player_index = party:GetMemberTargetIndex(0);
    if (
        player_index <= 0 or
        entities:GetServerId(player_index) == 0 or
        entities:GetStatus(player_index) ~= 0
    ) then
        error('Bastok mission command requires the character to be idle.');
    end

    local action = type(params.action) == 'string' and params.action:lower() or '';
    local command;
    local mission_id = tonumber(params.mission_id) or 0;
    if (action == 'status') then
        command = '!agentmission status';
        mission_id = 0;
    elseif (
        action == 'begin' and
        (mission_id == 10 or mission_id == 11 or mission_id == 12) and
        mission_id == math.floor(mission_id)
    ) then
        command = ('!agentmission begin %u'):fmt(mission_id);
    elseif (action == 'donate') then
        local quantity = tonumber(params.quantity) or 0;
        if (
            mission_id < 4096 or mission_id > 4103 or
            mission_id ~= math.floor(mission_id) or
            quantity < 1 or quantity > 99 or quantity ~= math.floor(quantity)
        ) then
            error('Bastok crystal donation is outside the allowlist.');
        end
        command = ('!agentmission donate %u %u'):fmt(mission_id, quantity);
    else
        error('Bastok mission command action or mission ID is not allowlisted.');
    end

    stop_movement('private_server_bastok_mission');
    stop_input_pulse('private_server_bastok_mission');
    stop_heading_hold('private_server_bastok_mission');
    target:SetTarget(0, true);
    AshitaCore:GetChatManager():QueueCommand(1, command);
    add_event(
        -1,
        ('Agent private-server Bastok mission command queued: %s%s.'):fmt(
            action,
            mission_id > 0 and (' ' .. tostring(mission_id)) or ''
        )
    );
    return
    {
        queued = true,
        action = action,
        mission_id = mission_id,
        quantity = action == 'donate' and tonumber(params.quantity) or 0,
        private_server_only = true,
        control = control_snapshot(),
    };
end

local function monitor_movement()
    if (bridge.movement == nil) then
        return;
    end

    local now = socket.gettime();
    if (now < bridge.next_movement_check) then
        return;
    end
    bridge.next_movement_check = now + 0.1;

    local memory = AshitaCore:GetMemoryManager();
    if (memory:GetPlayer():GetLoginStatus() ~= 2) then
        stop_movement('not_logged_in');
        return;
    end

    local movement = bridge.movement;
    local distance;
    if (movement.kind == 'position') then
        local px, py = player_position();
        if (px == nil) then
            stop_movement('player_position_unavailable');
            return;
        end
        local dx = movement.target_x - px;
        local dy = movement.target_y - py;
        distance = math.sqrt((dx * dx) + (dy * dy));
    else
        local entities = memory:GetEntity();
        if (entities:GetServerId(movement.index) ~= movement.server_id) then
            stop_movement('target_lost');
            return;
        end
        distance = math.sqrt(math.max(0, entities:GetDistance(movement.index)));
    end
    if (distance <= movement.stop_distance) then
        stop_movement('arrived');
        return;
    end
    if (now >= movement.deadline) then
        stop_movement('timeout');
        return;
    end

    if (distance <= movement.best_distance - 0.5) then
        movement.best_distance = distance;
        movement.last_progress_at = now;
    elseif (now - movement.last_progress_at >= movement.stuck_seconds) then
        stop_movement('no_progress');
        return;
    end

    if (movement.kind == 'position') then
        drive_toward_position(movement.target_x, movement.target_y);
    end
    if (memory:GetAutoFollow():GetIsAutoRunning() == 0) then
        stop_movement('client_stopped');
    end
end

local function validate_command(command)
    if (type(command) ~= 'string') then
        error('Command must be a string.');
    end

    command = command:match('^%s*(.-)%s*$');
    if (#command == 0 or #command > 200) then
        error('Command must contain between 1 and 200 characters.');
    end
    if (command:find('[\r\n;|]') ~= nil or command:sub(1, 1) == '!') then
        error('Command chaining, control characters, and GM commands are blocked.');
    end

    local verb = command:match('^(%S+)');
    if (verb == nil or allowed_commands[verb:lower()] ~= true) then
        error('Command is outside the AgentBridge gameplay allowlist.');
    end
    return command;
end

local function start_roe_objective(params)
    require_control_enabled();
    if (params.confirmation ~= 'START PRIVATE SERVER ROE OBJECTIVE') then
        error('Starting a RoE objective requires the exact private-server confirmation phrase.');
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    if (player:GetLoginStatus() ~= 2) then
        error('Cannot start a RoE objective until a character is logged in.');
    end
    if (player:GetIsZoning() ~= 0) then
        error('Cannot start a RoE objective while zoning.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Cannot start a RoE objective while an in-game menu or dialogue is open.');
    end

    local objective_id = tonumber(params.objective_id);
    if (
        objective_id == nil or objective_id ~= math.floor(objective_id) or
        objective_id < 1 or objective_id > 4095
    ) then
        error('RoE objective_id must be an integer from 1 through 4095.');
    end

    stop_movement('roe_objective');
    stop_heading_hold('roe_objective');
    local packet =
    {
        0x0C, 0x05, 0x00, 0x00,
        objective_id % 0x0100,
        math.floor(objective_id / 0x0100),
        0x00, 0x00,
    };
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x10C, packet);
    add_event(-1, ('Agent requested RoE objective %d.'):fmt(objective_id));
    return
    {
        queued = true,
        objective_id = objective_id,
        packet_id = 0x10C,
        normal_client_packet = true,
    };
end

local function change_job(params)
    require_control_enabled();
    if (params.confirmation ~= 'CHANGE PRIVATE SERVER JOB') then
        error('Job change requires the exact private-server confirmation phrase.');
    end

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    local entities = memory:GetEntity();
    if (player:GetLoginStatus() ~= 2) then
        error('Job change requires a logged-in private-server character.');
    end
    if (player:GetIsZoning() ~= 0) then
        error('Job change is unavailable while zoning.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Job change requires all in-game menus and dialogue to be closed.');
    end

    local slot = type(params.slot) == 'string' and params.slot:lower() or '';
    if (slot ~= 'main' and slot ~= 'sub') then
        error('Job change slot must be main or sub.');
    end
    local job_id = tonumber(params.job_id);
    if (
        job_id == nil or job_id ~= math.floor(job_id) or
        job_id < 1 or job_id > 22
    ) then
        error('Job change job_id must be an integer from 1 through 22.');
    end
    if (
        (slot == 'main' and tonumber(player:GetSubJob()) == job_id) or
        (slot == 'sub' and tonumber(player:GetMainJob()) == job_id)
    ) then
        error('The requested job conflicts with the other active job slot.');
    end

    local nearby_moogle = nil;
    for index = 0, entities:GetEntityMapSize() - 1 do
        local name = entities:GetName(index) or '';
        local distance_squared = math.max(0, entities:GetDistance(index));
        if (
            entities:GetServerId(index) > 0 and
            distance_squared <= 36 and
            job_change_npc_names[name] == true
        ) then
            nearby_moogle = entity_snapshot(index, entities);
            break;
        end
    end
    if (nearby_moogle == nil) then
        error('Job change requires a recognized Moogle within six yalms.');
    end

    stop_movement('job_change');
    stop_input_pulse('job_change');
    stop_heading_hold('job_change');
    target:SetTarget(0, true);

    -- Normal FFXI outgoing job-change packet 0x100. Offset 0x04 is the
    -- requested main job and 0x05 is the requested support job; zero leaves
    -- the other slot unchanged.
    local packet =
    {
        0x00, 0x05, 0x00, 0x00,
        slot == 'main' and job_id or 0x00,
        slot == 'sub' and job_id or 0x00,
        0x00, 0x00,
    };
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x100, packet);
    add_event(
        -1,
        ('Agent requested %s job %u near %s.'):fmt(
            slot,
            job_id,
            nearby_moogle.name
        )
    );
    return
    {
        queued = true,
        slot = slot,
        job_id = job_id,
        moogle = nearby_moogle,
        packet_id = 0x100,
        normal_client_packet = true,
    };
end

local function move_inventory_item(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    local inventory = memory:GetInventory();
    if (player:GetLoginStatus() ~= 2) then
        error('Item transfer requires a logged-in private-server character.');
    end
    if (player:GetIsZoning() ~= 0) then
        error('Item transfer is unavailable while zoning.');
    end
    if (target:GetIsMenuOpen() ~= 0) then
        error('Item transfer requires all in-game menus and dialogue to be closed.');
    end
    if (params.confirmation ~= 'MOVE PRIVATE SERVER INVENTORY ITEM') then
        error('Item transfer requires the exact private-server confirmation phrase.');
    end

    local allowed_containers =
    {
        [0] = true, -- Inventory
        [6] = true, -- Mog Sack
        [7] = true, -- Mog Case
        [8] = true, -- Mog Wardrobe
        [9] = true, -- Mog Safe 2
    };
    local source_container = tonumber(params.source_container);
    local destination_container = tonumber(params.destination_container);
    local source_slot = tonumber(params.source_slot);
    local item_id = tonumber(params.item_id);
    local quantity = tonumber(params.quantity);
    if (
        source_container == nil or source_container ~= math.floor(source_container) or
        destination_container == nil or destination_container ~= math.floor(destination_container) or
        not allowed_containers[source_container] or
        not allowed_containers[destination_container] or
        source_container == destination_container
    ) then
        error('Item transfer containers must be different allowlisted container IDs.');
    end
    if (
        source_slot == nil or source_slot ~= math.floor(source_slot) or
        source_slot < 1 or source_slot > 80
    ) then
        error('Item transfer source_slot must be an integer from 1 through 80.');
    end
    if (
        item_id == nil or item_id ~= math.floor(item_id) or
        item_id < 1 or item_id > 65534
    ) then
        error('Item transfer item_id must be an integer from 1 through 65534.');
    end
    if (
        quantity == nil or quantity ~= math.floor(quantity) or
        quantity < 1 or quantity > 999999
    ) then
        error('Item transfer quantity must be an integer from 1 through 999999.');
    end

    local source_item = inventory:GetContainerItem(source_container, source_slot);
    if (
        source_item == nil or
        tonumber(source_item.Id) ~= item_id or
        (tonumber(source_item.Count) or 0) < quantity
    ) then
        error('The exact source slot, item ID, and quantity are no longer available.');
    end
    for equipment_slot = 0, 15 do
        local equipment_entry = inventory:GetEquippedItem(equipment_slot);
        local packed_index = equipment_entry ~= nil and tonumber(equipment_entry.Index) or 0;
        if (
            packed_index > 0 and
            bit.band(packed_index, 0xFF00) / 0x0100 == source_container and
            packed_index % 0x0100 == source_slot
        ) then
            error('Equipped items must be unequipped before an item transfer.');
        end
    end

    local destination_capacity =
        tonumber(inventory:GetContainerCountMax(destination_container)) or 0;
    if (destination_capacity <= 0) then
        error('The destination container is not unlocked.');
    end

    stop_movement('item_transfer');
    stop_input_pulse('item_transfer');
    stop_heading_hold('item_transfer');

    -- LandSandBoat GP_CLI_COMMAND_ITEM_MOVE (0x029):
    -- uint32 quantity, uint8 source container, uint8 destination container,
    -- uint8 source slot, uint8 destination slot (0xFF selects a free slot).
    local packet =
    {
        0x29, 0x06, 0x00, 0x00,
        quantity % 0x0100,
        math.floor(quantity / 0x0100) % 0x0100,
        math.floor(quantity / 0x010000) % 0x0100,
        math.floor(quantity / 0x01000000) % 0x0100,
        source_container,
        destination_container,
        source_slot,
        0xFF,
    };
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x029, packet);
    add_event(
        -1,
        ('Agent moved exact item %u x%u from container %u to %u.'):fmt(
            item_id,
            quantity,
            source_container,
            destination_container
        )
    );
    return
    {
        queued = true,
        item_id = item_id,
        quantity = quantity,
        source_container = source_container,
        source_slot = source_slot,
        destination_container = destination_container,
        packet_id = 0x029,
        normal_client_packet = true,
    };
end

local function sell_inventory_item(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local inventory = memory:GetInventory();
    if (player:GetLoginStatus() ~= 2) then
        error('Inventory sale requires a logged-in private-server character.');
    end
    if (player:GetIsZoning() ~= 0) then
        error('Inventory sale is unavailable while zoning.');
    end
    if (params.confirmation ~= 'SELL PRIVATE SERVER INVENTORY ITEM') then
        error('Inventory sale requires the exact private-server confirmation phrase.');
    end

    local source_slot = tonumber(params.source_slot);
    local item_id = tonumber(params.item_id);
    local quantity = tonumber(params.quantity);
    if (
        source_slot == nil or source_slot ~= math.floor(source_slot) or
        source_slot < 1 or source_slot > 80
    ) then
        error('Inventory sale source_slot must be an integer from 1 through 80.');
    end
    if (
        item_id == nil or item_id ~= math.floor(item_id) or
        item_id < 1 or item_id > 65534 or
        allowed_npc_sale_items[item_id] ~= true
    ) then
        error('Inventory sale item_id is outside the repository-controlled allowlist.');
    end
    if (
        quantity == nil or quantity ~= math.floor(quantity) or
        quantity < 1 or quantity > 99
    ) then
        error('Inventory sale quantity must be an integer from 1 through 99.');
    end

    local source_item = inventory:GetContainerItem(0, source_slot);
    if (
        source_item == nil or
        tonumber(source_item.Id) ~= item_id or
        (tonumber(source_item.Count) or 0) < quantity
    ) then
        error('The exact inventory slot, item ID, and quantity are no longer available.');
    end
    for equipment_slot = 0, 15 do
        local equipment_entry = inventory:GetEquippedItem(equipment_slot);
        local packed_index = equipment_entry ~= nil and tonumber(equipment_entry.Index) or 0;
        if (
            packed_index > 0 and
            bit.band(packed_index, 0xFF00) / 0x0100 == 0 and
            packed_index % 0x0100 == source_slot
        ) then
            error('Equipped items cannot be sold.');
        end
    end

    stop_movement('inventory_sale');
    stop_input_pulse('inventory_sale');
    stop_heading_hold('inventory_sale');

    -- Normal FFXI NPC-sale request (0x084) followed by its affirmative
    -- confirmation (0x085). LandSandBoat rechecks the slot, item ID, quantity,
    -- NoSale/locked/reserved state, packet ordering, and stack bounds.
    local request_packet =
    {
        0x84, 0x06, 0x00, 0x00,
        quantity, 0x00, 0x00, 0x00,
        item_id % 0x0100,
        math.floor(item_id / 0x0100),
        source_slot,
        0x00,
    };
    local confirm_packet =
    {
        0x85, 0x04, 0x00, 0x00,
        0x01, 0x00, 0x00, 0x00,
    };
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x084, request_packet);
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x085, confirm_packet);
    add_event(
        -1,
        ('Agent sold allowlisted inventory item %u x%u.'):fmt(
            item_id,
            quantity
        )
    );
    return
    {
        queued = true,
        source_container = 0,
        source_slot = source_slot,
        item_id = item_id,
        quantity = quantity,
        request_packet_id = 0x084,
        confirmation_packet_id = 0x085,
        normal_client_packets = true,
    };
end

local function buy_vendor_item(params)
    require_control_enabled();

    local memory = AshitaCore:GetMemoryManager();
    local player = memory:GetPlayer();
    local target = memory:GetTarget();
    local inventory = memory:GetInventory();
    if (player:GetLoginStatus() ~= 2) then
        error('Vendor purchase requires a logged-in private-server character.');
    end
    if (player:GetIsZoning() ~= 0) then
        error('Vendor purchase is unavailable while zoning.');
    end
    if (params.confirmation ~= 'BUY PRIVATE SERVER VENDOR ITEM') then
        error('Vendor purchase requires the exact private-server confirmation phrase.');
    end
    if (target:GetIsMenuOpen() == 0 or current_menu_name() ~= 'menu    shopmain') then
        error('Vendor purchase requires an active general-shop merchant context.');
    end

    local npc_server_id = tonumber(params.npc_server_id);
    local item_id = tonumber(params.item_id);
    local maximum_price = tonumber(params.maximum_price);
    local quantity = tonumber(params.quantity);
    local npc_catalog = allowed_vendor_purchases[npc_server_id];
    local purchase_allowed = npc_catalog ~= nil and npc_catalog[item_id] == true;
    local purchase = bridge.merchant_catalog[item_id];
    if (
        npc_server_id == nil or npc_server_id ~= math.floor(npc_server_id) or
        not purchase_allowed or purchase == nil
    ) then
        error('Vendor purchase is not present in both the allowlist and live merchant catalog.');
    end
    if (
        maximum_price == nil or maximum_price ~= math.floor(maximum_price) or
        maximum_price < purchase.unit_price or
        quantity == nil or quantity ~= 1
    ) then
        error('Vendor purchase exceeds the caller price cap or has an invalid quantity.');
    end

    if (tonumber(bridge.merchant_context_server_id) ~= npc_server_id) then
        error('The exact allowlisted merchant did not establish this shop context.');
    end
    local gil = inventory:GetContainerItem(0, 0);
    if (gil == nil or (tonumber(gil.Count) or 0) < purchase.unit_price) then
        error('The exact vendor purchase is unaffordable.');
    end
    local inventory_capacity = tonumber(inventory:GetContainerCountMax(0)) or 0;
    local inventory_count = tonumber(inventory:GetContainerCount(0)) or 0;
    if (inventory_capacity <= 0 or inventory_count >= inventory_capacity) then
        error('The main inventory has no free slot for the vendor purchase.');
    end

    stop_movement('vendor_purchase');
    stop_input_pulse('vendor_purchase');
    stop_heading_hold('vendor_purchase');

    -- LandSandBoat GP_CLI_COMMAND_SHOP_BUY (0x083):
    -- uint32 quantity, uint16 shop number, uint16 merchant-container index,
    -- uint8 property-item index, then three padding bytes. The live server
    -- resolves the item and authoritative price from its merchant container.
    local shop_index = purchase.shop_index;
    local packet =
    {
        0x83, 0x04, 0x00, 0x00,
        quantity, 0x00, 0x00, 0x00,
        0x00, 0x00,
        shop_index % 0x0100,
        math.floor(shop_index / 0x0100) % 0x0100,
        0x00, 0x00, 0x00, 0x00,
    };
    AshitaCore:GetPacketManager():AddOutgoingPacket(0x083, packet);
    add_event(
        -1,
        ('Agent requested exact vendor item %u x1 from NPC %u.'):fmt(
            item_id,
            npc_server_id
        )
    );
    return
    {
        queued = true,
        item_id = item_id,
        quantity = quantity,
        npc_server_id = npc_server_id,
        shop_item_index = shop_index,
        unit_price = purchase.unit_price,
        maximum_price = maximum_price,
        packet_id = 0x083,
        normal_client_packet = true,
    };
end

local function dispatch(request)
    if (type(request) ~= 'table') then
        error('Request must be a JSON object.');
    end
    if (request.token ~= bridge.config.token) then
        error('Authentication failed.');
    end

    local params = type(request.params) == 'table' and request.params or {};
    if (request.operation == 'control_status') then
        return control_snapshot();
    elseif (request.operation == 'enable_control') then
        if (params.confirmation ~= 'ENABLE PRIVATE SERVER CONTROL') then
            error('Enabling control requires the exact confirmation phrase.');
        end
        if (AshitaCore:GetMemoryManager():GetPlayer():GetLoginStatus() ~= 2) then
            error('Cannot enable agent writes until a character is logged in.');
        end
        bridge.control_enabled = true;
        bridge.control_changed_at = os.time();
        bridge.control_reason = 'explicit_enable';
        add_event(-1, 'Agent control explicitly enabled.');
        return control_snapshot();
    elseif (request.operation == 'emergency_stop') then
        emergency_stop('emergency_stop');
        return control_snapshot();
    elseif (request.operation == 'set_activity_feed') then
        require_control_enabled();
        if (type(params.enabled) ~= 'boolean') then
            error('Activity feed enabled must be true or false.');
        end
        bridge.activity_feed_enabled = params.enabled;
        local state = params.enabled and 'enabled' or 'disabled';
        if (params.enabled) then
            add_event(-1, ('Agent activity feed %s.'):fmt(state));
        else
            print('[Agent Activity] feed disabled.');
            bridge.activity_lines = T{};
            if (bridge.activity_font ~= nil) then
                bridge.activity_font.text = '';
            end
            add_event(-1, ('Agent activity feed %s.'):fmt(state));
        end
        return
        {
            enabled = bridge.activity_feed_enabled,
            local_chat_only = true,
            stream_overlay = true,
            activity_overlay = activity_overlay_snapshot(),
            control = control_snapshot(),
        };
    elseif (request.operation == 'set_goal_overlay') then
        require_control_enabled();
        if (type(params.enabled) ~= 'boolean') then
            error('Goal overlay enabled must be true or false.');
        end
        local current_gil = tonumber(params.current_gil);
        local target_gil = tonumber(params.target_gil);
        local title = params.title;
        local progress_label = params.progress_label;
        if (
            current_gil == nil or current_gil ~= math.floor(current_gil) or
            current_gil < 0 or current_gil > 999999999
        ) then
            error('Goal overlay current_gil must be an integer between 0 and 999999999.');
        end
        if (
            target_gil == nil or target_gil ~= math.floor(target_gil) or
            target_gil < 1 or target_gil > 999999999
        ) then
            error('Goal overlay target_gil must be an integer between 1 and 999999999.');
        end
        if ((title == nil) ~= (progress_label == nil)) then
            error('Goal overlay title and progress_label must be provided together.');
        end
        if (title ~= nil) then
            if (
                type(title) ~= 'string' or #title < 1 or #title > 96 or
                title:find('[\r\n]') ~= nil
            ) then
                error('Goal overlay title must be a single-line string from 1 through 96 bytes.');
            end
            if (
                type(progress_label) ~= 'string' or #progress_label < 1 or
                #progress_label > 128 or progress_label:find('[\r\n]') ~= nil
            ) then
                error('Goal overlay progress_label must be a single-line string from 1 through 128 bytes.');
            end
        end
        bridge.goal_overlay_enabled = params.enabled;
        bridge.goal_current_gil = current_gil;
        bridge.goal_target_gil = target_gil;
        bridge.goal_title = title;
        bridge.goal_progress_label = progress_label;
        refresh_goal_overlay();
        add_event(
            -1,
            title ~= nil and
                ('Agent goal overlay %s: %s.'):fmt(
                    params.enabled and 'enabled' or 'disabled',
                    title
                ) or
                ('Agent gil goal overlay %s at %s of %s.'):fmt(
                    params.enabled and 'enabled' or 'disabled',
                    format_integer(current_gil),
                    format_integer(target_gil)
                )
        );
        return
        {
            enabled = bridge.goal_overlay_enabled,
            current_gil = bridge.goal_current_gil,
            target_gil = bridge.goal_target_gil,
            title = bridge.goal_title,
            progress_label = bridge.goal_progress_label,
            local_overlay_only = true,
            goal_overlay = goal_overlay_snapshot(),
            control = control_snapshot(),
        };
    elseif (request.operation == 'stop_movement') then
        stop_movement('requested');
        return control_snapshot();
    elseif (request.operation == 'observe') then
        return observe(params);
    elseif (request.operation == 'character_state') then
        return character_state(params);
    elseif (request.operation == 'recent_events') then
        return recent_events(params.limit);
    elseif (request.operation == 'target_entity') then
        require_control_enabled();
        return find_target(params);
    elseif (request.operation == 'clear_target') then
        return clear_target();
    elseif (request.operation == 'set_heading') then
        return set_heading(params);
    elseif (request.operation == 'interact') then
        return start_confirm_pulse(params);
    elseif (request.operation == 'input_action') then
        return start_input_pulse(params);
    elseif (request.operation == 'menu_input') then
        return start_menu_pulse(params);
    elseif (request.operation == 'move_to_entity') then
        return start_movement(params);
    elseif (request.operation == 'move_to_position') then
        return start_position_movement(params);
    elseif (request.operation == 'service_teleport') then
        return service_teleport(params);
    elseif (request.operation == 'private_server_bastok_mission') then
        return private_server_bastok_mission(params);
    elseif (request.operation == 'start_roe_objective') then
        return start_roe_objective(params);
    elseif (request.operation == 'change_job') then
        return change_job(params);
    elseif (request.operation == 'move_inventory_item') then
        return move_inventory_item(params);
    elseif (request.operation == 'sell_inventory_item') then
        return sell_inventory_item(params);
    elseif (request.operation == 'buy_vendor_item') then
        return buy_vendor_item(params);
    elseif (request.operation == 'gameplay_command') then
        require_control_enabled();
        local command = validate_command(params.command);
        AshitaCore:GetChatManager():QueueCommand(1, command);
        local verb = command:match('^(%S+)') or 'gameplay command';
        add_event(-1, ('Agent gameplay command queued: %s.'):fmt(verb:lower()));
        return
        {
            queued = true,
            command = command,
        };
    end

    error('Unknown operation.');
end

local function respond(request)
    local response =
    {
        id = type(request) == 'table' and request.id or nil,
        ok = false,
    };

    local ok, value = pcall(dispatch, request);
    if (ok) then
        response.ok = true;
        response.result = value;
    else
        response.error = tostring(value);
    end

    bridge.client:settimeout(0.1);
    bridge.client:send(json.encode(response) .. '\n');
    close_client();
end

local function process_client()
    if (bridge.client == nil) then
        local client = bridge.listener:accept();
        if (client ~= nil) then
            bridge.client = client;
            bridge.client:settimeout(0);
            bridge.client_buffer = '';
        end
        return;
    end

    local chunk, receive_error, partial = bridge.client:receive(4096);
    local received = chunk or partial;
    if (received ~= nil and #received > 0) then
        bridge.client_buffer = bridge.client_buffer .. received;
    end

    if (#bridge.client_buffer > 16384) then
        close_client();
        return;
    end

    local newline = bridge.client_buffer:find('\n', 1, true);
    if (newline ~= nil) then
        local line = bridge.client_buffer:sub(1, newline - 1);
        local ok, request = pcall(json.decode, line);
        if (not ok) then
            request = {};
        end
        respond(request);
        return;
    end

    if (receive_error == 'closed') then
        close_client();
    end
end

ashita.events.register('load', 'load_cb', function ()
    bridge.config = read_config();
    if (bridge.config == nil) then
        return;
    end

    bridge.control_enabled = false;
    bridge.control_changed_at = os.time();
    bridge.control_reason = 'addon_load';
    bridge.activity_feed_enabled = bridge.config.activity_feed_enabled == true;
    bridge.activity_lines = T{};
    bridge.activity_font = fonts.new(
    {
        visible = true,
        font_family = 'Arial',
        font_height = 16,
        color = 0xFFFFFFFF,
        position_x = bridge.config.overlay_position_x or 1400,
        position_y = bridge.config.activity_overlay_position_y or 1230,
        background =
        {
            visible = true,
            color = 0xB0000000,
        },
    });
    bridge.goal_font = fonts.new(
    {
        visible = false,
        font_family = 'Arial',
        font_height = 18,
        color = 0xFFFFD966,
        position_x = bridge.config.overlay_position_x or 1400,
        position_y = bridge.config.goal_overlay_position_y or 1160,
        background =
        {
            visible = true,
            color = 0xC0000000,
        },
    });
    refresh_goal_overlay();

    local listener, listen_error = socket.bind(bridge.config.bind_host, bridge.config.bind_port);
    if (listener == nil) then
        print(('[AgentBridge] Failed to listen: %s'):fmt(tostring(listen_error)));
        return;
    end

    bridge.listener = listener;
    bridge.listener:settimeout(0);
    print(('[AgentBridge] Listening on %s:%u with writes disabled.'):fmt(bridge.config.bind_host, bridge.config.bind_port));
    if (bridge.activity_feed_enabled) then
        print('[Agent Activity] feed enabled from config.');
    end
end);

ashita.events.register('unload', 'unload_cb', function ()
    emergency_stop('addon_unload');
    if (bridge.activity_font ~= nil) then
        bridge.activity_font:destroy();
        bridge.activity_font = nil;
    end
    if (bridge.goal_font ~= nil) then
        bridge.goal_font:destroy();
        bridge.goal_font = nil;
    end
    stop_listener();
end);

ashita.events.register('text_in', 'text_in_cb', function (event)
    add_event(event.mode, event.message_modified);
end);

ashita.events.register('packet_in', 'merchant_catalog_packet_in_cb', function (event)
    if (event.id ~= 0x03C or type(event.data) ~= 'string' or event.size < 8) then
        return;
    end

    local item_offset = struct.unpack('H', event.data, 0x04 + 1);
    if (item_offset == 0) then
        bridge.merchant_catalog = {};
    end
    local entry_count = math.floor((event.size - 8) / 12);
    entry_count = math.clamp(entry_count, 0, 19);
    for entry = 0, entry_count - 1 do
        local base = 0x08 + (entry * 12);
        local unit_price = struct.unpack('L', event.data, base + 1);
        local item_id = struct.unpack('H', event.data, base + 0x04 + 1);
        local shop_index = struct.unpack('B', event.data, base + 0x06 + 1);
        if (item_id > 0 and unit_price > 0) then
            bridge.merchant_catalog[item_id] =
            {
                shop_index = shop_index,
                unit_price = unit_price,
            };
        end
    end
end);

ashita.events.register('key_state', 'key_state_cb', function (event)
    local pulse = bridge.input_pulse;
    if (pulse == nil) then
        return;
    end

    local memory = AshitaCore:GetMemoryManager();
    if (not bridge.control_enabled or memory:GetPlayer():GetLoginStatus() ~= 2) then
        stop_input_pulse('control_disabled_or_logged_out');
        return;
    end
    local pulse_keys = { pulse.key };
    if (pulse.modifier_keys ~= nil) then
        for _, modifier_key in ipairs(pulse.modifier_keys) do
            pulse_keys[#pulse_keys + 1] = modifier_key;
        end
    end
    if (event.data_raw == nil) then
        stop_input_pulse('keyboard_state_unavailable');
        return;
    end
    for _, pulse_key in ipairs(pulse_keys) do
        if (event.size <= pulse_key) then
            stop_input_pulse('keyboard_state_unavailable');
            return;
        end
    end

    local keys = ffi.cast('uint8_t*', event.data_raw);
    if (pulse.down_frames > 0 or socket.gettime() < pulse.deadline) then
        for _, pulse_key in ipairs(pulse_keys) do
            keys[pulse_key] = 0x80;
        end
        pulse.down_frames = math.max(0, pulse.down_frames - 1);
        return;
    end

    for _, pulse_key in ipairs(pulse_keys) do
        keys[pulse_key] = 0;
    end
    pulse.release_frames = pulse.release_frames - 1;
    if (pulse.release_frames <= 0) then
        add_event(-1, ('Agent %s pulse completed.'):fmt(pulse.action));
        bridge.input_pulse = nil;
    end
end);

ashita.events.register('d3d_present', 'present_cb', function ()
    apply_heading_hold();
    monitor_movement();
    if (bridge.listener ~= nil) then
        process_client();
    end
end);
