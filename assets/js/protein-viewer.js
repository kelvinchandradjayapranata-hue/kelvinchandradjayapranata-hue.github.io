/* ==========================================================================
   Protein viewer — ubiquitin, ai-biotech project window
   ==========================================================================

   A small, lazy bridge to 3Dmol.js. Nothing is downloaded until the visitor
   opens the ai-biotech window: the library (assets/vendor/3Dmol-min.js) and
   the structure (assets/data/ubiquitin-alphafold.cif) load on first open.

   The structure is an AlphaFold Server prediction. The default view is the
   cyan/gold secondary-structure theme; the controls add pLDDT and rainbow
   colouring, stick and line representations, and an optional solvent-excluded
   (SES) molecular surface.

   pLDDT bands follow the AlphaFold convention and are read from the CA atom
   B-factor column:

     >= 90        very high   #0053d6
     70 - 89.99   confident   #65cbf3
     50 - 69.99   low         #ffdb13
     < 50         very low    #ff7d45

   Clicking a residue highlights it in magenta and fills the selection panel
   with the residue name, number, chain, and CA pLDDT. No binding pockets or
   functional annotations are inferred: the surface is only a solvent-excluded
   envelope, and the structure is a prediction, not an experiment.

   Surface cost grows with atom count. At 602 atoms the SES surface takes
   roughly 0.3-0.45 s in Chromium here. SURFACE_ATOM_LIMIT (4,000 atoms, about
   6.6x that structure) is a convenience safeguard, not a scientific limit:
   above it, the visitor must select Surface a second time before the geometry
   is generated, and the status line explains why.

   WebGL implementations cap line width at about one pixel, so the Line
   representation is drawn as very thin cylinders (radius 0.07 A) on the same
   bonds instead of GL lines. That keeps a visible, consistent width at every
   zoom level without moving or altering any atom.

   If WebGL is unavailable, or either file cannot be fetched, the canvas is
   replaced by a plain notice and no error is shown to the visitor. */

(function () {
  "use strict";

  var root = document.querySelector("[data-protein-viewer]");
  if (!root) return;

  var host = root.querySelector("[data-protein-viewer-canvas]");
  var status = root.querySelector("[data-protein-viewer-status]");
  var fallback = root.querySelector("[data-protein-viewer-fallback]");
  var fallbackText = root.querySelector("[data-protein-viewer-fallback-text]");
  var resetButton = root.querySelector("[data-protein-viewer-reset]");
  var controls = root.querySelectorAll("[data-rep], [data-color]");
  var legendGroups = root.querySelectorAll("[data-legend]");
  var selectionEmpty = root.querySelector("[data-protein-viewer-selection-empty]");
  var selectionFacts = root.querySelector("[data-protein-viewer-selection-facts]");
  var clearButton = root.querySelector("[data-protein-viewer-clear]");
  var residueSelect = root.querySelector("[data-protein-viewer-residue]");
  var field = {
    resn: root.querySelector("[data-selection-resn]"),
    resi: root.querySelector("[data-selection-resi]"),
    chain: root.querySelector("[data-selection-chain]"),
    plddt: root.querySelector("[data-selection-plddt]")
  };
  var source = root.getAttribute("data-structure");

  var ONE_LETTER = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
    GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
    PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
  };

  var viewer = null;
  var initialView = null;
  var state = "idle";
  var rep = "cartoon";
  var colorMode = "theme";
  var selected = null;
  var residueRange = { min: 1, max: 76 };
  var plddtByResidue = {};
  var atomCount = 0;
  var surfaceToken = 0;
  var surfaceBusy = false;
  var surfaceReady = false;
  var surfacePending = false;

  /* About 6.6x the 602-atom ubiquitin structure. Surface time grows with the
     atom count and the envelope it sweeps, so this is where a one-click
     computation stops being predictably quick; above it the UI asks first. */
  var SURFACE_ATOM_LIMIT = 4000;

  function hasWebGL() {
    try {
      var canvas = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
    } catch (error) {
      return false;
    }
  }

  function setStatus(text) {
    if (!status) return;
    if (text) {
      status.textContent = text;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  }

  function showFallback(message) {
    state = "failed";
    setStatus(null);
    if (host) host.hidden = true;
    if (fallback) fallback.hidden = false;
    if (fallbackText && message) fallbackText.textContent = message;
    if (resetButton) resetButton.disabled = true;
    root.classList.add("is-failed");
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("script")); };
      document.head.appendChild(script);
    });
  }

  /* --- Colouring --------------------------------------------------------- */

  function hslToInt(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    var to255 = function (v) { return Math.round((v + m) * 255); };
    return (to255(r) << 16) | (to255(g) << 8) | to255(b);
  }

  function themeColor(atom) {
    if (atom.ss === "h") return 0x3fe0d0;
    if (atom.ss === "s") return 0xf3c76b;
    return 0x6f9fb5;
  }

  function plddtColor(atom) {
    /* Colour every representation by the residue's CA pLDDT, so a stick or
       line view reads the same confidence band as the ribbon view. */
    var b = plddtByResidue[atom.resi];
    if (typeof b !== "number") b = atom.b;
    if (typeof b !== "number") return 0x8fa9b5;
    if (b >= 90) return 0x0053d6;
    if (b >= 70) return 0x65cbf3;
    if (b >= 50) return 0xffdb13;
    return 0xff7d45;
  }

  function rainbowColor(atom) {
    var span = residueRange.max - residueRange.min;
    var t = span > 0 ? (atom.resi - residueRange.min) / span : 0;
    return hslToInt(240 * (1 - t), 0.85, 0.62);
  }

  function colourFn() {
    if (colorMode === "plddt") return plddtColor;
    if (colorMode === "rainbow") return rainbowColor;
    return themeColor;
  }

  /* The theme loop colour is deliberately brighter in Line mode: a one-pixel
     line loses contrast against the navy panel at the darker steel value. */
  function lineColour(atom) {
    if (colorMode === "theme") {
      if (atom.ss === "h") return 0x3fe0d0;
      if (atom.ss === "s") return 0xf3c76b;
      return 0x8fb8c6;
    }
    if (colorMode === "plddt") return plddtColor(atom);
    return rainbowColor(atom);
  }

  /* --- Styling ----------------------------------------------------------- */

  function baseStyle() {
    var colour = colourFn();
    if (rep === "stick") {
      return { stick: { colorfunc: colour, radius: 0.16 } };
    }
    if (rep === "line") {
      /* Thin cylinders rather than GL lines: most WebGL implementations cap
         line width at 1 px, which reads as a dim hairline on this panel. */
      return { stick: { colorfunc: lineColour, radius: 0.07 } };
    }
    return { cartoon: { colorfunc: colour } };
  }

  function highlightStyle() {
    return {
      stick: { color: 0xff4fd8, radius: 0.16 },
      sphere: { color: 0xff4fd8, radius: 0.22, opacity: 0.9 }
    };
  }

  function applyStyle() {
    if (!viewer) return;
    viewer.setStyle({}, baseStyle());
    if (selected) {
      viewer.addStyle({ chain: selected.chain, resi: selected.resi }, highlightStyle());
    }
    viewer.render();
  }

  /* --- Surface (optional, computed on demand) ---------------------------- */

  function removeSurface() {
    surfaceToken += 1;
    surfaceBusy = false;
    surfaceReady = false;
    surfacePending = false;
    if (state === "ready") setStatus(null);
    if (!viewer) return;
    try {
      viewer.removeAllSurfaces();
      viewer.render();
    } catch (error) {
      /* Nothing to remove. */
    }
  }

  function addSurface(confirmed) {
    if (!viewer || surfaceBusy || surfaceReady) return;

    if (!confirmed && atomCount > SURFACE_ATOM_LIMIT) {
      surfacePending = true;
      setStatus(
        "This structure has " + atomCount.toLocaleString() + " atoms, above the " +
        SURFACE_ATOM_LIMIT.toLocaleString() + "-atom surface safeguard. " +
        "Generating the surface may take several seconds. Select Surface again " +
        "to continue."
      );
      return;
    }

    surfacePending = false;
    var token = ++surfaceToken;
    surfaceBusy = true;
    setStatus("Computing molecular surface…");

    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      surfaceBusy = false;
      if (token !== surfaceToken) {
        try { viewer.removeAllSurfaces(); viewer.render(); } catch (error) {}
        return;
      }
      surfaceReady = true;
      if (state === "ready") setStatus(null);
      viewer.render();
    };

    try {
      viewer.addSurface(
        window.$3Dmol.SurfaceType.SES,
        { opacity: 0.36, color: 0x6fe6dd },
        {}, null, null, finish
      );
    } catch (error) {
      finish();
    }
    // Safety net if the surface callback never arrives.
    window.setTimeout(finish, 8000);
  }

  /* --- Representation and colouring -------------------------------------- */

  function updatePressed() {
    var i;
    for (i = 0; i < controls.length; i++) {
      var button = controls[i];
      var active = button.hasAttribute("data-rep")
        ? button.getAttribute("data-rep") === rep
        : button.getAttribute("data-color") === colorMode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function updateLegend() {
    var i;
    for (i = 0; i < legendGroups.length; i++) {
      var group = legendGroups[i];
      group.hidden = group.getAttribute("data-legend") !== colorMode;
    }
  }

  function setRep(next) {
    if (rep === next) {
      /* The second Surface click confirms a structure above the safeguard. */
      if (next === "surface" && surfacePending) addSurface(true);
      return;
    }
    rep = next;
    updatePressed();
    if (!viewer) return;
    if (rep === "surface") {
      applyStyle();
      addSurface(false);
    } else {
      removeSurface();
      applyStyle();
    }
  }

  function setColor(next) {
    if (colorMode === next) return;
    colorMode = next;
    updatePressed();
    updateLegend();
    applyStyle();
  }

  /* --- Selection --------------------------------------------------------- */

  function bandFor(b) {
    if (b >= 90) return "very high";
    if (b >= 70) return "confident";
    if (b >= 50) return "low";
    return "very low";
  }

  /* The selector is built from the residues actually present in the loaded
     mmCIF. Nothing is inferred or hard-coded. */
  function populateResidues() {
    if (!residueSelect || !viewer) return;

    var list = [];
    var seen = {};
    try {
      var atoms = viewer.selectedAtoms({ atom: "CA" });
      if (!atoms.length) atoms = viewer.selectedAtoms({});
      for (var i = 0; i < atoms.length; i++) {
        var atom = atoms[i];
        if (typeof atom.resi !== "number" || !atom.resn) continue;
        var chain = atom.chain || "";
        var key = chain + ":" + atom.resi;
        if (seen[key]) continue;
        seen[key] = true;
        list.push({ chain: chain, resi: atom.resi, resn: atom.resn });
      }
    } catch (error) {
      return;
    }
    if (!list.length) return;

    list.sort(function (a, b) {
      if (a.chain < b.chain) return -1;
      if (a.chain > b.chain) return 1;
      return a.resi - b.resi;
    });

    while (residueSelect.firstChild) {
      residueSelect.removeChild(residueSelect.firstChild);
    }

    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a residue…";
    residueSelect.appendChild(placeholder);

    for (var j = 0; j < list.length; j++) {
      var residue = list[j];
      var letter = ONE_LETTER[residue.resn];
      var option = document.createElement("option");
      option.value = residue.chain + ":" + residue.resi;
      option.textContent = residue.resn + (letter ? " (" + letter + ")" : "") +
        " " + residue.resi + " · chain " + (residue.chain || "—");
      residueSelect.appendChild(option);
    }

    residueSelect.disabled = false;
  }

  function syncSelect() {
    if (!residueSelect) return;
    residueSelect.value = selected
      ? selected.chain + ":" + selected.resi
      : "";
  }

  function renderSelection() {
    if (!selectionEmpty || !selectionFacts || !clearButton) return;
    syncSelect();

    if (!selected) {
      selectionEmpty.hidden = false;
      selectionFacts.hidden = true;
      clearButton.disabled = true;
      /* Remove the old residue text so a cleared panel cannot be read as a
         current selection by any assistive technology. */
      if (field.resn) field.resn.textContent = "—";
      if (field.resi) field.resi.textContent = "—";
      if (field.chain) field.chain.textContent = "—";
      if (field.plddt) field.plddt.textContent = "—";
      return;
    }

    selectionEmpty.hidden = true;
    selectionFacts.hidden = false;
    clearButton.disabled = false;

    var letter = ONE_LETTER[selected.resn];
    if (field.resn) {
      field.resn.textContent = selected.resn + (letter ? " (" + letter + ")" : "");
    }
    if (field.resi) field.resi.textContent = String(selected.resi);
    if (field.chain) field.chain.textContent = selected.chain;
    if (field.plddt) {
      field.plddt.textContent = selected.plddt === null
        ? "not available"
        : selected.plddt.toFixed(2) + " · " + bandFor(selected.plddt);
    }
  }

  function selectResidue(chain, resi) {
    if (!viewer || typeof resi !== "number" || !isFinite(resi)) return;

    /* Re-selecting the same residue is a no-op, so the live region does not
       repeat an unchanged announcement. */
    if (selected && selected.chain === chain && selected.resi === resi) {
      syncSelect();
      return;
    }

    var resn = "?";
    var plddt = null;
    try {
      var ca = viewer.selectedAtoms({ chain: chain, resi: resi, atom: "CA" });
      if (ca.length) {
        if (ca[0].resn) resn = ca[0].resn;
        if (typeof ca[0].b === "number") plddt = ca[0].b;
      }
      if (resn === "?") {
        var any = viewer.selectedAtoms({ chain: chain, resi: resi });
        if (any.length && any[0].resn) resn = any[0].resn;
      }
    } catch (error) {
      /* Keep the placeholder values. */
    }

    selected = {
      chain: chain,
      resi: resi,
      resn: resn,
      plddt: plddt
    };
    applyStyle();
    renderSelection();
  }

  function selectAtom(atom) {
    if (!atom || typeof atom.resi !== "number") return;
    selectResidue(atom.chain, atom.resi);
  }

  function clearSelection() {
    if (!selected) return;
    selected = null;
    applyStyle();
    renderSelection();
  }

  /* --- Camera ------------------------------------------------------------ */

  function resetView() {
    if (!viewer) return;
    if (initialView) {
      viewer.setView(initialView.slice());
    } else {
      viewer.zoomTo();
    }
    viewer.render();
  }

  function resize() {
    if (!viewer) return;
    viewer.resize();
    viewer.render();
  }

  /* --- Init -------------------------------------------------------------- */

  function init(cifText) {
    viewer = window.$3Dmol.createViewer(host, {
      backgroundColor: 0x08111c,
      antialias: true
    });

    viewer.addModel(cifText, "cif");

    try {
      var atoms = viewer.selectedAtoms({});
      atomCount = atoms.length;
      var min = Infinity, max = -Infinity;
      for (var i = 0; i < atoms.length; i++) {
        if (typeof atoms[i].resi === "number") {
          if (atoms[i].resi < min) min = atoms[i].resi;
          if (atoms[i].resi > max) max = atoms[i].resi;
        }
      }
      if (isFinite(min) && isFinite(max) && max >= min) {
        residueRange = { min: min, max: max };
      }
    } catch (error) {
      /* Keep the documented 1..76 fallback. */
    }

    try {
      var caAtoms = viewer.selectedAtoms({ atom: "CA" });
      for (var j = 0; j < caAtoms.length; j++) {
        if (typeof caAtoms[j].b === "number") {
          plddtByResidue[caAtoms[j].resi] = caAtoms[j].b;
        }
      }
    } catch (error) {
      /* Fall back to each atom's own B-factor. */
    }

    populateResidues();

    applyStyle();
    viewer.zoomTo();
    viewer.render();
    initialView = viewer.getView().slice();

    viewer.setClickable({}, true, function (atom) {
      selectAtom(atom);
    });

    /* 3Dmol's own click path can miss a tap on touch screens. Treat a short,
       still touch as a click and run the same raycast selection. Mouse input
       keeps using 3Dmol's handler, so nothing is selected twice. */
    var tap = null;
    host.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "touch") return;
      tap = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
        id: event.pointerId
      };
    });
    host.addEventListener("pointerup", function (event) {
      if (event.pointerType !== "touch" || !tap || tap.id !== event.pointerId) {
        return;
      }
      var dx = Math.abs(event.clientX - tap.x);
      var dy = Math.abs(event.clientY - tap.y);
      var duration = Date.now() - tap.time;
      tap = null;
      if (dx > 8 || dy > 8 || duration > 600) return;

      try {
        var point = viewer.mouseXY(
          event.clientX + window.pageXOffset,
          event.clientY + window.pageYOffset
        );
        viewer.handleClickSelection(point.x, point.y, event);
      } catch (error) {
        /* Leave the selection unchanged. */
      }
    });
    host.addEventListener("pointercancel", function () {
      tap = null;
    });

    state = "ready";
    setStatus(null);
    if (resetButton) resetButton.disabled = false;
    for (var c = 0; c < controls.length; c++) controls[c].disabled = false;
    updatePressed();
    updateLegend();
    renderSelection();
    root.classList.add("is-ready");

    if ("ResizeObserver" in window) {
      var observer = new ResizeObserver(resize);
      observer.observe(host);
    } else {
      window.addEventListener("resize", resize);
    }
  }

  function loadViewer() {
    if (state !== "idle") return;

    if (!hasWebGL()) {
      showFallback("This browser does not provide WebGL, so the interactive " +
        "3D view is unavailable. The structure facts are listed below.");
      return;
    }

    state = "loading";
    setStatus("Loading structure…");

    loadScript("assets/vendor/3Dmol-min.js")
      .then(function () {
        return fetch(source, { credentials: "same-origin" });
      })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (text) {
        if (text.indexOf("_atom_site") === -1) {
          throw new Error("Unexpected structure file");
        }
        init(text);
      })
      .catch(function () {
        showFallback("The 3D view could not load. The structure facts are " +
          "still listed below.");
      });
  }

  /* --- Wiring ------------------------------------------------------------ */

  var i;
  for (i = 0; i < controls.length; i++) {
    (function (button) {
      button.addEventListener("click", function () {
        if (button.hasAttribute("data-rep")) {
          setRep(button.getAttribute("data-rep"));
        } else {
          setColor(button.getAttribute("data-color"));
        }
      });
    })(controls[i]);
  }

  if (resetButton) resetButton.addEventListener("click", resetView);
  if (clearButton) {
    clearButton.addEventListener("click", function (event) {
      clearSelection();
      /* A keyboard-activated click has detail 0. Keep focus in the panel
         instead of letting it fall to the document when the button disables. */
      if (event.detail === 0 && residueSelect && !residueSelect.disabled) {
        residueSelect.focus();
      }
    });
  }

  if (residueSelect) {
    residueSelect.addEventListener("change", function () {
      var value = residueSelect.value;
      if (!value) {
        clearSelection();
        return;
      }
      var split = value.indexOf(":");
      if (split < 0) return;
      var chain = value.slice(0, split);
      var resi = parseInt(value.slice(split + 1), 10);
      if (!isFinite(resi)) return;
      selectResidue(chain, resi);
    });
  }

  var details = root.closest("details");
  if (details && !details.open) {
    details.addEventListener("toggle", function () {
      if (details.open) loadViewer();
    });
  } else {
    loadViewer();
  }
})();
