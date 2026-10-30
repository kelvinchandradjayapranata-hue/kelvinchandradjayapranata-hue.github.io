/* ==========================================================================
   Homepage voice clip.

   The clip has no play button. Browsers refuse audible autoplay until the
   visitor has interacted with the page, so playback is attempted once on load
   (allowed only for visitors with an established media history) and again on
   the first interaction of any kind. When the clip actually starts, a small
   mute toggle appears in the hero; it is hidden again when the clip ends.
   Without JavaScript nothing plays and the toggle never appears.
   ========================================================================== */
(function () {
  "use strict";

  var audio = document.querySelector("[data-hero-voice]");
  var toggle = document.querySelector("[data-hero-voice-toggle]");
  if (!audio || !toggle || typeof audio.play !== "function") return;

  /* Every event a visitor can produce before they read the hero: mouse, pen,
     finger, keyboard and the wheel. Scroll and touch listeners stay passive. */
  var GESTURES = ["pointerdown", "touchstart", "keydown", "click", "scroll"];

  var armed = true;
  var starting = false;
  var i;

  function gestureOptions(type) {
    return (type === "touchstart" || type === "scroll") ? { passive: true } : false;
  }

  function disarm() {
    armed = false;
    for (var j = 0; j < GESTURES.length; j++) {
      document.removeEventListener(GESTURES[j], onGesture, gestureOptions(GESTURES[j]));
    }
  }

  function onPlaying() {
    disarm();
    toggle.hidden = false;
  }

  /* A rejected play() means the browser is still withholding permission; the
     listeners stay armed so the next interaction can try again. */
  function start() {
    if (starting) return;
    starting = true;
    var attempt = audio.play();
    if (attempt && typeof attempt.then === "function") {
      attempt.then(function () {
        starting = false;
      }, function () {
        starting = false;
      });
    } else {
      starting = false;
    }
  }

  function onGesture() {
    if (armed) start();
  }

  for (i = 0; i < GESTURES.length; i++) {
    document.addEventListener(GESTURES[i], onGesture, gestureOptions(GESTURES[i]));
  }

  audio.addEventListener("playing", onPlaying);

  audio.addEventListener("ended", function () {
    toggle.hidden = true;
    toggle.setAttribute("aria-pressed", "false");
    audio.muted = false;
  });

  toggle.addEventListener("click", function () {
    audio.muted = !audio.muted;
    toggle.setAttribute("aria-pressed", audio.muted ? "true" : "false");
  });

  start();
})();
