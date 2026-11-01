/* ==========================================================================
   Project windows — projects.html
   ==========================================================================

   Two enhancements on top of the native <details> behaviour:

   1. On devices with a real pointer, pointing at the outer Projects window
      opens it, so the two project windows appear below without a click.
      Hovering never closes it; closing stays with the summary toggle.
   2. A link such as projects.html#melanin-biotech opens the outer window and
      the named project window, then brings it into view.

   Without this file the hash still reaches the window title and the visitor
   opens it with the native summary. */

(function () {
  "use strict";

  var outer = document.querySelector("[data-project-windows]");
  var canHover =
    window.matchMedia && window.matchMedia("(hover: hover)").matches;

  if (outer && canHover) {
    outer.addEventListener("pointerenter", function () {
      if (!outer.open) {
        outer.open = true;
      }
    });
  }

  var id = window.location.hash.slice(1);
  if (!id) {
    return;
  }

  var target;
  try {
    target = document.getElementById(decodeURIComponent(id));
  } catch (error) {
    return;
  }

  if (!target || target.tagName !== "DETAILS") {
    return;
  }

  var node = target;
  while (node) {
    if (node.tagName === "DETAILS") {
      node.open = true;
    }
    node = node.parentElement ? node.parentElement.closest("details") : null;
  }

  target.scrollIntoView({ block: "start" });
})();
