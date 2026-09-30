return {
  {
    "adalessa/laravel.nvim",
    dependencies = { "nvim-telescope/telescope.nvim", "MunifTanjim/nui.nvim",
      "nvim-lua/plenary.nvim", "nvim-neotest/nvim-nio", "tpope/vim-dotenv" },
    ft = { "php", "blade" },
    event = { "BufEnter composer.json" },
    opts = { features = { pickers = { provider = "telescope" } } },
    keys = {
      { "<leader>ll", function() Laravel.pickers.laravel() end, desc = "Laravel picker" },
      { "<leader>la", function() Laravel.pickers.artisan() end, desc = "Laravel Artisan" },
      { "<leader>lr", function() Laravel.pickers.routes() end, desc = "Laravel routes" },
      { "<leader>lt", function() Laravel.commands.run("tinker:open") end, desc = "Laravel Tinker", mode = { "n", "v" } },
    },
  },
  { "jwalton512/vim-blade" },
}
