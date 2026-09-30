return {
  {
    "LudoPinelli/comment-box.nvim",
    lazy = false,
    keys = {
      { "<leader>cl", ":CBllline<CR>", mode = "n",          desc = "comment box" },
      { "<leader>cb", ":CBllbox<CR>",  mode = { "n", "v" }, desc = "comment box" },
    },
  },
}
