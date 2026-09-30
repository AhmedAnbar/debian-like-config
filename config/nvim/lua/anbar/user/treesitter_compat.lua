local M = {}

function M.setup()
  if vim.fn.has("nvim-0.12") == 0 then return end
  -- The pinned master plugin registers handlers with all=false. Neovim 0.12
  -- removed that option: captures are always TSNode[] now. Adapt only this
  -- legacy module's registrations, leaving Neovim's global API untouched.
  local query = vim.treesitter.query
  local proxy = setmetatable({}, { __index = query })
  for _, method in ipairs({ "add_predicate", "add_directive" }) do
    proxy[method] = function(name, handler, opts)
      if type(opts) == "table" and opts.all == false then
        local legacy_handler = handler
        handler = function(match, ...)
          local single = {}
          for id, nodes in pairs(match) do
            single[id] = type(nodes) == "table" and nodes[#nodes] or nodes
          end
          return legacy_handler(single, ...)
        end
      end
      return query[method](name, handler, { force = true })
    end
  end
  local file = vim.api.nvim_get_runtime_file(
    "lua/nvim-treesitter/query_predicates.lua", false
  )[1]
  assert(file, "Legacy Tree-sitter query module not found")
  local chunk = assert(loadfile(file))
  local env = setmetatable({
    require = function(name)
      if name == "vim.treesitter.query" then return proxy end
      return require(name)
    end,
  }, { __index = _G })
  setfenv(chunk, env)()
end

return M
