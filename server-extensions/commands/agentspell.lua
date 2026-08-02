-----------------------------------
-- Proximity-gated private-server spell shop for the FFXI Agent Lab.
--
-- This removes only merchant-menu navigation. It is self-only, permits two
-- exact RDM leveling spells, requires the normal vendor within six yalms, and
-- preserves that vendor's normal gil prices and job-level requirements.
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = 'ss',
}

local maximumDistance = 6
local shohrunTuhrun =
{
    zone = xi.zone.WINDURST_WATERS,
    id = 17752095,
    name = 'Shohrun-Tuhrun',
}

local allowedSpells =
{
    [xi.magic.spell.DIA_II] =
    {
        gilCost = 11648,
        minimumRdmLevel = 31,
        vendor = shohrunTuhrun,
    },
    [xi.magic.spell.ENTHUNDER] =
    {
        gilCost = 1575,
        minimumRdmLevel = 16,
        vendor = shohrunTuhrun,
    },
    -- Exact, level-gated private-server convenience grants. These restore the
    -- core RDM utility spellbook without exposing arbitrary !addspell input.
    -- They intentionally bypass scroll acquisition on this local learning
    -- server; the command remains self-only and rejects ineligible levels.
    [xi.magic.spell.CURE_II] = { minimumRdmLevel = 14, grantable = true },
    [xi.magic.spell.CURE_III] = { minimumRdmLevel = 26, grantable = true },
    [xi.magic.spell.RAISE] = { minimumRdmLevel = 38, grantable = true },
    [xi.magic.spell.SLOW] = { minimumRdmLevel = 13, grantable = true },
    [xi.magic.spell.HASTE] = { minimumRdmLevel = 48, grantable = true },
    [xi.magic.spell.PARALYZE] = { minimumRdmLevel = 6, grantable = true },
    [xi.magic.spell.SILENCE] = { minimumRdmLevel = 18, grantable = true },
    [xi.magic.spell.REGEN] = { minimumRdmLevel = 21, grantable = true },
    [xi.magic.spell.REFRESH] = { minimumRdmLevel = 41, grantable = true },
    [xi.magic.spell.GRAVITY] = { minimumRdmLevel = 21, grantable = true },
    [xi.magic.spell.SLEEP] = { minimumRdmLevel = 25, grantable = true },
    [xi.magic.spell.SLEEP_II] = { minimumRdmLevel = 46, grantable = true },
    [xi.magic.spell.DISPEL] = { minimumRdmLevel = 32, grantable = true },
}

local function report(player, message)
    player:printToPlayer(string.format('[AgentSpell] %s', message))
end

local function nearbyVendor(player, vendor)
    if player:getZoneID() ~= vendor.zone then
        return false, string.format('requires %s in zone=%u', vendor.name, vendor.zone)
    end

    local npc = GetNPCByID(vendor.id)
    if npc == nil then
        return false, string.format('%s is unavailable', vendor.name)
    end

    local distance = player:checkDistance(npc)
    if distance > maximumDistance then
        return false, string.format('%s distance=%.2f exceeds %u', vendor.name, distance, maximumDistance)
    end

    return true, distance
end

local function status(player, spellId, config)
    report(player, string.format(
        'status spell=%u learned=%u gil=%u rdm_level=%u',
        spellId,
        player:hasSpell(spellId) and 1 or 0,
        player:getGil(),
        player:getMainJob() == xi.job.RDM and player:getMainLvl() or 0
    ))
end

local function buy(player, spellId, config)
    if config.vendor == nil or config.gilCost == nil then
        return false, 'spell is not available through the proximity-gated vendor action'
    end
    local nearby, detail = nearbyVendor(player, config.vendor)
    if not nearby then
        return false, detail
    end
    if player:getMainJob() ~= xi.job.RDM or player:getMainLvl() < config.minimumRdmLevel then
        return false, string.format('requires RDM level %u', config.minimumRdmLevel)
    end
    if player:hasSpell(spellId) then
        return false, 'spell is already learned; no gil was charged'
    end

    local beforeGil = player:getGil()
    if beforeGil < config.gilCost then
        return false, string.format('insufficient gil have=%u need=%u', beforeGil, config.gilCost)
    end

    player:delGil(config.gilCost)
    if player:getGil() ~= beforeGil - config.gilCost then
        return false, 'exact gil charge failed; spell was not learned'
    end

    player:addSpell(spellId)
    if not player:hasSpell(spellId) then
        player:addGil(config.gilCost)
        return false, 'spell grant failed; gil was refunded'
    end

    report(player, string.format(
        'purchased spell=%u gil=%u vendor=%s distance=%.2f',
        spellId,
        config.gilCost,
        config.vendor.name,
        detail
    ))
    return true
end

local function grant(player, spellId, config)
    if not config.grantable then
        return false, 'spell is not available through the utility grant action'
    end
    if player:getMainJob() ~= xi.job.RDM or player:getMainLvl() < config.minimumRdmLevel then
        return false, string.format('requires RDM level %u', config.minimumRdmLevel)
    end
    if player:hasSpell(spellId) then
        report(player, string.format('already_learned spell=%u', spellId))
        return true
    end

    player:addSpell(spellId)
    if not player:hasSpell(spellId) then
        return false, 'spell grant failed'
    end

    report(player, string.format('granted spell=%u acquisition=private_server_utility', spellId))
    return true
end

commandObj.onTrigger = function(player, action, spellParam)
    action = string.lower(action or '')
    local spellId = tonumber(spellParam) or xi.magic.spell[string.upper(spellParam or '')]
    local config = spellId and allowedSpells[spellId] or nil
    if config == nil then
        report(player, 'rejected reason=spell is outside the exact allowlist')
        return
    end

    if action == 'status' then
        status(player, spellId, config)
        return
    end

    local accepted, reason
    if action == 'buy' then
        accepted, reason = buy(player, spellId, config)
    elseif action == 'grant' then
        accepted, reason = grant(player, spellId, config)
    else
        accepted, reason = false, 'action must be status, buy, or grant'
    end

    if not accepted then
        report(player, string.format('rejected action=%s spell=%u reason=%s', action, spellId, reason))
    end
    status(player, spellId, config)
end

return commandObj
