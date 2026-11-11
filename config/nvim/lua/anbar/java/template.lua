-- Fills a new or empty .java file the way VS Code does: the package line taken from the
-- file's path, then a public class named after the file. Covers :e Foo.java (BufNewFile)
-- and files that oil or neo-tree created empty on disk before opening (BufReadPost).
local M = {}

-- Source roots, most specific first; the package is the path between the root and the file.
local roots = { "/src/main/java/", "/src/test/java/", "/src/main/kotlin/", "/src/test/kotlin/", "/src/" }

function M.package_for(path)
  local dir = vim.fs.dirname(path) .. "/"
  for _, root in ipairs(roots) do
    local s, e = dir:find(root, 1, true)
    if s then
      local rel = dir:sub(e + 1):gsub("/$", "")
      if rel == "" then return nil end
      return (rel:gsub("/", "."))
    end
  end
  return nil
end

function M.lines_for(path)
  local name = vim.fn.fnamemodify(path, ":t:r")
  local pkg = M.package_for(path)
  local lines = {}
  if pkg then vim.list_extend(lines, { "package " .. pkg .. ";", "" }) end
  if name == "package-info" then return pkg and { lines[1] } or {} end
  if name == "module-info" then return { "module " .. (pkg or "app") .. " {", "}" } end
  vim.list_extend(lines, { "public class " .. name .. " {", "    ", "}" })
  return lines
end

local function is_empty(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  return #lines == 0 or (#lines == 1 and lines[1] == "")
end

local function fill(event)
  local bufnr = event.buf
  if vim.bo[bufnr].buftype ~= "" or not is_empty(bufnr) then return end
  local path = vim.api.nvim_buf_get_name(bufnr)
  if path == "" or path:match("^%a+://") then return end
  local lines = M.lines_for(path)
  if #lines == 0 then return end
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
  -- Leave the cursor inside the class body when the buffer is the one on screen.
  if vim.api.nvim_get_current_buf() == bufnr then
    for i, line in ipairs(lines) do
      if line == "    " then
        vim.api.nvim_win_set_cursor(0, { i, 4 })
        break
      end
    end
  end
end

function M.setup()
  vim.api.nvim_create_autocmd({ "BufNewFile", "BufReadPost" }, {
    group = vim.api.nvim_create_augroup("AnbarJavaTemplate", { clear = true }),
    pattern = "*.java",
    callback = fill,
  })
end

return M
