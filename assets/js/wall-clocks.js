/* ==========================================================================
   Homepage wall clocks — Xi'an, China and Western Indonesia Time (WIB).

   Each figure in the markup carries its IANA time zone and its UTC offset.
   The SVG hands are groups rotated around the dial centre once per second,
   and the digital time under each dial stays in sync for sighted readers
   and screen readers alike.

   Asia/Shanghai and Asia/Jakarta both use fixed offsets with no daylight
   saving, so if Intl time-zone support is missing the clocks still work from
   the offset alone.

   The clocks are additive: without JavaScript the hands stay in their static
   10:10 pose and the rest of the page is unaffected.
   ========================================================================== */
(function () {
  "use strict";

  var figures = document.querySelectorAll("[data-clock]");
  if (!figures.length) return;

  var formatters = {};
  var partsSupported =
    typeof Intl !== "undefined" &&
    typeof Intl.DateTimeFormat === "function" &&
    typeof Intl.DateTimeFormat.prototype.formatToParts === "function";

  var clocks = [];
  var i;

  for (i = 0; i < figures.length; i++) {
    var figure = figures[i];
    clocks.push({
      zone: figure.getAttribute("data-zone"),
      offset: parseFloat(figure.getAttribute("data-offset")) || 0,
      hourHand: figure.querySelector('[data-hand="hour"]'),
      minuteHand: figure.querySelector('[data-hand="minute"]'),
      secondHand: figure.querySelector('[data-hand="second"]'),
      digital: figure.querySelector("[data-clock-digital]")
    });
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  /* Reads the wall time in the figure's zone. The Intl path handles any
     future rule change; the fixed-offset path is the fallback. */
  function timeParts(clock, now) {
    if (partsSupported) {
      try {
        var formatter = formatters[clock.zone];
        if (!formatter) {
          formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: clock.zone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
          });
          formatters[clock.zone] = formatter;
        }

        var parts = formatter.formatToParts(now);
        var hour = 0;
        var minute = 0;
        var second = 0;
        for (var j = 0; j < parts.length; j++) {
          if (parts[j].type === "hour") hour = parseInt(parts[j].value, 10) % 24;
          else if (parts[j].type === "minute") minute = parseInt(parts[j].value, 10);
          else if (parts[j].type === "second") second = parseInt(parts[j].value, 10);
        }
        if (isFinite(hour) && isFinite(minute) && isFinite(second)) {
          return { hour: hour, minute: minute, second: second };
        }
      } catch (error) {
        partsSupported = false;
      }
    }

    var shifted = new Date(now.getTime() + clock.offset * 3600000);
    return {
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds()
    };
  }

  function rotate(hand, degrees) {
    if (hand) {
      hand.setAttribute(
        "transform",
        "rotate(" + Math.round(degrees * 1000) / 1000 + " 100 100)"
      );
    }
  }

  function update() {
    var now = new Date();
    for (var k = 0; k < clocks.length; k++) {
      var clock = clocks[k];
      var time = timeParts(clock, now);

      rotate(clock.hourHand,
        (time.hour % 12 + time.minute / 60 + time.second / 3600) * 30);
      rotate(clock.minuteHand, (time.minute + time.second / 60) * 6);
      rotate(clock.secondHand, time.second * 6);

      if (clock.digital) {
        clock.digital.textContent =
          pad(time.hour) + ":" + pad(time.minute) + ":" + pad(time.second);
      }
    }
  }

  update();

  /* Align the tick to the second boundary so the hands change with the clock
     on the wall rather than drifting between updates. */
  window.setTimeout(function () {
    update();
    window.setInterval(update, 1000);
  }, 1000 - (Date.now() % 1000));
})();
