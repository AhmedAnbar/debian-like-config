-- Conform owns formatting, avoiding duplicate before/after-write handlers.
-- Keep none-ls available for manually added diagnostic/code-action sources.
return { { "nvimtools/none-ls.nvim", opts = { sources = {} } } }
