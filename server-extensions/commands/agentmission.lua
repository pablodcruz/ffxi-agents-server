-----------------------------------
-- Narrow private-server mission helper for the FFXI Agent Lab.
--
-- This command can inspect Bastok mission state and begin only the Rank 3
-- missions that lead to Rank 4. It deliberately cannot complete missions,
-- alter mission status, grant items, or set rank.
-----------------------------------
require('scripts/globals/missions')
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = 'sii',
}

local bastokLog = xi.mission.log_id.BASTOK
local allowedMissions =
{
    [xi.mission.id.bastok.THE_FOUR_MUSKETEERS] = true,
    [xi.mission.id.bastok.TO_THE_FORSAKEN_MINES] = true,
    [xi.mission.id.bastok.JEUNO] = true,
}
local allowedCrystals =
{
    [xi.item.FIRE_CRYSTAL] = 12,
    [xi.item.ICE_CRYSTAL] = 12,
    [xi.item.WIND_CRYSTAL] = 12,
    [xi.item.EARTH_CRYSTAL] = 12,
    [xi.item.LIGHTNING_CRYSTAL] = 12,
    [xi.item.WATER_CRYSTAL] = 12,
    [xi.item.LIGHT_CRYSTAL] = 16,
    [xi.item.DARK_CRYSTAL] = 16,
}

local function report(player, message)
    player:printToPlayer(string.format('[AgentMission] %s', message))
end

local function status(player)
    report(player, string.format(
        'nation=%u rank=%u rank_points=%u current=%u status=%u',
        player:getNation(),
        player:getRank(player:getNation()),
        player:getRankPoints(),
        player:getCurrentMission(bastokLog),
        player:getMissionStatus(bastokLog)
    ))
end

local function eligible(player, missionId)
    if player:getNation() ~= bastokLog then
        return false, 'character is not Bastokan'
    end

    if player:getRank(bastokLog) ~= 3 then
        return false, 'character is not Bastok Rank 3'
    end

    if player:getCurrentMission(bastokLog) ~= xi.mission.id.nation.NONE then
        return false, 'another Bastok mission is active'
    end

    if not allowedMissions[missionId] then
        return false, 'mission is outside the Rank 3 allowlist'
    end

    if not xi.mission.getMissionRankPoints(player, missionId) then
        return false, 'rank-point gate is not satisfied'
    end

    local fourMusketeers = xi.mission.id.bastok.THE_FOUR_MUSKETEERS
    if
        missionId ~= fourMusketeers and
        not player:hasCompletedMission(bastokLog, fourMusketeers)
    then
        return false, 'The Four Musketeers is not complete'
    end

    if
        missionId ~= xi.mission.id.bastok.TO_THE_FORSAKEN_MINES and
        player:hasCompletedMission(bastokLog, missionId)
    then
        return false, 'mission is already complete'
    end

    return true
end

local function donateCrystals(player, itemId, quantity)
    local crystalWorth = allowedCrystals[itemId]
    if crystalWorth == nil then
        return false, 'item is not an allowlisted elemental crystal'
    end

    if quantity == nil or quantity < 1 or quantity > 99 then
        return false, 'quantity must be from 1 through 99'
    end

    local rank = player:getRank(player:getNation())
    local rankPoints = player:getRankPoints()
    if player:getNation() ~= bastokLog or rank <= 1 or rankPoints >= 4000 then
        return false, 'character cannot receive Bastok rank points'
    end

    if player:getItemCount(itemId) < quantity then
        return false, 'character does not own the requested crystal quantity'
    end

    local pointsPerCrystal = math.floor(4000 / (rank * 12 - crystalWorth))
    local addPoints = pointsPerCrystal * quantity
    local appliedPoints = math.min(addPoints, 4000 - rankPoints)
    local excessPoints = math.max(0, addPoints - appliedPoints)

    player:delItem(itemId, quantity)
    player:addRankPoints(appliedPoints)
    if excessPoints > 0 then
        player:addCP(math.min(excessPoints, 1000))
    end

    report(player, string.format(
        'donated item=%u quantity=%u points=%u rank_points=%u',
        itemId,
        quantity,
        appliedPoints,
        player:getRankPoints()
    ))
    return true
end

commandObj.onTrigger = function(player, action, missionId, quantity)
    action = string.lower(action or '')
    if action == 'status' then
        status(player)
        return
    end

    if action == 'donate' then
        local donated, reason = donateCrystals(player, missionId, quantity)
        if not donated then
            report(player, string.format('rejected donation reason=%s', reason))
        end

        status(player)
        return
    end

    if action ~= 'begin' or missionId == nil then
        report(player, 'usage: !agentmission status | begin <10|11|12> | donate <item> <quantity>')
        return
    end

    local canBegin, reason = eligible(player, missionId)
    if not canBegin then
        report(player, string.format('rejected mission=%u reason=%s', missionId, reason))
        status(player)
        return
    end

    -- Mission:begin() delegates to this exact operation. All mission stages,
    -- rewards, completion, and status changes remain owned by normal handlers.
    player:addMission(bastokLog, missionId)
    report(player, string.format('began mission=%u', missionId))
    status(player)
end

return commandObj
