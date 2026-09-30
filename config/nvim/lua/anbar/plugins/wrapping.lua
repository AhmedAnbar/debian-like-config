return {
	{
		"andrewferrier/wrapping.nvim",
		config = function()
			require("wrapping").setup({ notify_on_switch = false })
		end,
	},
}
