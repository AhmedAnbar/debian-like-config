return {
  { "mason-org/mason.nvim", opts = { ui = { border = "rounded" } } },
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    dependencies = { "mason-org/mason.nvim" },
    opts = {
      ensure_installed = {
        "phpactor", "lua-language-server", "json-lsp", "vue-language-server",
        "typescript-language-server", "rust-analyzer", "emmet-language-server",
        "svelte-language-server", "html-lsp", "stylua", "prettier", "eslint_d",
        "tailwindcss-language-server", "pint", "blade-formatter", "hadolint",
        "sql-formatter", "gopls", "gofumpt", "goimports-reviser", "golines", "htmx-lsp",
      },
      auto_update = false,
      run_on_start = false, -- Explicit :MasonToolsInstall; no background downloads at startup.
    },
  },
}
