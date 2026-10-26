/* ==========================================================================
   Countdown to 17 January 2027.

   Counts calendar days in Xi'an time (UTC+8, no daylight saving). The
   number changes at Xi'an midnight. No network, storage, or third-party
   code is involved; the target date stays visible in the markup if
   scripting is unavailable.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.querySelector("[data-countdown]");
  if (!root) return;

  var output = root.querySelector("[data-countdown-days]");
  if (!output) return;

  // Use date-only values at UTC midnight; only year/month/day matter.
  var OFFSET = 8 * 60 * 60 * 1000;
  var TARGET_DATE = Date.UTC(2027, 0, 17);
  var DAY = 24 * 60 * 60 * 1000;
  var timer = 0;

  function daysLeft() {
    var xiNow = new Date(Date.now() + OFFSET);
    var today = Date.UTC(xiNow.getUTCFullYear(), xiNow.getUTCMonth(), xiNow.getUTCDate());
    return Math.max(0, Math.round((TARGET_DATE - today) / DAY));
  }

  function render() {
    output.textContent = String(daysLeft());
  }

  function schedule() {
    window.clearTimeout(timer);
    var now = Date.now();
    var xiNow = new Date(now + OFFSET);
    var nextMidnight = Date.UTC(
      xiNow.getUTCFullYear(),
      xiNow.getUTCMonth(),
      xiNow.getUTCDate() + 1
    ) - OFFSET + 1000;
    timer = window.setTimeout(function () {
      render();
      schedule();
    }, Math.max(1000, nextMidnight - now));
  }

  render();
  schedule();

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      render();
      schedule();
    }
  });
})();
