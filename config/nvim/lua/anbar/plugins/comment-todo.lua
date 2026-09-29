return {
  "folke/todo-comments.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  event = "VeryLazy",
  opts = {
    -- your configuration comes here
    -- or leave it empty to use the default settings
    -- refer to the configuration section below
    keywords = {
      FIX = {
        icon = " ", -- icon used for the sign, and in search results
        color = "error", -- can be a hex color, or a named color (see below)
        alt = { "FIXME", "BUG", "FIXIT", "ISSUE" }, -- a set of other keywords that all map to this FIX keywords
        -- signs = false, -- configure signs for some keywords individually
      },
      TODO = { icon = " ", color = "todo" },
      HACK = { icon = " ", color = "error" },
      WARN = { icon = " ", color = "warning" },
      PERF = { icon = " ", color = "default" },
      NOTE = { icon = "󰋇 ", color = "hint" },
      TEST = { icon = "⏲ ", color = "test" },
      TEST2 = { icon = "⏲ ", color = "test2" },
      BUG = { icon = " ", color = "danger" },
      FUNC = { icon = " ", color = "func" },
      INFO = { icon = " ", color = "info" },
      COMM = { icon = " ", color = "comment" },
    },
    colors = {
      todo = { "#a4043f" },
      error = { "#DC2626" },
      warning = { "#FBBF24" },
      info = { "#2563EB" },
      hint = { "#10B981" },
      default = { "#7C3AED" },
      test = { "#FF00FF" },
      test2 = { "#be91ff" },
      func = { "#1988a8" },
      danger = { "#ff0000" },
      comment = { "#7C3AED" },
    },
  },
  keys = {
    {
      "[t",
      "<cmd>lua require('todo-comments').jump_prev()<CR>",
      desc = "Previous todo comment",
    },
    {
      "]t",
      "<cmd>lua require('todo-comments').jump_next()<CR>",
      desc = "Next todo comment",
    },
  },
}
-- COMM: TEST COMMENT
-- TODO: TEST TODO
-- INFO: TEST INFO
-- HACK: TEST HACK
-- PERF: TEST PERF
-- WARN: TEST WARN
-- NOTE: TEST NOTE
-- TEST: TEST TEST
-- BUG: TEST BUG
-- FUNC: TEST FUNC
-- TEST2:
