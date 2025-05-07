import { D3_SELECTION, D3_SELECTION_SVGG, GanttData } from "../custom-types";
import { renderLabels, updateLabels } from "./labels";
import { renderBars, updateBars } from "./bars";
import { renderZoomSlider } from "./zoom-slider";
import { renderVerticalScroll, updateVerticalScroll } from "./vertical-scroll";
import { renderTodayLine, updateTodayLine } from "./today";
import { StylingInfo, Tooltip, Mod } from "spotfire/spotfire-api-1-2";
import { dateDiffInDays } from "../utils";
import { config } from "../global-settings";
import * as d3 from "d3";
import { renderViewModeSlider } from "./view-mode-slider";
import { renderHeader, updateHeader } from "./header";
import { renderDefs, updateDefs } from "./svg-defs";
import { RenderInfo, RenderState } from "../interfaces";

export async function renderGantt(
    parent: D3_SELECTION_SVGG,
    data: GanttData[],
    state: RenderState,
    tooltip: Tooltip,
    styling: StylingInfo,
    interactive: boolean,
    mod: Mod
) {
    const renderInfo: RenderInfo = {
        data: data,
        state: state,
        tooltip: tooltip,
        styling: styling,
        interactive: interactive,
        mod: mod
    };

    calculateUnitWidth(state);

    if (interactive) {
        renderViewModeSlider(parent, renderInfo);
        renderZoomSlider(parent, renderInfo);
    }

    renderHeader(parent, renderInfo);
    renderDefs(parent, renderInfo);
    const ganttContainer = parent.append("g").attr("id", "GanttContainer");
    const clipPath = ganttContainer
        .append("clipPath")
        .attr("id", "ChartClip")
        .append("rect")
        .attr("x", config.labelsWidth)
        .attr("y", 0)
        .attr("width", config.chartWidth)
        .attr("height", config.svgHeight);

    await renderBars(ganttContainer, renderInfo);
    renderLabels(ganttContainer, renderInfo);
    renderVerticalScroll(parent, renderInfo);
    renderTodayLine(parent, renderInfo);
}

export async function updateGantt(parent: D3_SELECTION, renderInfo: RenderInfo) {
    calculateUnitWidth(renderInfo.state);

    updateHeader(renderInfo);
    updateDefs(renderInfo);
    await updateBars(renderInfo);
    updateLabels(renderInfo);
    updateVerticalScroll(parent, renderInfo);
    updateTodayLine(renderInfo);
}

function calculateUnitWidth(state: RenderState) {
    let unitWidth = config.chartWidth / dateDiffInDays(state.startDate, state.endDate, true);

    const timeScale = d3
        .scaleTime()
        .domain([state.startDate, state.endDate])
        .range([config.labelsWidth, config.labelsWidth + config.chartWidth - unitWidth]);

    state.unitWidth = unitWidth;
    state.timeScale = timeScale;
}