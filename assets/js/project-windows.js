/* ==========================================================================
   Project windows — deep links on projects.html
   ==========================================================================

   A link such as projects.html#melanin-biotech opens the outer Projects
   window and the named project window, then brings it into view. Without
   this file the hash still reaches the window title; the visitor just opens
   it with the native <details> summary. */

(function () {
  "use strict";

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
