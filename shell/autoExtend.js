// SPDX-License-Identifier: GPL-3.0-or-later
//
// When to renew the SSO session automatically (`netbird login --extend`).
// Pure, no Shell imports.

// Lead time used when the expiry warning is disabled (0 minutes).
const DEFAULT_LEAD_MINUTES = 10;

/**
 * @param {number} warningMinutes - the expiry-warning-minutes setting
 * @returns {number} seconds before the deadline to renew
 */
export function autoExtendLeadSeconds(warningMinutes) {
    return (warningMinutes || DEFAULT_LEAD_MINUTES) * 60;
}

/**
 * True when an automatic renewal should start now. One attempt per
 * session deadline: a failed or ignored attempt is not retried.
 *
 * @param {object} state - current state
 * @param {boolean} state.enabled - auto-extend setting
 * @param {boolean} state.connected - NetBird is connected
 * @param {number|null} state.secondsLeft - until the session deadline
 * @param {number} state.leadSeconds - renew this long before the deadline
 * @param {string} state.deadline - current sessionExpiresAt
 * @param {string|null} state.lastAttemptDeadline - deadline of the last attempt
 * @returns {boolean}
 */
export function autoExtendDue({
    enabled, connected, secondsLeft, leadSeconds, deadline, lastAttemptDeadline,
}) {
    return enabled && connected && secondsLeft !== null && secondsLeft > 0 &&
        secondsLeft <= leadSeconds && deadline !== lastAttemptDeadline;
}
