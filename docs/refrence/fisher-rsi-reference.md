// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
//@version=6
//Created by
//┌─────┐  ┌──────┐ ┌──────┐ ┌──────┐
//└─────┘  └──────┘ └──────┘ └──────┘
//┌──────┐   ┌────┐ ┌──────┐ ┌──────┐
//│ ┌──┐ │   └──┐ │ │ ┌──┐ │ │ ┌─┐ ┌┘
//│ └──┘ │ ┌────┘ │ │ │  │ │ │ │ │ │ 
//└──────┘ └──────┘ └─┘  └─┘ └─┘ └─┘ 
indicator('FisherRSI', shorttitle = 'FRSI', overlay = false)

var string GRP_RSI = '━━━  RSI  ━━━'
var string GRP_FISHER = '━━━  FISHER TRANSFORM  ━━━'
var string GRP_DISPLAY = '━━━  DISPLAY  ━━━'
var string GRP_THEME = '━━━  COLOR THEME  ━━━'

// ─────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────

// RSI
rsi_source = input.source(close, 'RSI Source', group = GRP_RSI)
rsi_length = input.int(14, 'RSI Length', minval = 2, maxval = 200, group = GRP_RSI, tooltip = 'Lookback for the RSI.')
rsi_smoothing = input.int(1, 'RSI Smoothing', minval = 1, maxval = 10, group = GRP_RSI, tooltip = 'SMA period applied to the RSI before the Fisher Transform. 1 = no smoothing.')
oversold_level = input.int(30, 'Oversold Level', minval = 1, maxval = 49, group = GRP_RSI, tooltip = 'Lower zone boundary. Bullish Fisher cross arrows fire when RSI or the Fisher line itself is at or below this level.')
overbought_level = input.int(70, 'Overbought Level', minval = 51, maxval = 99, group = GRP_RSI, tooltip = 'Upper zone boundary. Bearish Fisher cross arrows fire when RSI or the Fisher line itself is at or above this level.')

// Fisher Transform
enable_fisher_transform = input.bool(true, 'Enable Fisher Transform Lines', group = GRP_FISHER, tooltip = 'Plots the Fisher Transform and signal lines derived from the RSI. Independent of Show RSI and Show Fisher Cross Arrows.')
fisher_length = input.int(10, 'Fisher Length', minval = 2, maxval = 100, group = GRP_FISHER, tooltip = 'Lookback for the min-max rescale used by the Fisher Transform.')
show_fisher_arrows = input.bool(true, 'Show Fisher Cross Arrows', group = GRP_FISHER, tooltip = 'Marks Fisher Transform crossovers with arrows on the Fisher line when RSI or the Fisher line is in an extreme zone. Works whether or not the Fisher lines are plotted.')
show_chart_highlight = input.bool(true, 'Show Price Chart Highlight', group = GRP_FISHER, tooltip = 'Highlights the price chart background on the same bars as the Fisher cross arrows. Not drawn in the indicator pane. Requires Show Fisher Cross Arrows to be on.')
chart_highlight_transparency = input.int(85, 'Chart Highlight Transparency', minval = 0, maxval = 100, group = GRP_FISHER, tooltip = 'Transparency of the zone-gated price chart highlight. Higher = more transparent. 0 = fully opaque, 100 = invisible.')
show_any_cross_highlight = input.bool(false, 'Show Highlight on Any Fisher Cross', group = GRP_FISHER, tooltip = 'Also highlights the price chart on every Fisher cross, including crosses outside the OB/OS zones that do not get an arrow. Drawn in the price chart only. Bars that already get the zone-gated highlight are not drawn twice.')
any_cross_highlight_transparency = input.int(93, 'Any-Cross Highlight Transparency', minval = 0, maxval = 100, group = GRP_FISHER, tooltip = 'Transparency of the any-cross highlight. The default is roughly half the opacity of the zone-gated highlight default.')

// Display
show_rsi = input.bool(false, 'Show RSI', group = GRP_DISPLAY, tooltip = 'Shows the RSI line and its glow. Off by default so only the Fisher Transform lines display. Independent of the Fisher Transform lines.')
show_regime_zones = input.bool(true, 'Show Regime Background', group = GRP_DISPLAY, tooltip = 'Colors the indicator pane background based on the current regime of the line selected in Regime Basis.')
regime_basis = input.string('Fisher Transform', 'Regime Basis', options = ['Fisher Transform', 'RSI'], group = GRP_DISPLAY, tooltip = 'Which line drives the regime background color. The Fisher line and the RSI line are each colored from their own value.')

// Color Theme
color_theme = input.string('Vaporwave', 'Color Theme', options = ['Modern', 'Neon', 'Classic', 'Gold Standard', 'Ultraviolet', 'Infrared', 'Arctic', 'Vaporwave', 'Matrix', 'Terminal'], group = GRP_THEME, tooltip = 'Same theme set as the CCO and Stochastic / Fisher CVD indicators. Overridden entirely if Use Custom Colors below is on.')
use_custom_colors = input.bool(false, 'Use Custom Colors (Override Theme)', group = GRP_THEME, tooltip = 'Ignores the Color Theme above and uses the four colors below instead.')
custom_bearish_color = input.color(#00D4AA, 'Custom Bearish/Oversold Color', group = GRP_THEME)
custom_bullish_color = input.color(#FF073A, 'Custom Bullish/Overbought Color', group = GRP_THEME)
custom_neutral_color = input.color(#9D4EDD, 'Custom Neutral/Mixed Color', group = GRP_THEME)
custom_accent_color = input.color(#FFC107, 'Custom Accent Color (Signal Line)', group = GRP_THEME)
enable_visual_effects = input.bool(true, 'Enable Enhanced Visual Effects', group = GRP_THEME, tooltip = 'Master switch for the smooth color gradient on the lines, the shaded OB/OS band, and the overshoot fills when the Fisher line moves beyond a level. Line Glow is controlled separately below. Off = flat styling using the discrete regime colors.')
show_glow = input.bool(false, 'Show Line Glow', group = GRP_THEME, tooltip = 'Adds a soft halo around the Fisher line, and around the RSI line when it is shown. Independent of Enable Enhanced Visual Effects.')
gradient_lower_bound = input.float(25, 'Gradient Lower Bound', minval = 0, maxval = 49, step = 1, group = GRP_THEME, tooltip = 'A line at or below this level shows the fully saturated bearish color. Applies to both the Fisher line (on its 50 +/- 10x scale) and the RSI line.')
gradient_upper_bound = input.float(75, 'Gradient Upper Bound', minval = 51, maxval = 100, step = 1, group = GRP_THEME, tooltip = 'A line at or above this level shows the fully saturated bullish color. Applies to both the Fisher line and the RSI line.')

// ─────────────────────────────────────────────────────────────
// RSI
// ─────────────────────────────────────────────────────────────

rsi_score = ta.sma(ta.rsi(rsi_source, rsi_length), rsi_smoothing)
score = rsi_score

neutral_level = 50
moderate_bearish_threshold = (oversold_level + neutral_level) / 2
moderate_bullish_threshold = (overbought_level + neutral_level) / 2

// ─────────────────────────────────────────────────────────────
// Fisher Transform of RSI
// ─────────────────────────────────────────────────────────────

var float fisher_value1 = 0.0
var float fisher_transform = 0.0

fisher_highest = ta.highest(rsi_score, fisher_length)
fisher_lowest = ta.lowest(rsi_score, fisher_length)
fisher_range = fisher_highest - fisher_lowest

fisher_position = fisher_range != 0 ? (rsi_score - fisher_lowest) / fisher_range - 0.5 : 0.0
fisher_value1 := 0.33 * 2 * fisher_position + 0.67 * nz(fisher_value1[1])
fisher_value1 := math.max(math.min(fisher_value1, 0.999), -0.999)
fisher_transform := 0.5 * math.log((1 + fisher_value1) / (1 - fisher_value1)) + 0.5 * nz(fisher_transform[1])
fisher_signal = fisher_transform[1]

fisher_value_scaled = 50 + fisher_transform * 10

fisher_bull_zone = score <= oversold_level or fisher_value_scaled <= oversold_level
fisher_bear_zone = score >= overbought_level or fisher_value_scaled >= overbought_level

fisher_cross_up = show_fisher_arrows and ta.crossover(fisher_transform, fisher_signal) and fisher_bull_zone
fisher_cross_down = show_fisher_arrows and ta.crossunder(fisher_transform, fisher_signal) and fisher_bear_zone

fisher_any_cross_up = ta.crossover(fisher_transform, fisher_signal)
fisher_any_cross_down = ta.crossunder(fisher_transform, fisher_signal)

fisher_scaled = enable_fisher_transform ? fisher_value_scaled : na
fisher_signal_scaled = enable_fisher_transform ? 50 + fisher_signal * 10 : na

// ─────────────────────────────────────────────────────────────
// Color theme
// ─────────────────────────────────────────────────────────────

mix_color(color_a, color_b) => color.from_gradient(50, 0, 100, color_a, color_b) 

f_theme_colors() =>
    var color bearish = na, var color bullish = na, var color neutral = na, var color accent = na
    switch color_theme
        'Modern'        => bearish := #00D4AA,             bullish := #FF073A,             neutral := #9D4EDD,             accent := #FFC107
        'Neon'          => bearish := #00FFFF, bullish := #FF00FF, neutral := #9932CC, accent := #FFFF00
        'Classic'       => bearish := color.rgb(0,200,83),  bullish := color.rgb(255,23,68), neutral := color.rgb(136,136,136), accent := color.rgb(255,179,0)
        'Gold Standard' => bearish := #FFD700, bullish := #B0B0B0, neutral := #CD7F32, accent := #FFFFFF
        'Ultraviolet'   => bearish := #BF00FF, bullish := #6600AA, neutral := #5C0080, accent := #00FF00
        'Infrared'      => bearish := #FFFFFF, bullish := #CC0000, neutral := #882200, accent := #FF6600
        'Arctic'        => bearish := #A8D8FF, bullish := #4488CC, neutral := #3A5A8A, accent := #F0F8FF
        'Vaporwave'     => bearish := #FF6B9D, bullish := #9B30FF, neutral := #6622AA, accent := #00FFFF
        'Matrix'        => bearish := #00FF41, bullish := #007A1F, neutral := #003D0F, accent := #FFFFFF
        'Terminal'      => bearish := #00FF00, bullish := #FF6000, neutral := #707070, accent := #FFFFFF
    [bearish, bullish, neutral, accent]

[_theme_bearish, _theme_bullish, _theme_neutral, _theme_accent] = f_theme_colors()

theme_bearish = use_custom_colors ? custom_bearish_color : _theme_bearish
theme_bullish = use_custom_colors ? custom_bullish_color : _theme_bullish
theme_neutral = use_custom_colors ? custom_neutral_color : _theme_neutral
theme_accent = use_custom_colors ? custom_accent_color : _theme_accent
theme_moderate_bearish = mix_color(theme_bearish, theme_neutral)
theme_moderate_bullish = mix_color(theme_neutral, theme_bullish)

// Color for a line value on the 0-100 scale: smooth gradient with effects on, discrete regime colors with effects off
f_line_color(float val) =>
    float clamped = math.max(math.min(val, gradient_upper_bound), gradient_lower_bound)
    color gradient = clamped <= 50 ? color.from_gradient(clamped, gradient_lower_bound, 50, theme_bearish, theme_neutral) : color.from_gradient(clamped, 50, gradient_upper_bound, theme_neutral, theme_bullish)
    color discrete = val <= oversold_level ? theme_bearish :
         val <= moderate_bearish_threshold ? theme_moderate_bearish :
         val < moderate_bullish_threshold ? theme_neutral :
         val < overbought_level ? theme_moderate_bullish :
         theme_bullish
    enable_visual_effects ? gradient : discrete

rsi_line_color = f_line_color(score)
fisher_line_color = f_line_color(fisher_value_scaled)

// Background regime color follows the selected basis
regime_color = color.new(regime_basis == 'RSI' ? rsi_line_color : fisher_line_color, 90)

// ─────────────────────────────────────────────────────────────
// Plots
// ─────────────────────────────────────────────────────────────
// Z-order follows declaration order: references, fills and level lines first,
// then the RSI and Fisher lines on top.

// Reference and level lines (bottom layer)
p_zero_ref = plot(0, 'Zero Reference', display = display.none)
p_hundred_ref = plot(100, 'Hundred Reference', display = display.none)
p_oversold = plot(oversold_level, 'Oversold', color = color.new(theme_bearish, 40), style = plot.style_line, linewidth = 1)
plot(neutral_level, 'Neutral', color = color.new(theme_neutral, 50), style = plot.style_line, linewidth = 1)
p_overbought = plot(overbought_level, 'Overbought', color = color.new(theme_bullish, 40), style = plot.style_line, linewidth = 1)

// Shaded band between the OB/OS levels
fill(p_overbought, p_oversold, color = enable_visual_effects ? color.new(theme_neutral, 92) : na, title = 'OB/OS Band Fill')

// RSI line glow
glow_active = show_glow and show_rsi
glow_value = glow_active ? score : na
plot(glow_value, 'RSI Glow Outer', color = color.new(rsi_line_color, 80), linewidth = 8, display = glow_active ? display.all : display.none)
plot(glow_value, 'RSI Glow Inner', color = color.new(rsi_line_color, 60), linewidth = 5, display = glow_active ? display.all : display.none)

// Main RSI line
plot(score, 'RSI', color = rsi_line_color, linewidth = 3, display = show_rsi ? display.all : display.none)

// Fisher line glow
fisher_glow_active = show_glow and enable_fisher_transform
fisher_glow_value = fisher_glow_active ? fisher_value_scaled : na
plot(fisher_glow_value, 'Fisher Glow Outer', color = color.new(fisher_line_color, 80), linewidth = 8, display = fisher_glow_active ? display.all : display.none)
plot(fisher_glow_value, 'Fisher Glow Inner', color = color.new(fisher_line_color, 60), linewidth = 5, display = fisher_glow_active ? display.all : display.none)

// Fisher Transform lines (signal first so the main line sits on top of it)
plot(fisher_signal_scaled, 'Fisher Signal', color = theme_accent, linewidth = 1, display = enable_fisher_transform ? display.all : display.none)
p_fisher = plot(fisher_scaled, 'Fisher Transform (RSI)', color = fisher_line_color, linewidth = 2, display = enable_fisher_transform ? display.all : display.none)

// Overshoot fills: shaded where the Fisher line is beyond a level
fill(p_fisher, p_overbought, color = enable_visual_effects and fisher_scaled > overbought_level ? color.new(theme_bullish, 75) : na, title = 'Overbought Overshoot Fill')
fill(p_fisher, p_oversold, color = enable_visual_effects and fisher_scaled < oversold_level ? color.new(theme_bearish, 75) : na, title = 'Oversold Overshoot Fill')

// Cross arrows on the Fisher line (top layer)
plotshape(fisher_cross_up ? fisher_value_scaled : na, style = shape.triangleup, location = location.absolute, color = theme_bearish, size = size.tiny, title = 'Fisher Cross Up', display = show_fisher_arrows ? display.all : display.none)
plotshape(fisher_cross_down ? fisher_value_scaled : na, style = shape.triangledown, location = location.absolute, color = theme_bullish, size = size.tiny, title = 'Fisher Cross Down', display = show_fisher_arrows ? display.all : display.none)

// Background regime coloring
bgcolor(show_regime_zones ? regime_color : na, title = 'Regime')

// Price chart highlight
chart_highlight_color = not show_chart_highlight ? na : fisher_cross_up ? color.new(theme_bearish, chart_highlight_transparency) : fisher_cross_down ? color.new(theme_bullish, chart_highlight_transparency) : na
bgcolor(chart_highlight_color, title = 'Fisher Cross Highlight (Price Chart)', force_overlay = true)

// Any-cross highlight 
zone_highlight_drawn = show_chart_highlight and (fisher_cross_up or fisher_cross_down)
any_cross_highlight_color = not show_any_cross_highlight or zone_highlight_drawn ? na : fisher_any_cross_up ? color.new(theme_bearish, any_cross_highlight_transparency) : fisher_any_cross_down ? color.new(theme_bullish, any_cross_highlight_transparency) : na
bgcolor(any_cross_highlight_color, title = 'Any Fisher Cross Highlight (Price Chart)', force_overlay = true)

// ─────────────────────────────────────────────────────────────
// Alerts
// ─────────────────────────────────────────────────────────────

// RSI zone entries
rsi_enter_overbought = ta.crossover(score, overbought_level)
rsi_enter_oversold = ta.crossunder(score, oversold_level)

// Zone-gated Fisher arrows
alertcondition(fisher_cross_up, 'Fisher Arrow - Bullish', '{{ticker}} {{interval}}: Fisher Bullish Cross (arrow signal)')
alertcondition(fisher_cross_down, 'Fisher Arrow - Bearish', '{{ticker}} {{interval}}: Fisher Bearish Cross (arrow signal)')

// Any Fisher cross, inside or outside the OB/OS zones
alertcondition(fisher_any_cross_up, 'Fisher Turn - Any Bullish Cross', '{{ticker}} {{interval}}: Fisher crossed above its signal line')
alertcondition(fisher_any_cross_down, 'Fisher Turn - Any Bearish Cross', '{{ticker}} {{interval}}: Fisher crossed below its signal line')

// RSI overbought / oversold entries
alertcondition(rsi_enter_overbought, 'RSI Overbought', '{{ticker}} {{interval}}: RSI entered overbought')
alertcondition(rsi_enter_oversold, 'RSI Oversold', '{{ticker}} {{interval}}: RSI entered oversold')
