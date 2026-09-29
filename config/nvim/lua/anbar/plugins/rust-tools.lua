-- Rust LSP is configured centrally; retain Cargo helpers and all crate shortcuts.
return {
	{
		"saecki/crates.nvim",
		event = { "BufRead Cargo.toml" },
		config = function()
			require("crates").setup({

			})
			local crates = require("crates")
			local opts = { silent = true }
			local vim = vim

			vim.keymap.set("n", "<leader>ct", crates.toggle, { silent = true, desc = "Toggle Crate" })
			vim.keymap.set("n", "<leader>cr", crates.reload, { silent = true, desc = "Reload Crate" })

			vim.keymap.set(
				"n",
				"<leader>cv",
				crates.show_versions_popup,
				{ silent = true, desc = "Show Versions Popup" }
			)
			vim.keymap.set(
				"n",
				"<leader>cf",
				crates.show_features_popup,
				{ silent = true, desc = "Show Features Popup" }
			)
			vim.keymap.set(
				"n",
				"<leader>cd",
				crates.show_dependencies_popup,
				{ silent = true, desc = "Show Dependencies Popup" }
			)

			vim.keymap.set("n", "<leader>cu", crates.update_crate, { silent = true, desc = "Update Crate" })
			vim.keymap.set("v", "<leader>cu", crates.update_crates, { silent = true, desc = "Update Crate" })
			-- vim.keymap.set("n", "<leader>ca", crates.update_all_crates, { silent = true, desc = "Update All Crates" })
			vim.keymap.set("n", "<leader>cU", crates.upgrade_crate, { silent = true, desc = "Upgrade Crate" })
			vim.keymap.set("v", "<leader>cU", crates.upgrade_crates, { silent = true, desc = "Upgrade Crates" })
			vim.keymap.set("n", "<leader>cA", crates.upgrade_all_crates, { silent = true, desc = "Upgrade All Crates" })

			vim.keymap.set(
				"n",
				"<leader>cx",
				crates.expand_plain_crate_to_inline_table,
				{ silent = true, desc = "Expand Crate" }
			)
			vim.keymap.set(
				"n",
				"<leader>cX",
				crates.extract_crate_into_table,
				{ silent = true, desc = "Extract Crate" }
			)

			vim.keymap.set("n", "<leader>cH", crates.open_homepage, { silent = true, desc = "Open Homepage" })
			vim.keymap.set("n", "<leader>cR", crates.open_repository, { silent = true, desc = "Open Repository" })
			vim.keymap.set("n", "<leader>cD", crates.open_documentation, { silent = true, desc = "Open Documentation" })
			vim.keymap.set("n", "<leader>cC", crates.open_crates_io, { silent = true, desc = "Open Crates.io" })
		end,
	},
}
