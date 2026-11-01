/* ==========================================================================
   Project windows — hover enhancement for projects.html
   ==========================================================================

   On devices with a real pointer, pointing at the outer Projects window opens
   it so the two project windows appear below without a click. The native
   <details> summary still handles click, keyboard, and touch, so the page
   works without this file.

   Hovering only opens. Closing stays with the native summary toggle, so the
   two behaviours never fight each other while the pointer is inside. */

(function () {
  "use strict";

  var outer = document.querySelector("[data-project-windows]");
  if (!outer || outer.tagName !== "DETAILS") {
    return;
  }

  var canHover =
    window.matchMedia && window.matchMedia("(hover: hover)").matches;
  if (!canHover) {
    return;
  }

  outer.addEventListener("pointerenter", function () {
    if (!outer.open) {
      outer.open = true;
    }
  });
})();
