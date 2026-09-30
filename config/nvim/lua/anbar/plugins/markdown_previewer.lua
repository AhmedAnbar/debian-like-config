return {
	"iamcco/markdown-preview.nvim",
	ft = "markdown",
	build = function()
		vim.fn["mkdp#util#install"]()
	end,
	cmd = {
		"MarkdownPreviewToggle",
		"MarkdownPreview",
		"MarkdownPreviewStop",
	},
	keys = {
		-- <leader>mp is Conform's format key and <leader>md renders inside Neovim; mb = browser.
		{ "<leader>mb", "<cmd>MarkdownPreviewToggle<cr>", ft = "markdown", desc = "Toggle Markdown browser preview" },
	},
}
