/** Tunable scale-bar constants (constraint 8). Preference order is NOT editable. */

export const BAR_PX_TARGET = 120;
export const BAR_PX_MIN = 60;
export const BAR_PX_MAX = 180;
export const MIN_DRAG_PX = 12;

export const PLAIN_MIN = 0.001;
export const PLAIN_MAX = 5000;

export const NICE_MANTISSAS = [1, 2, 5];

/** Inch fractions before decimals at 0.01 (constraint 3a). */
export const INCH_FRACTIONS = [
    { value: 1 / 8, label: "1/8" },
    { value: 1 / 16, label: "1/16" },
    { value: 1 / 32, label: "1/32" },
];

/**
 * ~5% past incumbent band/bar edge to enter next unit (L2); tunable.
 * Consulted in resolveReading when incumbent is active — gates band/prefer
 * release only; does not override L3/L4 handoff or promoteNextGe1.
 */
export const HYSTERESIS_ENTER_PAST_EDGE = 0.05;

export const POPOVER_TABLE_AT = 12;
export const SET_SCALE_TABLE_AT = 22;

export const PLANCK_LENGTH_M = 1.616255e-35;

export const LADDER_IDS = {
    STANDARD_METRIC: "standard-metric",
    STANDARD_IMPERIAL: "standard-imperial",
    ULTRA_STANDARD_METRIC: "ultra-standard-metric",
    ULTRA_STANDARD_IMPERIAL: "ultra-standard-imperial",
    TRUE_METRIC: "true-metric",
};

/** Most → least preferred (bible §2). */
export const LADDER_PRIORITY = [
    LADDER_IDS.STANDARD_METRIC,
    LADDER_IDS.STANDARD_IMPERIAL,
    LADDER_IDS.ULTRA_STANDARD_METRIC,
    LADDER_IDS.ULTRA_STANDARD_IMPERIAL,
    LADDER_IDS.TRUE_METRIC,
];
