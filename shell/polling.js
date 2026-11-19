// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pure polling interval logic (testable, no GLib/Shell imports).

/**
 * Decide the polling interval based on UI state and recent activity.
 *
 * @param {object} opts
 * @param {number} opts.configured - Base poll interval in seconds
 * @param {boolean} opts.menuOpen - Whether the menu is currently open
 * @param {number} opts.secondsSinceAction - Seconds since the last action
 * @returns {number} Interval in seconds
 */
export function pollIntervalSeconds({configured, menuOpen, secondsSinceAction}) {
    if (menuOpen || secondsSinceAction < 30)
        return Math.min(configured, 2);
    return configured;
}
