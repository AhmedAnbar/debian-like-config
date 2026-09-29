local options = {
	confirm = true, -- ask for confirmation instead of erroring
	backup = false, -- creates a backup file
	clipboard = "unnamed,unnamedplus", -- allows neovim to access the system clipboard
	cmdheight = 2, -- more space in the neovim command line for displaying messages
	completeopt = { "menuone", "noselect" }, -- mostly just for cmp
	conceallevel = 1, -- so that `` is visible in markdown files
	fileencoding = "utf-8", -- the encoding written to a file
	hlsearch = true, -- highlight all matches on previous search pattern
	ignorecase = true, -- ignore case in search patterns
	mouse = "a", -- allow the mouse to be used in neovim
	pumheight = 10, -- pop up menu height
	showmode = false, -- we don't need to see things like -- INSERT -- anymore
	showtabline = 2, -- always show tabs
	smartcase = true, -- smart case
	smartindent = true, -- make indenting smarter again
	breakindent = true,
	incsearch = true, -- Enable incremental searching
	splitbelow = true, -- force all horizontal splits to go below current window
	splitright = true, -- force all vertical splits to go to the right of current window
	swapfile = false, -- creates a swapfile
	termguicolors = true, -- set term gui colors (most terminals support this)
	timeoutlen = 1000, -- time to wait for a mapped sequence to complete (in milliseconds)
	undofile = true, -- enable persistent undo
	updatetime = 300, -- faster completion (4000ms default)
	writebackup = false, -- if a file is being edited by another program (or was written to file while editing with another program), it is not allowed to be edited
	expandtab = true, -- convert tabs to spaces
	shiftwidth = 2, -- the number of spaces inserted for each indentation
	tabstop = 2, -- insert 2 spaces for a tab
	softtabstop = 2,
	cursorline = true, -- highlight the current line
	number = true, -- set numbered lines
	relativenumber = false, -- set relative numbered lines
	numberwidth = 2, -- set number column width to 2 {default 4}
	signcolumn = "yes", -- always show the sign column, otherwise it would shift the text each time
	wrap = false, -- display lines as one long line
	scrolloff = 8, -- is one of my fav
	sidescrolloff = 8,
	redrawtime = 10000, -- Allow more time for loading syntax on large files
	spell = true,
	wildmode = "longest:full,full", -- complete the longest common match, and allow tabbing the results to fully complete them
	guifont = "monospace:h17", -- the font used in graphical neovim applications
	spelllang = { "en_us" },
	foldcolumn = "0",
	foldenable = true, -- disable folding; enable with zi
	--foldmethod = "indent",
	foldexpr = "v:lua.vim.treesitter.foldexpr()",
	foldlevel = 99,
	foldlevelstart = 99,
	fillchars = {
		eob = " ", -- End-of-buffer: ~
	},
	colorcolumn = "130",
}

vim.g.mapleader = " " -- Set leader key to space
vim.g.maplocalleader = " " -- Set leader key to space
vim.opt.shortmess:append("c") -- disable the splash screen
vim.opt.backupdir:remove(".") -- keep backups out of the current directory

for k, v in pairs(options) do
	vim.opt[k] = v
end

vim.cmd("set whichwrap+=<,>,[,],h,l")
vim.cmd([[set iskeyword+=-]])
vim.cmd([[set formatoptions-=cro]]) -- TODO: this doesn't seem to work
