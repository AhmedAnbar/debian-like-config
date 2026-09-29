return {
  {
    "stevearc/conform.nvim",
    event = { "BufReadPre", "BufNewFile" },
    config = function(_, opts)
      local util = require("conform.util")
      local conform = require("conform")
      conform.setup({
        format_on_save = {
          -- These options will be passed to conform.format()
          timeout_ms = 5000,
          lsp_format = "fallback",
          async = false,
        },
        format = {
          timeout_ms = 5000,
          async = false, -- not recommended to change
          quiet = false, -- not recommended to change
        },
        formatters_by_ft = {
          vue = { "prettier" },
          javascript = { "prettier" },
          typescript = { "prettier" },
          prisma = { "prettier" },
          javascriptreact = { "prettier" },
          typescriptreact = { "prettier" },
          svelte = { "prettier" },
          css = { "prettier" },
          html = { "prettier" },
          json = { "prettier" },
          yaml = { "prettier" },
          markdown = { "prettier" },
          graphql = { "prettier" },
          lua = { "stylua" },
          php = { "pint" },
          sql = { "sql-formatter" },
          blade = { "blade-formatter" },
          go = { "gofumpt", "goimports_reviser", "golines" },
        },
        formatters = {
          injected = { options = { ignore_errors = true } },
          pint = {
            meta = {
              url = "https://github.com/laravel/pint",
              description =
              "Laravel Pint is an opinionated PHP code style fixer for minimalists. Pint is built on top of PHP-CS-Fixer and makes it simple to ensure that your code style stays clean and consistent.",
            },
            command = util.find_executable({
              "vendor/bin/pint",
              vim.fn.stdpath("data") .. "/mason/bin/pint",
            }, "pint"),
            args = { "$FILENAME" },
            stdin = false,
          },
        },
      })
      vim.keymap.set({ "n", "v" }, "<leader>mp", function()
        conform.format({
          lsp_format = "fallback",
          async = false,
          timeout_ms = 500,
        })
      end, { desc = "Format file or range (in visual mode)" })

    end,
  },
}
