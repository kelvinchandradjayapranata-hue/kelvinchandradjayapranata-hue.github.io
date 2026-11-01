/* ==========================================================================
   Hero character — transparent PixVerse clip on the home page
   ==========================================================================

   The poster is the complete no-script state. The clip loads only on wide
   screens and only when the visitor has not asked for reduced motion, so
   phones never download it and motion-sensitive visitors keep the still.

   The WebM carries a VP9 alpha channel. Browsers that cannot decode it keep
   showing the poster; WebKit-based browsers are skipped because they play
   VP9 but do not composite its alpha, which would show a green box. */

(function () {
  "use strict";

  var video = document.querySelector("[data-hero-character]");
  if (!video) {
    return;
  }

  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var wide = window.matchMedia && window.matchMedia("(min-width: 78rem)");

  var ua = navigator.userAgent || "";
  var webkitOnly =
    /AppleWebKit/.test(ua) &&
    !/(Chrome|CriOS|Chromium|Edg|EdgiOS|OPR|FxiOS|Firefox)/.test(ua);

  if (!wide || !wide.matches || webkitOnly || (reduce && reduce.matches)) {
    return;
  }

  video.src = "assets/video/hero-character.webm";

  var playback = video.play();
  if (playback && typeof playback.catch === "function") {
    playback.catch(function () {
      /* Keep the poster if autoplay is refused. */
    });
  }
})();
