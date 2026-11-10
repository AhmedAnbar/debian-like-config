-- :SpringNew creates a Spring Boot project from start.spring.io, the same service the
-- IntelliJ and VS Code wizards use; :JavaNew creates a plain Maven project from the
-- quickstart archetype. Both cd into the new project and open its main class.
local M = {}

local INITIALIZR = "https://start.spring.io"

local function notify(message, level)
  vim.schedule(function() vim.notify(message, level or vim.log.levels.INFO, { title = "Java" }) end)
end

local function installed_java_major()
  local result = vim.system({ "java", "-version" }, { text = true }):wait()
  if result.code ~= 0 then return nil end
  return (result.stderr or ""):match('version "(%d+)')
end

local function open_main_class(dir, pattern)
  vim.cmd.cd(vim.fn.fnameescape(dir))
  local main = vim.fs.find(function(name) return name:match(pattern) end, { path = dir .. "/src/main", type = "file" })[1]
  vim.cmd.edit(vim.fn.fnameescape(main or dir))
  notify("Created " .. dir .. "\nThe Java server indexes the project on first open; dependencies download in the background.")
end

-- vim.ui.input with a default, cancelled (nil) or empty answers fall back to the default.
local function ask(prompt, default, next)
  vim.ui.input({ prompt = prompt, default = default }, function(answer)
    if answer == nil then return end
    answer = vim.trim(answer)
    next(answer ~= "" and answer or default)
  end)
end

local function choose(items, prompt, format, next)
  vim.ui.select(items, { prompt = prompt, format_item = format }, function(item)
    if item then next(item) end
  end)
end

-- Telescope multi-select: Tab marks entries, Enter takes the marked ones (or the one under
-- the cursor if none are marked). Without telescope, a comma-separated list of ids.
local function pick_dependencies(metadata, next)
  local entries = {}
  for _, group in ipairs(metadata.dependencies.values) do
    for _, dep in ipairs(group.values) do
      table.insert(entries, { id = dep.id, name = dep.name, group = group.name, description = dep.description or "" })
    end
  end
  local ok = pcall(require, "telescope")
  if not ok then
    ask("Dependencies (comma-separated ids, e.g. web,data-jpa,lombok): ", "web,devtools", function(answer)
      next(vim.split(answer:gsub("%s", ""), ",", { trimempty = true }))
    end)
    return
  end
  local pickers, finders = require("telescope.pickers"), require("telescope.finders")
  local conf, actions = require("telescope.config").values, require("telescope.actions")
  local action_state = require("telescope.actions.state")
  pickers.new({}, {
    prompt_title = "Spring dependencies — Tab to mark, Enter to create",
    finder = finders.new_table({
      results = entries,
      entry_maker = function(dep)
        return {
          value = dep,
          display = string.format("%-34s %-22s %s", dep.name, "[" .. dep.group .. "]", dep.description),
          ordinal = dep.name .. " " .. dep.id .. " " .. dep.group .. " " .. dep.description,
        }
      end,
    }),
    sorter = conf.generic_sorter({}),
    attach_mappings = function(prompt_bufnr)
      actions.select_default:replace(function()
        local picker = action_state.get_current_picker(prompt_bufnr)
        local marked = picker:get_multi_selection()
        if #marked == 0 then marked = { action_state.get_selected_entry() } end
        actions.close(prompt_bufnr)
        next(vim.tbl_map(function(entry) return entry.value.id end, marked))
      end)
      return true
    end,
  }):find()
end

local function generate(params, parent)
  local target = parent .. "/" .. params.artifactId
  if vim.uv.fs_stat(target) then
    notify(target .. " already exists; nothing was created.", vim.log.levels.ERROR)
    return
  end
  local zip = vim.fn.tempname() .. ".zip"
  local args = { "curl", "-fsSL", INITIALIZR .. "/starter.zip", "-o", zip }
  for key, value in pairs(params) do vim.list_extend(args, { "--data-urlencode", key .. "=" .. value }) end
  notify("Downloading the project from start.spring.io…")
  vim.system(args, { text = true }, function(download)
    if download.code ~= 0 then
      notify("start.spring.io refused the request:\n" .. (download.stderr or ""), vim.log.levels.ERROR)
      return
    end
    -- baseDir makes the archive's top folder the artifact id, so it unpacks into the parent.
    vim.system({ "unzip", "-q", zip, "-d", parent }, { text = true }, function(unpack)
      os.remove(zip)
      if unpack.code ~= 0 then
        notify("unzip failed:\n" .. (unpack.stderr or ""), vim.log.levels.ERROR)
        return
      end
      vim.schedule(function() open_main_class(target, "Application%.java$") end)
    end)
  end)
end

function M.spring_new()
  notify("Reading the options start.spring.io offers…")
  vim.system({ "curl", "-fsSL", "-H", "Accept: application/vnd.initializr.v2.2+json", INITIALIZR .. "/metadata/client" },
    { text = true }, vim.schedule_wrap(function(result)
      if result.code ~= 0 then
        notify("Could not reach start.spring.io:\n" .. (result.stderr or ""), vim.log.levels.ERROR)
        return
      end
      local metadata = vim.json.decode(result.stdout)
      local builds = {
        { id = "maven-project", label = "Maven" },
        { id = "gradle-project-kotlin", label = "Gradle (Kotlin DSL)" },
        { id = "gradle-project", label = "Gradle (Groovy DSL)" },
      }
      -- The installed JDK first when start.spring.io offers it, then the rest newest-first.
      local installed = installed_java_major()
      local javas = {}
      for _, v in ipairs(metadata.javaVersion.values) do
        if v.id == installed then table.insert(javas, 1, v.id) else table.insert(javas, v.id) end
      end
      choose(builds, "Build tool", function(b) return b.label end, function(build)
        choose(javas, "Java version", function(v)
          return v == installed and (v .. "  (installed)") or v
        end, function(java)
          ask("Group id: ", "com.example", function(group)
            ask("Artifact id (also the folder name): ", "demo", function(artifact)
              ask("Create it in: ", vim.fn.getcwd(), function(parent)
                pick_dependencies(metadata, function(deps)
                  generate({
                    type = build.id,
                    language = "java",
                    bootVersion = metadata.bootVersion.default,
                    javaVersion = java,
                    groupId = group,
                    artifactId = artifact,
                    name = artifact,
                    baseDir = artifact,
                    packaging = "jar",
                    dependencies = table.concat(deps, ","),
                  }, vim.fn.fnamemodify(vim.fn.expand(parent), ":p"):gsub("/$", ""))
                end)
              end)
            end)
          end)
        end)
      end)
    end))
end

function M.java_new()
  if vim.fn.executable("mvn") == 0 then
    notify("mvn is not installed. Run: sudo apt-get install maven", vim.log.levels.ERROR)
    return
  end
  ask("Group id: ", "com.example", function(group)
    ask("Artifact id (also the folder name): ", "app", function(artifact)
      ask("Create it in: ", vim.fn.getcwd(), function(parent)
        parent = vim.fn.fnamemodify(vim.fn.expand(parent), ":p"):gsub("/$", "")
        local target = parent .. "/" .. artifact
        if vim.uv.fs_stat(target) then
          notify(target .. " already exists; nothing was created.", vim.log.levels.ERROR)
          return
        end
        local java = installed_java_major() or "21"
        notify("Generating with the Maven quickstart archetype…")
        vim.system({
          "mvn", "-B", "-q", "archetype:generate",
          "-DarchetypeGroupId=org.apache.maven.archetypes",
          "-DarchetypeArtifactId=maven-archetype-quickstart",
          "-DarchetypeVersion=1.5",
          "-DgroupId=" .. group, "-DartifactId=" .. artifact,
          "-DjavaCompilerVersion=" .. java,
          "-DinteractiveMode=false",
        }, { cwd = parent, text = true }, vim.schedule_wrap(function(result)
          if result.code ~= 0 then
            notify("mvn archetype:generate failed:\n" .. (result.stdout or "") .. (result.stderr or ""), vim.log.levels.ERROR)
            return
          end
          open_main_class(target, "App%.java$")
        end))
      end)
    end)
  end)
end

return M
