-----------------------------------
-- Proximity-gated private-server shop helper for the FFXI Agent Lab.
--
-- This command removes menu navigation only. It is self-only, accepts a
-- narrow item/vendor allowlist, and preserves normal currency costs, weekly
-- exchange limits, inventory capacity, item ownership, and NPC sale value.
-----------------------------------
require('scripts/globals/npc_util')
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = 'sii',
}

local maximumDistance = 6
local isakoth = { zone = xi.zone.BASTOK_MARKETS, id = 17739953, name = 'Isakoth' }
local allowedItems =
{
    -- RDM level-30 checkpoint. These entries mirror the normal Isakoth
    -- Sparks catalog and only remove menu navigation.
    [15164] = { sparksCost =  80, purchaseVendor = isakoth }, -- Garish crown
    [14425] = { sparksCost = 265, purchaseVendor = isakoth }, -- Garish tunic
    [14857] = { sparksCost =  84, purchaseVendor = isakoth }, -- Garish mitts
    [14326] = { sparksCost = 190, purchaseVendor = isakoth }, -- Garish slacks
    [15314] = { sparksCost = 124, purchaseVendor = isakoth }, -- Garish pumps
    [xi.item.BROADSWORD] =
    {
        sparksCost = 334,
        purchaseVendor = isakoth,
    },
    [xi.item.IRON_SWORD] =
    {
        sparksCost = 132,
        purchaseVendor = isakoth,
    },
    [xi.item.ACHERON_SHIELD] =
    {
        sparksCost = 2755,
        purchaseVendor = isakoth,
        saleVendor = { zone = xi.zone.BASTOK_MARKETS, id = 17739803, name = 'Balthilda' },
    },
    [8711] =
    {
        voucherValue = 1000,
        exchangeVendor = isakoth,
    },
}

local function report(player, message)
    player:printToPlayer(string.format('[AgentShop] %s', message))
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

local function status(player, itemId, config)
    report(player, string.format(
        'status item=%u count=%u sparks=%u gil=%u free_slots=%u weekly_spent=%u',
        itemId,
        player:getItemCount(itemId),
        player:getCurrency('spark_of_eminence'),
        player:getGil(),
        player:getFreeSlotsCount(),
        player:getCharVar('weekly_sparks_spent')
    ))
end

local function exchangeVoucher(player, itemId, quantity, config)
    if quantity ~= 1 then
        return false, 'voucher exchange requires quantity=1'
    end

    local nearby, detail = nearbyVendor(player, config.exchangeVendor)
    if not nearby then
        return false, detail
    end

    local sparks = player:getCurrency('spark_of_eminence')
    if sparks + config.voucherValue > xi.settings.main.CAP_CURRENCY_SPARKS then
        return false, string.format('sparks cap would be exceeded have=%u add=%u', sparks, config.voucherValue)
    end

    local sourceContainer = nil
    for container = xi.inv.INVENTORY, xi.inv.WARDROBE8 do
        if player:hasItem(itemId, container) then
            sourceContainer = container
            break
        end
    end
    if sourceContainer == nil then
        return false, 'no Copper A.M.A.N. Voucher is available in an accessible container'
    end

    local beforeCount = player:getItemCount(itemId)
    if
        not player:delItem(itemId, 1, sourceContainer) or
        player:getItemCount(itemId) ~= beforeCount - 1
    then
        return false, 'exact voucher removal failed; Sparks were not added'
    end

    player:addCurrency('spark_of_eminence', config.voucherValue, xi.settings.main.CAP_CURRENCY_SPARKS)
    report(player, string.format(
        'exchanged item=%u quantity=1 sparks=%u vendor=%s distance=%.2f',
        itemId,
        config.voucherValue,
        config.exchangeVendor.name,
        detail
    ))
    return true
end

local function purchase(player, itemId, quantity, config)
    local nearby, detail = nearbyVendor(player, config.purchaseVendor)
    if not nearby then
        return false, detail
    end

    local cost = config.sparksCost * quantity
    local sparks = player:getCurrency('spark_of_eminence')
    local weeklySpent = player:getCharVar('weekly_sparks_spent')
    local remainingLimit = xi.settings.main.WEEKLY_EXCHANGE_LIMIT - weeklySpent
    if sparks < cost then
        return false, string.format('insufficient sparks have=%u need=%u', sparks, cost)
    end
    if xi.settings.main.ENABLE_EXCHANGE_LIMIT == 1 and cost > remainingLimit then
        return false, string.format('weekly exchange limit remaining=%u need=%u', remainingLimit, cost)
    end
    if player:getFreeSlotsCount() < quantity then
        return false, string.format('inventory headroom=%u need=%u', player:getFreeSlotsCount(), quantity)
    end

    if not npcUtil.giveItem(player, { { itemId, quantity } }) then
        return false, 'normal item grant rejected the purchase'
    end

    player:delCurrency('spark_of_eminence', cost)
    if xi.settings.main.ENABLE_EXCHANGE_LIMIT == 1 then
        player:setCharVar('weekly_sparks_spent', weeklySpent + cost)
    end
    report(player, string.format(
        'purchased item=%u quantity=%u cost=%u vendor=%s distance=%.2f',
        itemId,
        quantity,
        cost,
        config.purchaseVendor.name,
        detail
    ))
    return true
end

local function sell(player, itemId, quantity, config)
    if quantity ~= 1 then
        return false, 'non-stackable resale requires quantity=1'
    end
    local nearby, detail = nearbyVendor(player, config.saleVendor)
    if not nearby then
        return false, detail
    end
    if player:getItemCount(itemId) < quantity then
        return false, string.format('insufficient item count have=%u need=%u', player:getItemCount(itemId), quantity)
    end

    local item = GetItemByID(itemId)
    if item == nil or item:getBasePrice() <= 0 then
        return false, 'item has no normal NPC sale value'
    end
    local gil = item:getBasePrice() * quantity

    local beforeCount = player:getItemCount(itemId)
    if not player:delItem(itemId, quantity) or player:getItemCount(itemId) ~= beforeCount - quantity then
        return false, 'exact item removal failed; gil was not added'
    end
    player:addGil(gil)
    report(player, string.format(
        'sold item=%u quantity=%u gil=%u vendor=%s distance=%.2f',
        itemId,
        quantity,
        gil,
        config.saleVendor.name,
        detail
    ))
    return true
end

commandObj.onTrigger = function(player, action, itemId, quantity)
    action = string.lower(action or '')
    itemId = tonumber(itemId) or 0
    quantity = tonumber(quantity) or 1
    local config = allowedItems[itemId]

    if config == nil or quantity < 1 or quantity > 4 or quantity ~= math.floor(quantity) then
        report(player, 'rejected reason=item or quantity is outside the allowlist')
        return
    end

    if action == 'status' then
        status(player, itemId, config)
        return
    end

    local accepted, reason
    if action == 'buy' then
        if config.purchaseVendor == nil then
            accepted, reason = false, 'item is not allowlisted for purchase'
        else
            accepted, reason = purchase(player, itemId, quantity, config)
        end
    elseif action == 'sell' then
        if config.saleVendor == nil then
            accepted, reason = false, 'item is not allowlisted for resale'
        else
            accepted, reason = sell(player, itemId, quantity, config)
        end
    elseif action == 'voucher' then
        accepted, reason = exchangeVoucher(player, itemId, quantity, config)
    else
        accepted, reason = false, 'action must be status, buy, sell, or voucher'
    end

    if not accepted then
        report(player, string.format('rejected action=%s item=%u reason=%s', action, itemId, reason))
    end
    status(player, itemId, config)
end

return commandObj
