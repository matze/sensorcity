// German number formatting shared by the list, detail card, map and chart.

export const formatFixed = (value, digits) => value.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
});
