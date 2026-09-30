return {
  "neovim/nvim-lspconfig",
  event = { "BufReadPre", "BufNewFile" },
  dependencies = { "mason-org/mason.nvim", "hrsh7th/cmp-nvim-lsp" },
  config = function()
    require("mason").setup()
    local capabilities = require("cmp_nvim_lsp").default_capabilities()
    vim.lsp.config("*", { capabilities = capabilities })
    local servers = {
      bashls = {}, clangd = {}, cssls = {}, graphql = {}, html = {},
      vue_ls = {}, emmet_language_server = {}, svelte = {}, rust_analyzer = {},
      marksman = {}, prismals = {}, sqlls = {}, yamlls = {}, htmx = {},
      -- The phar requires iconv, which the system php.ini leaves disabled. It is loaded through
      -- PHP_INI_SCAN_DIR (~/.config/phpactor/php.d) so phpactor's own subprocesses, such as
      -- diagnostics, get it too, without changing the global PHP configuration.
      phpactor = {
        cmd_env = { PHP_INI_SCAN_DIR = ":" .. vim.fn.expand("~/.config/phpactor/php.d") },
        -- Root at the nearest PHP project (apps/api in a monorepo), not the repository root, so
        -- the indexer does not crawl node_modules and other applications.
        root_dir = function(bufnr, on_dir)
          on_dir(vim.fs.root(bufnr, { "composer.json", ".phpactor.json" }) or vim.fs.root(bufnr, ".git") or vim.fn.getcwd())
        end,
      },
      gopls = { settings = { gopls = { completeUnimported = true, staticcheck = true } } },
      ts_ls = {},
      jsonls = { settings = { json = { schemas = require("anbar.plugins.settings.jsonls"), validate = { enable = true } } } },
      lua_ls = { settings = { Lua = {
        diagnostics = { globals = { "vim" } },
        workspace = { checkThirdParty = false }, telemetry = { enabled = false },
      } } },
      tailwindcss = { init_options = { userLanguages = { blade = "html" } } },
    }
    -- nvim-lspconfig defines some cmd values as functions (version probing), so the binary
    -- cannot be read from the table; name it here or those servers are skipped in silence.
    local binaries = {
      cssls = "vscode-css-language-server",
      html = "vscode-html-language-server",
      jsonls = "vscode-json-language-server",
      svelte = "svelteserver",
      tailwindcss = "tailwindcss-language-server",
      ts_ls = "typescript-language-server",
      yamlls = "yaml-language-server",
    }
    for name, config in pairs(servers) do
      vim.lsp.config(name, config)
      local cmd = vim.lsp.config[name].cmd
      local binary = type(cmd) == "table" and cmd[1] or binaries[name]
      if binary and vim.fn.executable(binary) == 1 then vim.lsp.enable(name) end
    end
    -- Official Laravel server; never attach to unrelated PHP projects.
    local laravel_cmd = vim.fn.exepath("laravel-lsp")
    if laravel_cmd == "" then
      for _, path in ipairs({
        vim.fn.expand("~/.config/composer/vendor/bin/laravel-lsp"),
        vim.fn.expand("~/.composer/vendor/bin/laravel-lsp"),
      }) do
        if vim.fn.executable(path) == 1 then laravel_cmd = path; break end
      end
    end
    vim.lsp.config("laravel_lsp", {
      cmd = { laravel_cmd ~= "" and laravel_cmd or "laravel-lsp" },
      filetypes = { "php", "blade" },
      root_dir = function(bufnr, on_dir)
        local root = vim.fs.root(bufnr, "artisan")
        if root then on_dir(root) end
      end,
    })
    if laravel_cmd ~= "" then vim.lsp.enable("laravel_lsp") end
    vim.api.nvim_create_autocmd("LspAttach", {
      group = vim.api.nvim_create_augroup("AnbarLspKeys", { clear = true }),
      callback = function(event)
        local function map(lhs, rhs, desc, mode)
          vim.keymap.set(mode or "n", lhs, rhs, { buffer = event.buf, silent = true, desc = desc })
        end
        map("gr", "<cmd>Telescope lsp_references<cr>", "LSP references")
        map("gD", vim.lsp.buf.declaration, "LSP declaration")
        map("gd", "<cmd>Telescope lsp_definitions<cr>", "LSP definitions")
        map("gi", "<cmd>Telescope lsp_implementations<cr>", "LSP implementations")
        map("gt", "<cmd>Telescope lsp_type_definitions<cr>", "LSP type definitions")
        map("<leader>ca", vim.lsp.buf.code_action, "Code actions", { "n", "x" })
        map("<leader>rn", vim.lsp.buf.rename, "Rename symbol")
        map("<leader>D", "<cmd>Telescope diagnostics bufnr=0<cr>", "Buffer diagnostics")
        map("<leader>d", vim.diagnostic.open_float, "Line diagnostics")
        map("[d", function() vim.diagnostic.jump({ count = -1, float = true }) end, "Previous diagnostic")
        map("]d", function() vim.diagnostic.jump({ count = 1, float = true }) end, "Next diagnostic")
        map("K", function() vim.lsp.buf.hover({ border = "rounded" }) end, "Documentation")
        map("<leader>rs", function()
          for _, client in ipairs(vim.lsp.get_clients({ bufnr = event.buf })) do
            vim.lsp.enable(client.name, false)
            vim.lsp.enable(client.name)
          end
        end, "Restart attached language servers")
      end,
    })
    vim.diagnostic.config({ virtual_text = true, severity_sort = true, float = { border = "rounded" } })
  end,
}
