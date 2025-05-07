import { DataView, DataViewHierarchyNode, DataViewRow, ModProperty, Tooltip, Axis } from "spotfire/spotfire-api-1-2";
import { createScalePopout } from "./Components/popout";
import { messages } from "./custom-messages";
import { GanttData, ViewMode } from "./custom-types";
import { config } from "./global-settings";
import { RenderState, RenderInfo } from "./interfaces";
import { render } from "./render";
import { addDays, getMaxDate, getMinDate, increaseBrightness, _MS_PER_DAY } from "./utils";
var events = require("events");
import * as d3 from "d3";

const Spotfire = window.Spotfire;
const DEBUG = true;

Spotfire.initialize(async (mod) => {
    const context = mod.getRenderContext();

    /**
     * Create reader function which is actually a one time listener for the provided values.
     */
    const reader = mod.createReader(
        mod.visualization.data(),
        mod.visualization.axis("Color"),
        mod.windowSize(),
        mod.property<boolean>("overdue"),
        mod.property<boolean>("weekend"),
        mod.property<string>("plannedBarColor"),
        mod.property<string>("MobideoGanttDateFormat")
    );

    /**
     * Create a persistent state used by the rendering code
     */
    const state: RenderState = {
        preventRender: false,
        dataStartDate: undefined,
        dataEndDate: undefined,
        startDate: undefined,
        endDate: undefined,
        unitWidth: 40,
        timeScale: undefined,
        viewMode: undefined,
        verticalScrollPosition: -1,
        isEditing: false
    };

    /**
     * Creates a function that is part of the main read-render loop.
     * It checks for valid data and will print errors in case of bad data or bad renders.
     * It calls the listener (reader) created earlier and adds itself as a callback to complete the loop.
     */
    reader.subscribe(generalErrorHandler(mod, 20000)(onChange));

    /**
     * The function that is part of the main read-render loop.
     * It checks for valid data and will print errors in case of bad data or bad renders.
     * It calls the listener (reader) created earlier and adds itself as a callback to complete the loop.
     * @param {Spotfire.DataView} dataView
     * @param {Spotfire.Size} windowSize
     * @param {ModProperty<boolean>} overdue
     * @param {ModProperty<boolean>} weekend
     * @param {ModProperty<string>} plannedBarColor
     * @param {ModProperty<string>} dateFormat
     */
    async function onChange(
        dataView: DataView,
        colorAxis: Axis,
        windowsSize: Spotfire.Size,
        overdue: ModProperty<boolean>,
        weekend: ModProperty<boolean>,
        plannedBarColor: ModProperty<string>,
        dateFormat: ModProperty<string>
    ) {
        let root = await (await dataView.hierarchy("Task")).root();
        const tooltip: Tooltip = mod.controls.tooltip;

        if (!root.children) {
            mod.controls.errorOverlay.show("Empty visualization!", "DataView");
            return;
        }

        mod.controls.errorOverlay.hide("DataView");

        let tasks = buildTasks(root, dateFormat, tooltip, colorAxis, plannedBarColor);

        let minDate: Date;
        let maxDate: Date;
        tasks.forEach((v: GanttData) => {
            minDate = getMinDate(minDate, v.start);
            maxDate = getMaxDate(maxDate, v.end);
        });

        minDate = addDays(minDate, -5);
        maxDate = addDays(maxDate, 5);

        if (state.startDate === undefined || state.endDate === undefined) {
            state.startDate = minDate;
            state.endDate = maxDate;
            state.dataStartDate = minDate;
            state.dataEndDate = maxDate;
        }

        if (state.dataStartDate.getTime() !== minDate.getTime() || state.dataEndDate.getTime() !== maxDate.getTime()) {
            state.dataStartDate = minDate;
            state.dataEndDate = maxDate;
            state.startDate = minDate;
            state.endDate = maxDate;
        }

        if (!state.viewMode && state.viewMode !== 0) {
            state.viewMode = ViewMode.Day;
        }

        const styling = context.styling;
        state.isEditing = context.isEditing;

        if (context.isEditing) {
            var popoutClosedEventEmitter = new events.EventEmitter();
            config.onScaleClick = createScalePopout(mod.controls, overdue, weekend, popoutClosedEventEmitter);
        }

        config.showOverdue = overdue.value();
        config.showWeekend = weekend.value();

        const renderInfo: RenderInfo = {
            data: tasks,
            state,
            styling: context.styling,
            mod: mod,
            tooltip: mod.controls.tooltip,
            interactive: !context.isEditing
        };

        await render(
            tasks,
            dataView,
            state,
            state.dataStartDate,
            state.dataEndDate,
            mod.controls.tooltip,
            context.styling,
            windowsSize,
            !context.isEditing,
            mod
        );
        context.signalRenderComplete();

        mod.controls.errorOverlay.hide("General");
    }

    function getColor(node: DataViewHierarchyNode, root: DataViewHierarchyNode, hasColorExpression: boolean, isCategorical: boolean, isPlanned: boolean = false) {
        let color = config.defaultBarColor;

        const unmarkedRows = node.rows().filter((r) => !r.isMarked());

        if (node.leafIndex === undefined) {
            if (unmarkedRows.length > 0) {
                color = unmarkedRows[0].color().hexCode;
            } else {
                color = node.rows()[0].color().hexCode;
            }

            if (hasColorExpression) {
                if (isCategorical) {
                    const colorValue = node.rows()[0].categorical(isPlanned ? "PlannedBarColor" : "Color").value()[0].key;
                    const differentElements = node.rows().filter((r) => {
                        return r.categorical(isPlanned ? "PlannedBarColor" : "Color").value()[0].key !== colorValue;
                    }).length;
                    if (differentElements > 0) {
                        color = config.defaultBarColor;
                    }
                } else {
                    const colorValue = node.rows()[0].continuous(isPlanned ? "PlannedBarColor" : "Color").value();
                    const differentElements = node.rows().filter((r) => {
                        return r.continuous(isPlanned ? "PlannedBarColor" : "Color").value() !== colorValue;
                    }).length;
                    if (differentElements > 0) {
                        color = config.defaultBarColor;
                    }
                }
            }
        } else {
            color = node.rows()[0].color().hexCode;
        }

        if (
            root.markedRowCount() > 0 &&
            node.leafIndex === undefined &&
            !node.rows().every((r) => r.isMarked()) &&
            color === config.defaultBarColor
        ) {
            color = increaseBrightness(color, 80);
        }

        return color;
    }

    /**
     * Create Gantt task objects from each node in the Task hierarchy.
     * @param tasksRootNode The root node of the Task column hierarchy
     * @param dateFormat The date format property
     * @param tooltip The tooltip instance
     * @param colorAxis The color axis
     * @param plannedBarColor The planned bar color property
     */
    function buildTasks(
        tasksRootNode: DataViewHierarchyNode, 
        dateFormat: ModProperty<string>,
        tooltip: Tooltip,
        colorAxis: Axis,
        plannedBarColor: ModProperty<string>
    ): GanttData[] {
        let flattenedTasks: GanttData[] = [];

        tasksRootNode.children.forEach(addTasksFromHierarchyNode);

        return flattenedTasks;

        function addTasksFromHierarchyNode(node: DataViewHierarchyNode) {
            flattenedTasks.push(addTask(node, dateFormat));

            if (node.children) {
                node.children.slice().sort(sortNodes).forEach(addTasksFromHierarchyNode);
            }
        }

        function addTask(node: DataViewHierarchyNode, dateFormat: ModProperty<string>): GanttData {
            const rows = node.rows();

            let percent: number;
            let showProgress = true;
            let plannedStart: Date = null;
            let plannedEnd: Date = null;

            try {
                percent =
                    rows.reduce(
                        (tot, curr) =>
                            tot +
                            (curr.continuous("Progress").value() as number) *
                            ((curr.continuous("End").value() as Date).getTime() -
                                (curr.continuous("Start").value() as Date).getTime() || 1),
                        0
                    ) /
                    rows.reduce(
                        (tot, curr) =>
                            tot +
                            ((curr.continuous("End").value() as Date).getTime() -
                                (curr.continuous("Start").value() as Date).getTime() || 1),
                        0
                    );
                percent = Math.round(percent * 100) / 100;
            } catch (e) {
                percent = 1;
                showProgress = false;
            }

            try {
                plannedStart = rows[0].continuous("PlannedStart").value() as Date;
                plannedEnd = rows[0].continuous("PlannedEnd").value() as Date;
                
                if (!plannedStart || !plannedEnd) {
                    plannedStart = null;
                    plannedEnd = null;
                }
            } catch (e) {
                plannedStart = null;
                plannedEnd = null;
            }

            let startDates = node.rows()
                .map((r) => r.continuous("Start").value() as Date)
                .filter(date => date !== null && date instanceof Date);
            let endDates = node.rows()
                .map((r) => r.continuous("End").value() as Date)
                .filter(date => date !== null && date instanceof Date);

            startDates.sort((a, b) => a.getTime() - b.getTime());
            endDates.sort((a, b) => b.getTime() - a.getTime());

            return {
                id: `${node.level}-${node.key}`,
                x: 0,
                y: 0,
                heigth: 0,
                width: 0,
                showTooltip: () => {
                    tooltip.show(
                        [
                            node.formattedValue(),
                            "",
                            "Start date: " + startDates[0].toLocaleDateString(undefined, { 
                                month: "2-digit", 
                                day: "2-digit" 
                            }),
                            "End date: " + endDates[0].toLocaleDateString(undefined, { 
                                month: "2-digit", 
                                day: "2-digit" 
                            }),
                            showProgress ? "Progress: " + Math.round(percent * 100 * 100) / 100 + "%" : ""
                        ].join("\n")
                    );
                },
                hideTooltip: () => {
                    tooltip.hide();
                },
                mark: (ctrlKey) => {
                    ctrlKey ? node.mark("ToggleOrAdd") : node.mark();
                },
                text: "".repeat(node.level) + node.formattedValue(),
                level: node.level,
                percent: percent,
                start: startDates[0],
                end: endDates[0],
                isMarked: node.rows().every((r) => r.isMarked()),
                color: getColor(node, tasksRootNode, !!colorAxis.parts.length, colorAxis.isCategorical),
                plannedColor: plannedBarColor.value(),
                plannedStart: plannedStart,
                plannedEnd: plannedEnd
            };
        }
    }
});

function sortNodes(n1: DataViewHierarchyNode, n2: DataViewHierarchyNode): number {
    const sortRows = function (r1: DataViewRow, r2: DataViewRow) {
        return r1.continuous<Date>("Start").value()?.valueOf() - r2.continuous<Date>("Start").value()?.valueOf();
    };

    const start1 = n1.rows().sort(sortRows);
    const start2 = n2.rows().sort(sortRows);
    if (start1.length == 0 || start2.length == 0) {
        return 0;
    }

    return sortRows(start1[0], start2[0]);
}

/**
 * subscribe callback wrapper with general error handling, row count check and an early return when the data has become invalid while fetching it.
 *
 * The only requirement is that the dataview is the first argument.
 * @param mod - The mod API, used to show error messages.
 * @param rowLimit - Optional row limit.
 */
export function generalErrorHandler<T extends (dataView: Spotfire.DataView, ...args: any) => any>(
    mod: Spotfire.Mod,
    rowLimit = 2000
): (a: T) => T {
    return function (callback: T) {
        return async function callbackWrapper(dataView: Spotfire.DataView, ...args: any) {
            try {
                const errors = await dataView.getErrors();
                if (errors.length > 0) {
                    mod.controls.errorOverlay.hide("General");
                    mod.controls.errorOverlay.show(errors.concat(messages.InitialConfigurationHelper), "DataView");
                    return;
                }
                mod.controls.errorOverlay.hide("DataView");

                /**
                 * Hard abort if row count exceeds an arbitrary selected limit
                 */
                const rowCount = await dataView.rowCount();
                console.log("rowCount", rowCount);
                console.log("rowLimit", rowLimit);

                if (rowCount && rowCount > rowLimit) {
                    mod.controls.errorOverlay.show(
                        `☹️ Cannot render - too many rows (rowCount: ${rowCount}, limit: ${rowLimit}) `,
                        "General"
                    );
                    return;
                }

                /**
                 * User interaction while rows were fetched. Return early and respond to next subscribe callback.
                 */
                const allRows = await dataView.allRows();
                if (allRows == null) {
                    return;
                }

                await callback(dataView, ...args);

                mod.controls.errorOverlay.hide("General");
            } catch (e) {
                mod.controls.errorOverlay.show(
                    [e.message].concat(messages.InitialConfigurationHelper) ||
                    e ||
                    "☹️ Something went wrong, check developer console",
                    "General"
                );
                if (DEBUG) {
                    throw e;
                }
            }
        } as T;
    };
}
