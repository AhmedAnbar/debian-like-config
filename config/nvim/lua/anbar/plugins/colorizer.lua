return {
  {
    "NvChad/nvim-colorizer.lua",
    config = function()
      require("colorizer").setup({
        filetypes = {
          "html",
          "css",
          "javascript",
          "typescript",
          "typescriptreact",
          "javascriptreact",
          "lua",
          "svelte",
          "php",
        },
        user_default_options = {
          mode = "background",
          tailwind = true, -- Enable tailwind colors
        },
      })
    end,
  },
}
