-----------------------------------
-- Self-only reload for repository-controlled commands that need live
-- allowlist updates without restarting xi_map.
--
-- This avoids restarting xi_map after an exact allowlist update and exposes
-- no caller-controlled module path or arbitrary Lua execution.
-----------------------------------

---@type TCommand
local commandObj = {}

commandObj.cmdprops =
{
    permission = 1,
    parameters = '',
}

commandObj.onTrigger = function(player)
    local modules =
    {
        { name = 'agentspell', path = 'scripts/commands/agentspell' },
        { name = 'agentshop', path = 'scripts/commands/agentshop' },
    }

    for _, module in ipairs(modules) do
        package.loaded[module.path] = nil
        local loaded, result = pcall(require, module.path)
        if not loaded then
            player:printToPlayer(string.format('[AgentReload] failed module=%s error=%s', module.name, result))
            return
        end
        player:printToPlayer(string.format('[AgentReload] reloaded module=%s', module.name))
    end
end

return commandObj
