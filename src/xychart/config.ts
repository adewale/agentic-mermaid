import type {
  ResolvedXYAxisRenderConfig,
  ResolvedXYChartConfig,
  XYAxisRenderConfig,
  XYChartConfig,
} from './types.ts'

export const DEFAULT_XY_AXIS_CONFIG: ResolvedXYAxisRenderConfig = {
  showLabel: true,
  labelFontSize: 14,
  labelPadding: 5,
  showTitle: true,
  titleFontSize: 16,
  titlePadding: 5,
  showTick: true,
  tickLength: 5,
  tickWidth: 2,
  showAxisLine: true,
  axisLineWidth: 2,
}

export const DEFAULT_XY_CHART_CONFIG: ResolvedXYChartConfig = {
  width: 700,
  height: 500,
  useMaxWidth: true,
  useWidth: undefined,
  titleFontSize: 20,
  titlePadding: 10,
  chartOrientation: 'vertical',
  plotReservedSpacePercent: 50,
  showDataLabel: false,
  showTitle: true,
  showLegend: true,
  legendFontSize: 14,
  legendPadding: 5,
  xAxis: { ...DEFAULT_XY_AXIS_CONFIG },
  yAxis: { ...DEFAULT_XY_AXIS_CONFIG },
}

export function resolveXYAxisRenderConfig(config?: XYAxisRenderConfig): ResolvedXYAxisRenderConfig {
  return {
    showLabel: getBoolean(config?.showLabel, DEFAULT_XY_AXIS_CONFIG.showLabel),
    labelFontSize: getPositiveNumber(config?.labelFontSize, DEFAULT_XY_AXIS_CONFIG.labelFontSize),
    labelPadding: getNonNegativeNumber(config?.labelPadding, DEFAULT_XY_AXIS_CONFIG.labelPadding),
    showTitle: getBoolean(config?.showTitle, DEFAULT_XY_AXIS_CONFIG.showTitle),
    titleFontSize: getPositiveNumber(config?.titleFontSize, DEFAULT_XY_AXIS_CONFIG.titleFontSize),
    titlePadding: getNonNegativeNumber(config?.titlePadding, DEFAULT_XY_AXIS_CONFIG.titlePadding),
    showTick: getBoolean(config?.showTick, DEFAULT_XY_AXIS_CONFIG.showTick),
    tickLength: getNonNegativeNumber(config?.tickLength, DEFAULT_XY_AXIS_CONFIG.tickLength),
    tickWidth: getPositiveNumber(config?.tickWidth, DEFAULT_XY_AXIS_CONFIG.tickWidth),
    showAxisLine: getBoolean(config?.showAxisLine, DEFAULT_XY_AXIS_CONFIG.showAxisLine),
    axisLineWidth: getPositiveNumber(config?.axisLineWidth, DEFAULT_XY_AXIS_CONFIG.axisLineWidth),
  }
}

export function resolveXYChartRenderConfig(config: XYChartConfig): ResolvedXYChartConfig {
  return {
    width: getPositiveNumber(config.width, DEFAULT_XY_CHART_CONFIG.width),
    height: getPositiveNumber(config.height, DEFAULT_XY_CHART_CONFIG.height),
    useMaxWidth: getBoolean(config.useMaxWidth, DEFAULT_XY_CHART_CONFIG.useMaxWidth),
    useWidth: getOptionalPositiveNumber(config.useWidth),
    titleFontSize: getPositiveNumber(config.titleFontSize, DEFAULT_XY_CHART_CONFIG.titleFontSize),
    titlePadding: getNonNegativeNumber(config.titlePadding, DEFAULT_XY_CHART_CONFIG.titlePadding),
    chartOrientation: config.chartOrientation === 'vertical' || config.chartOrientation === 'horizontal'
      ? config.chartOrientation
      : DEFAULT_XY_CHART_CONFIG.chartOrientation,
    plotReservedSpacePercent: getBoundedPositiveNumber(
      config.plotReservedSpacePercent,
      DEFAULT_XY_CHART_CONFIG.plotReservedSpacePercent,
      10,
      100,
    ),
    showDataLabel: getBoolean(config.showDataLabel, DEFAULT_XY_CHART_CONFIG.showDataLabel),
    showTitle: getBoolean(config.showTitle, DEFAULT_XY_CHART_CONFIG.showTitle),
    showLegend: getBoolean(config.showLegend, DEFAULT_XY_CHART_CONFIG.showLegend),
    legendFontSize: getPositiveNumber(config.legendFontSize, DEFAULT_XY_CHART_CONFIG.legendFontSize),
    legendPadding: getNonNegativeNumber(config.legendPadding, DEFAULT_XY_CHART_CONFIG.legendPadding),
    xAxis: resolveXYAxisRenderConfig(config.xAxis),
    yAxis: resolveXYAxisRenderConfig(config.yAxis),
  }
}

function getPositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function getNonNegativeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function getOptionalPositiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function getBoundedPositiveNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum
    ? Math.max(minimum, value)
    : fallback
}

function getBoolean(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
