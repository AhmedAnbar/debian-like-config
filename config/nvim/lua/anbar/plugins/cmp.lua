return {
	{
		"hrsh7th/nvim-cmp",
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/cmp-buffer",
			"hrsh7th/cmp-path",
			"hrsh7th/cmp-cmdline",
			"saadparwaiz1/cmp_luasnip",
			"L3MON4D3/LuaSnip",
			{ "jcha0713/cmp-tw2css" },
			{ "f3fora/cmp-spell" },
			{ "onsails/lspkind.nvim" },
			"SergioRibera/cmp-dotenv",
			{ "roobert/tailwindcss-colorizer-cmp.nvim", config = true },
			"lukas-reineke/cmp-under-comparator",
			"mattn/emmet-vim",
			"hrsh7th/cmp-nvim-lsp",
			"windwp/nvim-ts-autotag",
			"windwp/nvim-autopairs",
		},
		config = function()
			local cmp_autopairs = require("nvim-autopairs.completion.cmp")
			local cmp = require("cmp")
			local luasnip = require("luasnip")
			local lspkind = require("lspkind")

			local has_words_before = function()
				if vim.api.nvim_buf_get_option(0, "buftype") == "prompt" then
					return false
				end
				local line, col = unpack(vim.api.nvim_win_get_cursor(0))
				return col ~= 0
					and vim.api.nvim_buf_get_text(0, line - 1, 0, line - 1, col, {})[1]:match("^%s*$") == nil
			end

			require("nvim-autopairs").setup()

			-- Integrate nvim-autopairs with cmp
			cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())

			require("luasnip.loaders.from_vscode").lazy_load()
			require("luasnip.loaders.from_snipmate").lazy_load(opts)

			require("cmp-npm").setup({})
			local lspkind = require("lspkind")
			vim.opt.completeopt = "menu,menuone,noselect"
			cmp.setup({
				snippet = {
					expand = function(args)
						luasnip.lsp_expand(args.body)
					end,
				},
				window = {
					completion = cmp.config.window.bordered(),
					documentation = cmp.config.window.bordered(),
				},
				sorting = {
					priority_weight = 2,
					comparators = {

						-- Below is the default comparitor list and order for nvim-cmp
						cmp.config.compare.offset,
						-- cmp.config.compare.scopes, --this is commented in nvim-cmp too
						cmp.config.compare.exact,
						cmp.config.compare.score,
						cmp.config.compare.recently_used,
						cmp.config.compare.locality,
						cmp.config.compare.kind,
						cmp.config.compare.sort_text,
						cmp.config.compare.length,
						cmp.config.compare.order,
					},
				},
				mapping = cmp.mapping.preset.insert({
					["<Down>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Select }),
					["<Up>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Select }),
					["<Tab>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_next_item()
						else
							fallback()
						end
					end, { "i", "s" }),
					["<S-Tab>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_prev_item()
						else
							fallback()
						end
					end, { "i", "s" }),
					["<C-j>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Select }),
					["<C-k>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Select }),
					["<C-u>"] = cmp.mapping(cmp.mapping.scroll_docs(-1), { "i", "c" }),
					["<C-d>"] = cmp.mapping(cmp.mapping.scroll_docs(1), { "i", "c" }),
					["<C-Space>"] = cmp.mapping(cmp.mapping.complete(), { "i", "c" }),
					["<C-e>"] = cmp.mapping({
						i = cmp.mapping.abort(),
						c = cmp.mapping.close(),
					}),
					["<CR>"] = cmp.mapping.confirm({ select = true }),
				}),
				sources = cmp.config.sources({
					{ name = "laravel" },
					{ name = "nvim_lsp" },
					{ name = "luasnip" },
					{ name = "dotenv" },
					{
						name = "emmet_vim",
						option = {
							filetypes = {
								"html",
								"xml",
								"typescriptreact",
								"javascriptreact",
								"css",
								"sass",
								"scss",
								"less",
								"heex",
								"tsx",
								"jsx",
								"vue",
								"svelte",
							},
						},
					},
					{
						name = "npm",
						keyword_length = 4,
					},
					{ name = "crates" },
					{ name = "vim-dadbod-completion" },
					{ name = "buffer" },
					{ name = "path" },
				}),
				formatting = {
					expandable_indicator = true,
					fields = { "abbr", "menu", "kind" },
					format = lspkind.cmp_format({
						mode = "symbol_text",
						maxwidth = 50,
						ellipsis_char = "...",
						symbol_map = {
						},
					}),
				},
				experimental = {
					ghost_text = true,
				},
			})
			-- cmp-tw2css expects a stylesheet Tree-sitter tree and errors with
			-- "attempt to index local 'tree'" elsewhere (for example in .tsx), so offer it
			-- only where it works. Tailwind class completion comes from tailwindcss-language-server.
			cmp.setup.filetype({ "css", "scss", "sass", "less" }, {
				sources = cmp.config.sources({
					{ name = "cmp-tw2css" },
					{ name = "nvim_lsp" },
					{ name = "luasnip" },
					{ name = "buffer" },
					{ name = "path" },
				}),
			})
		end,
	},
	{
		"hrsh7th/cmp-cmdline",
		config = function()
			local cmp = require("cmp")
			cmp.setup.cmdline("/", {
				mapping = cmp.mapping.preset.cmdline(),
				sources = {
					{ name = "buffer" },
				},
			})
			cmp.setup.cmdline(":", {
				mapping = cmp.mapping.preset.cmdline(),
				sources = cmp.config.sources({
					{ name = "path" },
				}, {
					{
						name = "cmdline",
						option = {
							ignore_cmds = { "Man", "!" },
						},
					},
				}),
			})
		end,
	},
	{
		"L3MON4D3/LuaSnip",
		dependencies = { "rafamadriz/friendly-snippets" },
	},
	{
		"David-Kunz/cmp-npm",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"hrsh7th/nvim-cmp",
		},
		ft = "json",
	},
}
