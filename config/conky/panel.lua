-- SPDX-License-Identifier: GPL-3.0-only
-- Shared Conky system panel. Themes pass a palette; this file sets conky.config and conky.text.
-- Only Conky's built-in text, bars and graphs are used, so the panel renders on Sway and i3.

local function first_line(file)
    local handle = io.open(file)
    if not handle then return nil end
    local line = handle:read('l')
    handle:close()
    return line
end

-- hwmon numbers change between boots, so find the sensor by driver name at start.
local function temperature_sensor()
    for _, driver in ipairs({'k10temp', 'zenpower', 'coretemp', 'acpitz'}) do
        for index = 0, 31 do
            if first_line('/sys/class/hwmon/hwmon' .. index .. '/name') == driver then return index end
        end
    end
end

-- The interface carrying the default route; restart the panel after switching networks.
local function network_interface()
    local routes = io.open('/proc/net/route')
    if not routes then return nil end
    routes:read('l')
    for line in routes:lines() do
        local interface, destination = line:match('^(%S+)%s+(%x+)')
        if destination == '00000000' then
            routes:close()
            return interface
        end
    end
    routes:close()
end

local function battery()
    for _, name in ipairs({'BAT0', 'BAT1', 'BATT', 'BAT'}) do
        if first_line('/sys/class/power_supply/' .. name .. '/type') == 'Battery' then return name end
    end
end

return function(palette)
    local display = os.getenv('WAYLAND_DISPLAY')
    local wayland = display ~= nil and display ~= ''

    conky.config = {
        out_to_wayland = wayland,
        out_to_x = not wayland,
        -- Required on Wayland too: without it Conky 1.24 creates no surface and draws nothing.
        own_window = true,
        own_window_type = 'desktop',
        own_window_class = 'Conky',
        own_window_title = 'arch-desktop-conky',
        own_window_hints = 'undecorated,below,sticky,skip_taskbar,skip_pager',
        -- #AARRGGBB: opacity lives in the colour since own_window_argb_* were removed.
        own_window_colour = '#de' .. palette.bg,
        -- Top-right, clear of the 32px Waybar / i3bar and the 4px outer gap.
        alignment = 'top_right',
        gap_x = 16,
        gap_y = 48,
        minimum_width = 290,
        maximum_width = 290,
        border_inner_margin = 14,
        update_interval = 2,
        cpu_avg_samples = 2,
        net_avg_samples = 2,
        double_buffer = true,
        background = false,
        no_buffers = true,
        short_units = true,
        format_human_readable = true,
        use_xft = true,
        font = 'JetBrainsMono Nerd Font:size=10',
        draw_borders = false,
        draw_outline = false,
        draw_shades = false,
        draw_graph_borders = false,
        default_color = palette.text,
        color1 = palette.accent,
        color2 = palette.muted,
        color3 = palette.surface,
        color4 = palette.alert,
    }

    local label = '${color2}'
    local value = '${color}'
    local lines = {
        '${color1}${font JetBrainsMono Nerd Font:bold:size=18}${time %H:%M}${font}'
            .. '${alignr}' .. label .. '${time %a %d %b}',
        '${color3}${hr 1}',
    }
    -- Fastest core, not core 1: an idle core at 0.6 GHz hides a busy CPU (and a stuck one).
    local cpu = label .. 'CPU ' .. value .. '${cpu cpu0}%${goto 100}'
        .. '${execi 2 awk \'$1 > max { max = $1 } END { printf "%.2f", max / 1000000 }\' '
        .. '/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq} GHz max'
    local sensor = temperature_sensor()
    if sensor then cpu = cpu .. '${alignr}${hwmon ' .. sensor .. ' temp 1}°C' end
    lines[#lines + 1] = cpu
    lines[#lines + 1] = '${cpugraph cpu0 32,290 ' .. palette.surface .. ' ' .. palette.accent .. ' -t}'
    lines[#lines + 1] = label .. 'RAM  ' .. value .. '${mem} / ${memmax}${alignr}${color1}${membar 6,90}'
    lines[#lines + 1] = label .. 'SWAP ' .. value .. '${swap} / ${swapmax}${alignr}${color1}${swapbar 6,90}'
    lines[#lines + 1] = label .. 'DISK ' .. value .. '${fs_used /} / ${fs_size /}${alignr}${color1}${fs_bar 6,90 /}'

    local interface = network_interface()
    if interface then
        lines[#lines + 1] = label .. 'NET  ' .. value .. '${downspeed ' .. interface .. '}'
            .. '${goto 150}' .. label .. 'UP ' .. value .. '${upspeed ' .. interface .. '}'
    end

    local cell = battery()
    if cell then
        local power = '/sys/class/power_supply/' .. cell .. '/power_now'
        local line = label .. 'BAT  ' .. value .. '${battery_percent ' .. cell .. '}% ${battery_status ' .. cell .. '}'
        if first_line(power) then
            -- power_now is in microwatts; read it every 5s rather than on every update.
            line = line .. '${alignr}${execi 5 awk \'{printf "%.0f", $1 / 1000000}\' ' .. power .. '} W'
        end
        -- Inline warning, so a healthy battery does not leave an empty line.
        lines[#lines + 1] = line .. '${if_match ${battery_percent ' .. cell .. '} <= 15}${color4} low${endif}'
    end

    conky.text = table.concat(lines, '\n') .. '\n'
end
