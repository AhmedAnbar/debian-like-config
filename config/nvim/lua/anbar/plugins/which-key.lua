return {
  "folke/which-key.nvim",
  event = "VeryLazy",
  opts = { preset = "modern", delay = 300 },
  keys = {
    { "<leader>?", "<cmd>Telescope keymaps<cr>", desc = "Search all keymaps" },
    { "<leader><space>", function() require("which-key").show({ global = true }) end,
      desc = "Show keymap groups" },
  },
}
