/* ==========================================================================
   Hero background — procedural voxel forest, drawn with native WebGL.

   Every block in the scene is generated in code on load: no video, no
   background image, no network request, no library. The whole world is
   merged into one static vertex buffer and drawn with two draw calls (sky +
   landscape). The camera only advances along a looping path, so nothing is
   rebuilt while the page is open.

   The scene is built as a walk through a misty morning wood: a narrow trail,
   layered undergrowth, tall framing trees and progressively paler silhouettes
   in the distance. Sunlight comes from the right and slightly ahead, warming
   the canopy tops and the haze while shadowed sides stay cool.

   The canvas is decorative. If WebGL is missing or setup fails, the CSS
   fallback gradient in style.css stays visible and all page content is
   unaffected.
   ========================================================================== */
(function () {
  "use strict";

  var hero = document.querySelector(".hero");
  if (!hero) return;

  var canvas = hero.querySelector(".hero__canvas");
  if (!canvas) return;

  var options = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power"
  };

  var gl = null;
  try {
    gl = canvas.getContext("webgl", options) ||
         canvas.getContext("experimental-webgl", options);
  } catch (error) {
    gl = null;
  }
  if (!gl) return;

  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  /* -----------------------------------------------------------------------
     Small deterministic helpers
     --------------------------------------------------------------------- */

  function hash(x, z) {
    var n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function random(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Each plant gets its own stream so the far copy of the loop matches the
     near copy exactly, regardless of which items are skipped beyond the fog. */
  function itemRandom(seed, index) {
    return random((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  }

  function color(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function varied(base, rand, amount) {
    var factor = 1 + (rand() - 0.5) * amount;
    return [
      Math.min(1, base[0] * factor),
      Math.min(1, base[1] * factor),
      Math.min(1, base[2] * factor)
    ];
  }

  function pick(list, rand) {
    return list[(rand() * list.length) | 0];
  }

  function pickHash(list, value) {
    return list[(value * list.length) | 0];
  }

  /* -----------------------------------------------------------------------
     The (periodic) world
     --------------------------------------------------------------------- */

  var TAU = Math.PI * 2;
  var LOOP = 64;              // metres of trail before the pattern repeats
  var WORLD_Z = 100;          // geometry covers 36 m beyond the loop
  var HALF_X = 28;
  var BLOCK_H = 0.62;
  var EYE_HEIGHT = 1.72;
  var START_Z = 4;
  var SPEED = 1.15;           // metres per second — an unhurried walk

  var GRASS = ["#638d48", "#6e9852", "#588140", "#78a15a", "#527a3b"].map(color);
  var GRASS_DRY = ["#87975a", "#93a264", "#7a8b50"].map(color);
  var MOSS = ["#627f42", "#6d8b49", "#557238"].map(color);
  var DIRT = ["#8e6d4f", "#9a7756", "#806146", "#a4825d", "#876849"].map(color);
  var PATH_EDGE = ["#6d7e48", "#778851", "#62723f"].map(color);
  var TRUNK = ["#654732", "#75533d", "#573b2a", "#825d45"].map(color);
  var BIRCH = ["#b3a88d", "#c0b59a", "#a2987f"].map(color);
  var LEAF = ["#527f3d", "#5e8d48", "#467335", "#6b9a51", "#77a55a"].map(color);
  var LEAF_LIGHT = ["#8ab268", "#96bd74", "#7ba85c", "#a3c681"].map(color);
  var LEAF_DEEP = ["#386a35", "#42753d", "#2f5e2d", "#4c8145"].map(color);
  var PINE = ["#356748", "#3f7450", "#2c5a3e", "#477f59"].map(color);
  var SHRUB = ["#537f40", "#5f8c49", "#486f37", "#6d9752"].map(color);
  var TUFT = ["#7da657", "#8bb165", "#6f9850", "#98bc72"].map(color);
  var FLOWER = ["#f5e7b8", "#f2d98f", "#f7f3e8", "#e7bfc6", "#bfd0e0"].map(color);
  var ROCK = ["#858a7e", "#787e73", "#90958a", "#6e746a"].map(color);
  var LOG = ["#6b4f39", "#795a41", "#5d4431"].map(color);
  var MUSHROOM = ["#c4735e", "#b88a5e", "#d9c7a3"].map(color);
  var LITTER = ["#8f6e4e", "#a57c54", "#77603f", "#b18a61"].map(color);
  var SHADOW = color("#3d4d35");

  var FACE = {
    top:    { shade: 1.08, warm: 0.55 },
    bottom: { shade: 0.38, warm: -0.70 },
    px:     { shade: 1.02, warm: 0.90 },
    nx:     { shade: 0.62, warm: -0.95 },
    pz:     { shade: 0.92, warm: 0.45 },
    nz:     { shade: 0.68, warm: -0.70 }
  };

  function pathX(z) {
    var a = TAU * z / LOOP;
    return 1.9 * Math.sin(a) +
           0.7 * Math.sin(2 * a + 1.1) +
           0.25 * Math.sin(3 * a + 2.4);
  }

  function terrainHeight(x, z) {
    var distance = Math.abs(x - pathX(z));
    if (distance < 2.6) return 0;

    var bank = Math.min(1.15, Math.max(0, (distance - 8) / 13));
    var n = Math.sin(x * 0.37 + z * TAU / LOOP * 3 + 0.4) +
            Math.sin(x * 0.19 - z * TAU / LOOP * 2 + 1.9) +
            Math.sin(z * TAU / LOOP * 5 + 0.7) +
            bank * 0.9;

    if (n > 2.25) return 2;
    if (n > 0.8) return 1;
    return 0;
  }

  function groundY(x, z) {
    return terrainHeight(x, z) * BLOCK_H;
  }

  /* -----------------------------------------------------------------------
     Geometry builder — one interleaved static mesh
     --------------------------------------------------------------------- */

  var positions = [];
  var colors = [];
  var indices = [];
  var vertexCount = 0;

  function addQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
                   tint, shade, warmth) {
    var base = vertexCount;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);

    var warm = warmth || 0;
    var r = Math.min(1, tint[0] * shade * (1 + warm * 0.16));
    var g = Math.min(1, tint[1] * shade * (1 + warm * 0.05));
    var b = Math.min(1, tint[2] * shade * (1 - warm * 0.12));
    colors.push(r, g, b, r, g, b, r, g, b, r, g, b);

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    vertexCount += 4;
  }

  function addBox(cx, cy, cz, sx, sy, sz, tint) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2;
    var y0 = cy - sy / 2, y1 = cy + sy / 2;
    var z0 = cz - sz / 2, z1 = cz + sz / 2;

    addQuad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0,
            tint, FACE.top.shade, FACE.top.warm);
    addQuad(x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1,
            tint, FACE.bottom.shade, FACE.bottom.warm);
    addQuad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1,
            tint, FACE.px.shade, FACE.px.warm);
    addQuad(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0,
            tint, FACE.nx.shade, FACE.nx.warm);
    addQuad(x1, y0, z1, x1, y1, z1, x0, y1, z1, x0, y0, z1,
            tint, FACE.pz.shade, FACE.pz.warm);
    addQuad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0,
            tint, FACE.nz.shade, FACE.nz.warm);
  }

  function addFlat(cx, y, cz, sx, sz, tint, shade, warmth) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2;
    var z0 = cz - sz / 2, z1 = cz + sz / 2;
    addQuad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
            tint, shade, warmth || 0);
  }

  function buildTerrain() {
    for (var iz = 0; iz < WORLD_Z; iz++) {
      var z0 = iz;
      var z1 = iz + 1;
      var zc = iz + 0.5;
      var localZ = zc >= LOOP ? zc - LOOP : zc;

      for (var ix = -HALF_X; ix < HALF_X; ix++) {
        var x0 = ix;
        var x1 = ix + 1;
        var xc = ix + 0.5;
        var h = terrainHeight(xc, zc);
        var y = h * BLOCK_H;

        var noise = hash(ix, localZ);
        var edgeDistance = Math.abs(xc - pathX(zc));
        var onPath = edgeDistance < 0.72 + (noise - 0.5) * 0.26;
        var nearPath = !onPath && edgeDistance < 1.5 + (noise - 0.5) * 0.35;
        var patch = hash(ix + 3.7, localZ + 11.2);

        var palette;
        if (onPath) {
          palette = DIRT;
        } else if (nearPath) {
          palette = PATH_EDGE;
        } else if (patch < 0.14) {
          palette = MOSS;
        } else if (patch > 0.86) {
          palette = GRASS_DRY;
        } else {
          palette = GRASS;
        }

        var tint = pickHash(palette, hash(ix + 13.1, localZ + 7.3));
        var colorNoise = 1 + (hash(ix - 4.7, localZ + 2.9) - 0.5) * 0.28;
        tint = [
          Math.min(1, tint[0] * colorNoise),
          Math.min(1, tint[1] * colorNoise),
          Math.min(1, tint[2] * (0.96 + (colorNoise - 1) * 0.7))
        ];

        addQuad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0,
                tint, 1.0, onPath ? 0.12 : 0.4);

        // Vertical skirts wherever this cell sits above its neighbour.
        var sideSource = onPath ? DIRT : GRASS;
        var side = pickHash(sideSource, hash(ix + 1.7, localZ + 8.1));
        var sideNoise = 1 + (hash(ix + 9.2, localZ) - 0.5) * 0.24;
        side = [
          Math.min(1, side[0] * sideNoise),
          Math.min(1, side[1] * sideNoise),
          Math.min(1, side[2] * sideNoise)
        ];
        var northH = terrainHeight(xc, zc - 1) * BLOCK_H;
        var southH = terrainHeight(xc, zc + 1) * BLOCK_H;
        var westH = terrainHeight(xc - 1, zc) * BLOCK_H;
        var eastH = terrainHeight(xc + 1, zc) * BLOCK_H;

        if (northH < y) {
          addQuad(x0, northH, z0, x0, y, z0, x1, y, z0, x1, northH, z0,
                  side, 0.72, -0.35);
        }
        if (southH < y) {
          addQuad(x1, southH, z1, x1, y, z1, x0, y, z1, x0, southH, z1,
                  side, 0.86, 0.28);
        }
        if (westH < y) {
          addQuad(x0, westH, z0, x0, y, z0, x0, y, z1, x0, westH, z1,
                  side, 0.68, -0.55);
        }
        if (eastH < y) {
          addQuad(x1, eastH, z1, x1, y, z1, x1, y, z0, x1, eastH, z0,
                  side, 0.80, 0.55);
        }
      }
    }
  }

  function addShadow(x, z, baseY, scale, rand) {
    var tint = varied(SHADOW, rand, 0.18);
    addFlat(x - 0.55 * scale, baseY + 0.008, z - 0.15 * scale,
            2.2 * scale, 1.7 * scale, tint, 0.95, -0.2);
    addFlat(x - 1.45 * scale, baseY + 0.009, z + 0.35 * scale,
            1.35 * scale, 1.05 * scale, tint, 1.0, -0.2);
  }

  function addBroadleaf(x, z, baseY, scale, rand) {
    var trunkH = (2.4 + rand() * 1.4) * scale;
    var trunk = varied(pick(TRUNK, rand), rand, 0.18);
    addBox(x, baseY + trunkH / 2, z, 0.54 * scale, trunkH, 0.54 * scale, trunk);

    var i;
    for (i = 0; i < 2; i++) {
      var angle = rand() * TAU;
      addBox(x + Math.cos(angle) * 0.48 * scale, baseY + 0.11 * scale,
             z + Math.sin(angle) * 0.48 * scale,
             0.58 * scale, 0.22 * scale, 0.30 * scale, trunk);
    }

    var branchSide = rand() < 0.5 ? -1 : 1;
    addBox(x + branchSide * 0.65 * scale, baseY + trunkH * 0.72, z,
           1.15 * scale, 0.20 * scale, 0.20 * scale, trunk);

    var top = baseY + trunkH;
    var a = varied(pick(LEAF, rand), rand, 0.22);
    var b = varied(pick(LEAF, rand), rand, 0.22);
    var c = varied(pick(LEAF_DEEP, rand), rand, 0.16);
    var lit = varied(pick(LEAF_LIGHT, rand), rand, 0.14);

    addBox(x, top + 0.32 * scale, z,
           2.6 * scale, 0.78 * scale, 2.5 * scale, a);
    addBox(x - 0.35 * scale, top + 0.95 * scale, z + 0.2 * scale,
           2.0 * scale, 0.72 * scale, 1.9 * scale, b);
    addBox(x + 0.7 * scale, top + 1.5 * scale, z - 0.4 * scale,
           1.45 * scale, 0.68 * scale, 1.35 * scale, lit);
    addBox(x - 0.85 * scale, top + 0.75 * scale, z + 0.75 * scale,
           1.15 * scale, 0.55 * scale, 1.05 * scale, c);
    addBox(x + 0.95 * scale, top + 1.0 * scale, z + 0.8 * scale,
           1.0 * scale, 0.52 * scale, 0.95 * scale, c);
    addBox(x - 0.1 * scale, top + 2.05 * scale, z + 0.05 * scale,
           0.9 * scale, 0.5 * scale, 0.85 * scale, lit);
    addBox(x + 0.35 * scale, top + 0.5 * scale, z + 1.1 * scale,
           0.9 * scale, 0.4 * scale, 0.8 * scale, b);
  }

  function addConifer(x, z, baseY, scale, rand) {
    var trunkH = (1.35 + rand() * 0.65) * scale;
    addBox(x, baseY + trunkH / 2, z, 0.44 * scale, trunkH, 0.44 * scale,
           varied(pick(TRUNK, rand), rand, 0.16));

    var top = baseY + trunkH;
    var widths = [2.8, 2.3, 1.8, 1.3, 0.8];
    var heights = [0.82, 0.76, 0.7, 0.62, 0.54];
    var offsets = [0.4, 1.05, 1.65, 2.2, 2.65];

    for (var i = 0; i < widths.length; i++) {
      var tint = i === widths.length - 1
        ? varied(pick(LEAF_LIGHT, rand), rand, 0.14)
        : varied(pick(PINE, rand), rand, 0.18);
      addBox(x + (i % 2 === 0 ? 0.16 : -0.12) * scale,
             top + offsets[i] * scale, z,
             widths[i] * scale, heights[i] * scale, widths[i] * scale, tint);
    }
  }

  function addBirch(x, z, baseY, scale, rand) {
    var trunkH = (2.9 + rand() * 1.5) * scale;
    var trunk = varied(pick(BIRCH, rand), rand, 0.10);
    addBox(x, baseY + trunkH / 2, z, 0.40 * scale, trunkH, 0.40 * scale, trunk);

    var dark = varied(pick(TRUNK, rand), rand, 0.14);
    addBox(x - 0.21 * scale, baseY + trunkH * 0.42, z,
           0.045 * scale, 0.34 * scale, 0.22 * scale, dark);
    addBox(x + 0.21 * scale, baseY + trunkH * 0.68, z,
           0.045 * scale, 0.26 * scale, 0.20 * scale, dark);

    var top = baseY + trunkH;
    var light = varied(pick(LEAF_LIGHT, rand), rand, 0.16);
    var mid = varied(pick(LEAF, rand), rand, 0.20);
    var deep = varied(pick(LEAF_DEEP, rand), rand, 0.16);

    addBox(x, top + 0.34 * scale, z,
           2.45 * scale, 0.72 * scale, 2.35 * scale, light);
    addBox(x + 0.52 * scale, top + 1.02 * scale, z - 0.4 * scale,
           1.65 * scale, 0.70 * scale, 1.55 * scale, mid);
    addBox(x - 0.62 * scale, top + 1.42 * scale, z + 0.45 * scale,
           1.25 * scale, 0.62 * scale, 1.2 * scale, light);
    addBox(x + 0.2 * scale, top + 0.9 * scale, z + 0.75 * scale,
           1.0 * scale, 0.52 * scale, 0.95 * scale, deep);
  }

  function addBackgroundTree(x, z, baseY, scale, rand, conifer) {
    var trunk = varied(pick(TRUNK, rand), rand, 0.14);
    addBox(x, baseY + 1.5 * scale, z, 0.52 * scale, 3.0 * scale, 0.52 * scale,
           trunk);

    if (conifer) {
      var offsets = [2.0, 3.1, 4.1, 5.0];
      var widths = [2.9, 2.4, 1.85, 1.25];
      for (var i = 0; i < offsets.length; i++) {
        addBox(x, baseY + (offsets[i] + 1.4) * scale, z,
               widths[i] * scale, 1.15 * scale, widths[i] * scale,
               varied(pick(PINE, rand), rand, 0.14));
      }
    } else {
      var deep = varied(pick(LEAF_DEEP, rand), rand, 0.14);
      var leaf = varied(pick(LEAF, rand), rand, 0.16);
      addBox(x, baseY + 3.8 * scale, z,
             2.9 * scale, 2.1 * scale, 2.8 * scale, leaf);
      addBox(x - 0.3 * scale, baseY + 5.3 * scale, z + 0.2 * scale,
             2.1 * scale, 1.6 * scale, 2.0 * scale, deep);
      addBox(x + 0.5 * scale, baseY + 5.9 * scale, z - 0.4 * scale,
             1.3 * scale, 1.2 * scale, 1.2 * scale, leaf);
    }
  }

  function buildTrees(loop, maxLocalZ) {
    var count = 30;
    var step = LOOP / count;

    for (var i = 0; i < count; i++) {
      var rand = itemRandom(0x51ed270b, i);
      var localZ = (i + 0.1 + rand() * 0.8) * step;
      var side = i % 2 === 0 ? -1 : 1;
      if (rand() < 0.18) side *= -1;

      var close = rand() < 0.42;
      var offset = close
        ? 3.1 + rand() * 2.0
        : 4.6 + Math.pow(rand(), 1.3) * 8.8;
      var x = pathX(localZ) + side * offset;
      var scale = 0.9 + rand() * 0.65;
      if (rand() < 0.22) scale *= 1.22;
      var kind = rand();

      if (localZ >= maxLocalZ) continue;

      var z = loop * LOOP + localZ;
      var baseY = groundY(x, localZ);
      addShadow(x, z, baseY, scale, rand);

      if (kind < 0.45) {
        addBroadleaf(x, z, baseY, scale, rand);
      } else if (kind < 0.85) {
        addConifer(x, z, baseY, scale, rand);
      } else {
        addBirch(x, z, baseY, scale, rand);
      }
    }

    // A second, taller row for layered silhouettes in the haze.
    var farCount = 22;
    for (var j = 0; j < farCount; j++) {
      var farRand = itemRandom(0x2f6e2b1d, j);
      var farLocalZ = (j + 0.08 + farRand() * 0.84) * (LOOP / farCount);
      var farSide = j % 2 === 0 ? -1 : 1;
      if (farRand() < 0.2) farSide *= -1;
      var farX = pathX(farLocalZ) + farSide * (12.5 + farRand() * 13);
      var farScale = 1.4 + farRand() * 1.35;
      var conifer = farRand() < 0.58;

      if (farLocalZ >= maxLocalZ) continue;

      addBackgroundTree(farX, loop * LOOP + farLocalZ,
                        groundY(farX, farLocalZ), farScale, farRand, conifer);
    }
  }

  function buildUnderstory(loop, maxLocalZ) {
    var i;
    var rand;

    // Leafy shrubs, clustered in twos and threes along the verge.
    for (i = 0; i < 32; i++) {
      rand = itemRandom(0x7a3c19e5, i);
      var localZ = rand() * LOOP;
      var side = rand() < 0.5 ? -1 : 1;
      var x = pathX(localZ) + side * (1.65 + Math.pow(rand(), 1.35) * 5.3);
      var scale = 0.55 + rand() * 0.65;

      if (localZ >= maxLocalZ) continue;

      var z = loop * LOOP + localZ;
      var base = groundY(x, localZ);
      var tint = varied(pick(SHRUB, rand), rand, 0.2);
      addBox(x, base + 0.30 * scale, z,
             1.2 * scale, 0.58 * scale, 1.0 * scale, tint);
      addBox(x + (rand() - 0.5) * 0.7 * scale, base + 0.62 * scale,
             z + (rand() - 0.5) * 0.6 * scale,
             0.82 * scale, 0.46 * scale, 0.72 * scale,
             varied(pick(SHRUB, rand), rand, 0.18));
      addBox(x - (rand() - 0.2) * 0.6 * scale, base + 0.5 * scale,
             z + (rand() - 0.5) * 0.8 * scale,
             0.55 * scale, 0.38 * scale, 0.5 * scale,
             varied(pick(LEAF, rand), rand, 0.2));
    }

    // Dense grass clumps right at the trail edge.
    for (i = 0; i < 84; i++) {
      rand = itemRandom(0x19c4a7d3, i);
      var gz = rand() * LOOP;
      var gSide = rand() < 0.5 ? -1 : 1;
      var gx = pathX(gz) + gSide * (0.9 + rand() * 1.55);

      if (gz >= maxLocalZ) continue;

      var gy = groundY(gx, gz);
      var blades = 2 + ((rand() * 2) | 0);
      for (var b = 0; b < blades; b++) {
        var bh = 0.24 + rand() * 0.36;
        addBox(gx + (rand() - 0.5) * 0.3, gy + bh / 2,
               loop * LOOP + gz + (rand() - 0.5) * 0.3,
               0.065, bh, 0.065,
               varied(pick(TUFT, rand), rand, 0.24));
      }
    }

    // Ferns: a short stem with four flattened fronds.
    for (i = 0; i < 18; i++) {
      rand = itemRandom(0x58c1e3a7, i);
      var fz = rand() * LOOP;
      var fSide = rand() < 0.5 ? -1 : 1;
      var fx = pathX(fz) + fSide * (1.45 + rand() * 3.2);
      var fscale = 0.6 + rand() * 0.5;

      if (fz >= maxLocalZ) continue;

      var fy = groundY(fx, fz);
      var fTint = varied(pick(LEAF, rand), rand, 0.18);
      addBox(fx, fy + 0.18 * fscale, loop * LOOP + fz,
             0.07, 0.34 * fscale, 0.07, fTint);
      for (var f = 0; f < 4; f++) {
        var alongX = f < 2 ? 1 : -1;
        var alongZ = f % 2 === 0 ? 1 : -1;
        addBox(fx + alongX * 0.24 * fscale,
               fy + (0.30 + f * 0.035) * fscale,
               loop * LOOP + fz + alongZ * 0.18 * fscale,
               0.50 * fscale, 0.055 * fscale, 0.13 * fscale,
               varied(pick(LEAF_LIGHT, rand), rand, 0.18));
      }
    }

    // Flowers: stems with small, varied blossom blocks.
    for (i = 0; i < 28; i++) {
      rand = itemRandom(0x4c8b62ff, i);
      var wz = rand() * LOOP;
      var wSide = rand() < 0.5 ? -1 : 1;
      var wx = pathX(wz) + wSide * (1.05 + rand() * 1.8);

      if (wz >= maxLocalZ) continue;

      var wy = groundY(wx, wz);
      var stemH = 0.22 + rand() * 0.18;
      var flowerTint = varied(pick(FLOWER, rand), rand, 0.10);
      addBox(wx, wy + stemH / 2, loop * LOOP + wz,
             0.045, stemH, 0.045,
             varied(pick(TUFT, rand), rand, 0.1));
      addBox(wx, wy + stemH + 0.04, loop * LOOP + wz,
             0.15, 0.11, 0.15, flowerTint);
      if (rand() < 0.45) {
        addBox(wx + 0.13, wy + stemH - 0.02, loop * LOOP + wz + 0.08,
               0.09, 0.08, 0.09,
               varied(pick(FLOWER, rand), rand, 0.1));
      }
    }

    // Rocks, some with a moss cap.
    for (i = 0; i < 15; i++) {
      rand = itemRandom(0x63b1d9c7, i);
      var rz = rand() * LOOP;
      var rSide = rand() < 0.5 ? -1 : 1;
      var rx = pathX(rz) + rSide * (1.8 + rand() * 4.4);
      var rw = 0.28 + rand() * 0.62;

      if (rz >= maxLocalZ) continue;

      var ry = groundY(rx, rz);
      addBox(rx, ry + rw * 0.26, loop * LOOP + rz,
             rw, rw * 0.52, rw * 0.82,
             varied(pick(ROCK, rand), rand, 0.2));
      if (rand() < 0.5) {
        addBox(rx + rw * 0.38, ry + rw * 0.16,
               loop * LOOP + rz + rw * 0.18,
               rw * 0.48, rw * 0.32, rw * 0.46,
               varied(pick(ROCK, rand), rand, 0.18));
      }
      if (rand() < 0.45) {
        addBox(rx, ry + rw * 0.50, loop * LOOP + rz,
               rw * 0.72, 0.07, rw * 0.58,
               varied(pick(MOSS, rand), rand, 0.14));
      }
    }

    // Fallen logs, running roughly along the trail.
    for (i = 0; i < 3; i++) {
      rand = itemRandom(0x1d77a3b9, i);
      var lz = 5 + rand() * (LOOP - 10);
      var lSide = rand() < 0.5 ? -1 : 1;
      var lx = pathX(lz) + lSide * (3.2 + rand() * 1.1);

      if (lz >= maxLocalZ) continue;

      var ly = groundY(lx, lz);
      addBox(lx, ly + 0.22, loop * LOOP + lz,
             0.46, 0.44, 2.1 + rand() * 0.9,
             varied(pick(LOG, rand), rand, 0.15));
      if (rand() < 0.6) {
        addBox(lx, ly + 0.46, loop * LOOP + lz + (rand() - 0.5) * 1.2,
               0.34, 0.06, 0.8, varied(pick(MOSS, rand), rand, 0.12));
      }
    }

    // Mushrooms tucked in the damp leaf litter.
    for (i = 0; i < 10; i++) {
      rand = itemRandom(0x2b5e71c3, i);
      var mz = rand() * LOOP;
      var mSide = rand() < 0.5 ? -1 : 1;
      var mx = pathX(mz) + mSide * (2.1 + rand() * 3.6);

      if (mz >= maxLocalZ) continue;

      var my = groundY(mx, mz);
      addBox(mx, my + 0.10, loop * LOOP + mz,
             0.055, 0.20, 0.055, color("#ded2b6"));
      addBox(mx, my + 0.23, loop * LOOP + mz,
             0.22, 0.09, 0.22,
             varied(pick(MUSHROOM, rand), rand, 0.12));
    }

    // Pebbles and leaf litter on the path itself, so the ground never reads
    // as a smooth, repeating strip of colour.
    for (i = 0; i < 26; i++) {
      rand = itemRandom(0x7e4d2f91, i);
      var pz = rand() * LOOP;
      var px = pathX(pz) + (rand() - 0.5) * 1.35;
      var pw = 0.08 + rand() * 0.13;

      if (pz >= maxLocalZ) continue;

      addBox(px, groundY(px, pz) + pw * 0.24, loop * LOOP + pz,
             pw, pw * 0.38, pw * 0.8,
             varied(pick(ROCK, rand), rand, 0.2));
    }

    for (i = 0; i < 46; i++) {
      rand = itemRandom(0x3a91c4e5, i);
      var qz = rand() * LOOP;
      var qx = pathX(qz) + (rand() - 0.5) * 1.3;
      var qw = 0.09 + rand() * 0.17;

      if (qz >= maxLocalZ) continue;

      addFlat(qx, groundY(qx, qz) + 0.006, loop * LOOP + qz,
              qw, qw * (0.6 + rand() * 0.7),
              varied(pick(LITTER, rand), rand, 0.2), 1.0, 0.15);
    }

    // Twigs and small fallen branches on the packed earth.
    for (i = 0; i < 14; i++) {
      rand = itemRandom(0x5d2c8f13, i);
      var tz = rand() * LOOP;
      var tx = pathX(tz) + (rand() - 0.5) * 1.35;
      var tl = 0.28 + rand() * 0.52;
      var alongZ = rand() < 0.5;

      if (tz >= maxLocalZ) continue;

      addBox(tx, groundY(tx, tz) + 0.035, loop * LOOP + tz,
             alongZ ? 0.055 : tl, 0.055, alongZ ? tl : 0.055,
             varied(pick(LOG, rand), rand, 0.18));
    }

    // Soft moss patches at the trail edge.
    for (i = 0; i < 16; i++) {
      rand = itemRandom(0x6cb1539d, i);
      var sz = rand() * LOOP;
      var sSide = rand() < 0.5 ? -1 : 1;
      var sx = pathX(sz) + sSide * (1.15 + rand() * 1.4);
      var sw = 0.3 + rand() * 0.55;

      if (sz >= maxLocalZ) continue;

      addFlat(sx, groundY(sx, sz) + 0.007, loop * LOOP + sz,
              sw, sw * (0.7 + rand() * 0.6),
              varied(pick(MOSS, rand), rand, 0.16), 1.0, 0.2);
    }

    // Pools of sunlight and soft canopy shade on the packed earth. They break
    // up the one-metre tile rhythm and suggest light falling through leaves.
    var sunPatch = color("#d9c99d");
    var shadePatch = color("#6f5a43");
    for (i = 0; i < 18; i++) {
      rand = itemRandom(0x4a7da2c1, i);
      var dz = rand() * LOOP;
      var dx = pathX(dz) + (rand() - 0.5) * 2.3;
      var dw = 0.32 + rand() * 0.72;
      var dl = 0.55 + rand() * 1.35;

      if (dz >= maxLocalZ) continue;

      addFlat(dx, groundY(dx, dz) + 0.011, loop * LOOP + dz,
              dw, dl,
              varied(i % 4 === 0 ? shadePatch : sunPatch, rand, 0.14),
              i % 4 === 0 ? 0.9 : 1.0, 0.35);
    }
  }

  buildTerrain();
  buildTrees(0, LOOP);
  buildTrees(1, 36);
  buildUnderstory(0, LOOP);
  buildUnderstory(1, 36);

  if (vertexCount > 65535) return;

  var meshData = new Float32Array(vertexCount * 6);
  for (var v = 0; v < vertexCount; v++) {
    meshData[v * 6] = positions[v * 3];
    meshData[v * 6 + 1] = positions[v * 3 + 1];
    meshData[v * 6 + 2] = positions[v * 3 + 2];
    meshData[v * 6 + 3] = colors[v * 3];
    meshData[v * 6 + 4] = colors[v * 3 + 1];
    meshData[v * 6 + 5] = colors[v * 3 + 2];
  }

  var meshBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, meshData, gl.STATIC_DRAW);

  var indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  var skyBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  /* -----------------------------------------------------------------------
     Shaders
     --------------------------------------------------------------------- */

  var MESH_VERTEX = [
    "attribute vec3 aPosition;",
    "attribute vec3 aColor;",
    "uniform mat4 uViewProjection;",
    "uniform mediump vec3 uCamera;",
    "varying vec3 vColor;",
    "varying vec3 vWorld;",
    "varying float vDistance;",
    "varying float vHeight;",
    "void main() {",
    "  gl_Position = uViewProjection * vec4(aPosition, 1.0);",
    "  vColor = aColor;",
    "  vWorld = aPosition;",
    "  vDistance = distance(aPosition, uCamera);",
    "  vHeight = aPosition.y;",
    "}"
  ].join("\n");

  var MESH_FRAGMENT = [
    "precision mediump float;",
    "uniform mediump vec3 uCamera;",
    "uniform vec3 uFogColor;",
    "uniform vec3 uFogShadow;",
    "uniform vec3 uSunColor;",
    "uniform vec3 uSunDirection;",
    "uniform float uFogNear;",
    "uniform float uFogFar;",
    "uniform float uExposure;",
    "varying vec3 vColor;",
    "varying vec3 vWorld;",
    "varying float vDistance;",
    "varying float vHeight;",
    "void main() {",
    "  vec3 viewDir = normalize(vWorld - uCamera);",
    "  float sunFacing = max(dot(viewDir, uSunDirection), 0.0);",
    "  float scatter = pow(sunFacing, 6.0);",
    "  vec3 lit = vColor * uExposure;",
    "  lit += uSunColor * scatter * 0.05;",
    "  float distanceFog = smoothstep(uFogNear, uFogFar, vDistance);",
    "  float lowMist = (1.0 - smoothstep(0.0, 4.8, vHeight)) *",
    "                  smoothstep(8.0, 26.0, vDistance) * 0.26;",
    "  float fog = clamp(1.0 - (1.0 - distanceFog) * (1.0 - lowMist), 0.0, 0.98);",
    "  vec3 fogTint = mix(uFogShadow, uFogColor, 0.20 + 0.80 * scatter);",
    "  fogTint += uSunColor * scatter * 0.10;",
    "  vec3 col = mix(lit, fogTint, fog);",
    "  float luma = dot(col, vec3(0.299, 0.587, 0.114));",
    "  col = mix(vec3(luma), col, 1.10);",
    "  col = (col - 0.5) * 1.06 + 0.5;",
    "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);",
    "}"
  ].join("\n");

  var SKY_VERTEX = [
    "attribute vec2 aPosition;",
    "void main() {",
    "  gl_Position = vec4(aPosition, 0.999, 1.0);",
    "}"
  ].join("\n");

  var SKY_FRAGMENT = [
    "precision mediump float;",
    "uniform vec2 uResolution;",
    "uniform vec3 uSkyTop;",
    "uniform vec3 uSkyHorizon;",
    "uniform vec3 uSunColor;",
    "uniform vec3 uFogColor;",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / uResolution;",
    "  float aspect = uResolution.x / uResolution.y;",
    "  float h = smoothstep(0.0, 1.0, uv.y);",
    "  vec3 tinted = mix(uSkyHorizon, uSkyTop, pow(h, 0.85));",
    "  float haze = (1.0 - smoothstep(0.18, 0.62, uv.y)) * 0.22;",
    "  tinted = mix(tinted, uFogColor, haze);",
    "  vec2 sunPos = vec2(0.62, 0.64);",
    "  vec2 delta = uv - sunPos;",
    "  delta.x *= aspect;",
    "  float radius = length(delta);",
    "  float glow = exp(-radius * radius * 2.5) * 0.16 +",
    "               exp(-radius * radius * 18.0) * 0.34 +",
    "               exp(-radius * radius * 80.0) * 0.48;",
    "  tinted += uSunColor * glow;",
    "  float ang = atan(delta.y, delta.x);",
    "  float rays = 0.5 + 0.5 * sin(ang * 11.0 + 0.5);",
    "  rays = pow(rays, 6.0) * exp(-radius * 2.0) * 0.14;",
    "  tinted += uSunColor * rays;",
    "  float disc = 1.0 - smoothstep(0.012, 0.024, radius);",
    "  tinted = mix(tinted, uSunColor, disc * 0.94);",
    "  gl_FragColor = vec4(tinted, 1.0);",
    "}"
  ].join("\n");

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function program(vertexSource, fragmentSource) {
    var vs = compile(gl.VERTEX_SHADER, vertexSource);
    var fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;

    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  var meshProgram = program(MESH_VERTEX, MESH_FRAGMENT);
  var skyProgram = program(SKY_VERTEX, SKY_FRAGMENT);
  if (!meshProgram || !skyProgram) return;

  var mesh = {
    position: gl.getAttribLocation(meshProgram, "aPosition"),
    color: gl.getAttribLocation(meshProgram, "aColor"),
    viewProjection: gl.getUniformLocation(meshProgram, "uViewProjection"),
    camera: gl.getUniformLocation(meshProgram, "uCamera"),
    fogColor: gl.getUniformLocation(meshProgram, "uFogColor"),
    fogShadow: gl.getUniformLocation(meshProgram, "uFogShadow"),
    sunColor: gl.getUniformLocation(meshProgram, "uSunColor"),
    sunDirection: gl.getUniformLocation(meshProgram, "uSunDirection"),
    fogNear: gl.getUniformLocation(meshProgram, "uFogNear"),
    fogFar: gl.getUniformLocation(meshProgram, "uFogFar"),
    exposure: gl.getUniformLocation(meshProgram, "uExposure")
  };

  var sky = {
    position: gl.getAttribLocation(skyProgram, "aPosition"),
    resolution: gl.getUniformLocation(skyProgram, "uResolution"),
    top: gl.getUniformLocation(skyProgram, "uSkyTop"),
    horizon: gl.getUniformLocation(skyProgram, "uSkyHorizon"),
    sun: gl.getUniformLocation(skyProgram, "uSunColor"),
    fogColor: gl.getUniformLocation(skyProgram, "uFogColor")
  };

  /* -----------------------------------------------------------------------
     Theme, camera and drawing
     --------------------------------------------------------------------- */

  function theme() {
    if (darkQuery.matches) {
      return {
        skyTop: color("#071a24"),
        horizon: color("#3d5c53"),
        sun: color("#ffd29a"),
        fog: color("#2b4a40"),
        fogShadow: color("#142d29"),
        exposure: 1.0
      };
    }
    return {
      skyTop: color("#4b86ab"),
      horizon: color("#efd39b"),
      sun: color("#ffd98a"),
      fog: color("#9cb395"),
      fogShadow: color("#6f8768"),
      exposure: 1.0
    };
  }

  var currentTheme = theme();
  var projection = new Float32Array(16);
  var view = new Float32Array(16);
  var viewProjection = new Float32Array(16);
  var sunDirection = new Float32Array(3);
  var pixelWidth = 1;
  var pixelHeight = 1;

  function perspective(out, fovY, aspect, near, far) {
    var f = 1 / Math.tan(fovY / 2);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0;
  }

  function lookAt(out, ex, ey, ez, tx, ty, tz) {
    var zx = ex - tx, zy = ey - ty, zz = ez - tz;
    var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;

    var xx = zz, xy = 0, xz = -zx;
    var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;

    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * ex + xy * ey + xz * ez);
    out[13] = -(yx * ex + yy * ey + yz * ez);
    out[14] = -(zx * ex + zy * ey + zz * ez);
    out[15] = 1;
  }

  function multiply(out, a, b) {
    for (var c = 0; c < 4; c++) {
      var b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
  }

  function resize() {
    var rect = hero.getBoundingClientRect();
    var cssWidth = Math.max(1, rect.width);
    var cssHeight = Math.max(1, rect.height);
    var dpr = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2);
    var width = Math.max(1, Math.round(cssWidth * dpr));
    var height = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    pixelWidth = width;
    pixelHeight = height;

    var aspect = width / height;
    var fov = aspect >= 1.6 ? 31 : aspect >= 1.0 ? 36 : 42;
    perspective(projection, fov * Math.PI / 180, aspect, 0.1, 100);
    gl.viewport(0, 0, width, height);
  }

  function draw(elapsed) {
    var dark = currentTheme;

    var travelled = elapsed * SPEED;
    var z = (START_Z + travelled) % LOOP;
    if (z < 0) z += LOOP;

    var walk = travelled * (TAU / 0.78);
    var bob = Math.sin(walk * 2.0) * 0.011 +
              Math.sin(walk * 0.5 + 0.6) * 0.004;
    var portrait = pixelHeight > pixelWidth;
    // On portrait screens, walk the right edge and look a little across the
    // trail, so grass and trees fill the empty right-hand side of the hero.
    var sway = Math.sin(walk) * (portrait ? 0.012 : 0.018);
    var eyeX = pathX(z) + sway + (portrait ? 0.85 : 0);
    var eyeY = EYE_HEIGHT + bob;
    var lookZ = z + (portrait ? 9.5 : 10.5);
    var targetX = pathX(lookZ) + (portrait ? -1.3 : 0);
    var targetY = EYE_HEIGHT + (portrait ? 0.12 : -0.28) + bob * 0.6;

    lookAt(view, eyeX, eyeY, z, targetX, targetY, lookZ);
    multiply(viewProjection, projection, view);

    // Sun direction in world space: forward, slightly to the right and up.
    // It matches the position of the sun in the procedural sky closely enough
    // to warm the haze consistently as the trail curves.
    var forwardX = -view[2], forwardY = -view[6], forwardZ = -view[10];
    var rightX = view[0], rightY = view[4], rightZ = view[8];
    var upX = view[1], upY = view[5], upZ = view[9];
    var sx = forwardX + rightX * 0.20 + upX * 0.11;
    var sy = forwardY + rightY * 0.20 + upY * 0.11;
    var sz = forwardZ + rightZ * 0.20 + upZ * 0.11;
    var sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    sunDirection[0] = sx / sl;
    sunDirection[1] = sy / sl;
    sunDirection[2] = sz / sl;

    gl.clearColor(dark.fog[0], dark.fog[1], dark.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky: a full-screen triangle, no depth write.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(skyProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer);
    gl.enableVertexAttribArray(sky.position);
    gl.vertexAttribPointer(sky.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(sky.resolution, pixelWidth, pixelHeight);
    gl.uniform3fv(sky.top, dark.skyTop);
    gl.uniform3fv(sky.horizon, dark.horizon);
    gl.uniform3fv(sky.sun, dark.sun);
    gl.uniform3fv(sky.fogColor, dark.fog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(sky.position);

    // Landscape: one static interleaved buffer, one indexed draw.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(meshProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.enableVertexAttribArray(mesh.position);
    gl.vertexAttribPointer(mesh.position, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(mesh.color);
    gl.vertexAttribPointer(mesh.color, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.uniformMatrix4fv(mesh.viewProjection, false, viewProjection);
    gl.uniform3f(mesh.camera, eyeX, eyeY, z);
    gl.uniform3fv(mesh.fogColor, dark.fog);
    gl.uniform3fv(mesh.fogShadow, dark.fogShadow);
    gl.uniform3fv(mesh.sunColor, dark.sun);
    gl.uniform3fv(mesh.sunDirection, sunDirection);
    gl.uniform1f(mesh.fogNear, 11.5);
    gl.uniform1f(mesh.fogFar, 40.0);
    gl.uniform1f(mesh.exposure, dark.exposure);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

    if (!canvas.dataset.renderer) {
      canvas.dataset.renderer = "webgl";
      canvas.dataset.vertices = String(vertexCount);
      canvas.dataset.drawCalls = "2";
      hero.classList.add("is-webgl-ready");
    }
  }

  /* -----------------------------------------------------------------------
     Scheduling: pause when hidden, off-screen or reduced-motion
     --------------------------------------------------------------------- */

  var rafId = 0;
  var running = false;
  var heroVisible = true;
  var lastFrame = 0;
  var lastTime = 0;
  var frameBudget = 1000 / 30;

  function render(elapsed) {
    try {
      draw(elapsed);
      lastTime = elapsed;
    } catch (error) {
      stop();
      canvas.style.display = "none";
    }
  }

  function frame(now) {
    if (!running) return;
    rafId = window.requestAnimationFrame(frame);
    if (now - lastFrame < frameBudget - 1) return;
    var delta = lastFrame ? Math.min(0.12, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    lastTime += motionQuery.matches ? 0 : delta;
    render(lastTime);
  }

  function start() {
    if (running || motionQuery.matches || document.visibilityState === "hidden" || !heroVisible) return;
    running = true;
    lastFrame = 0;
    rafId = window.requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function sync() {
    if (!motionQuery.matches && document.visibilityState !== "hidden" && heroVisible) {
      start();
    } else {
      stop();
    }
  }

  function listen(query, handler) {
    if (query.addEventListener) query.addEventListener("change", handler);
    else if (query.addListener) query.addListener(handler);
  }

  var resizeScheduled = false;
  function scheduleResize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    window.requestAnimationFrame(function () {
      resizeScheduled = false;
      resize();
      if (!running) render(lastTime);
    });
  }

  resize();
  render(0);

  var resizeObserver = null;
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(hero);
  } else {
    window.addEventListener("resize", scheduleResize);
  }

  var intersectionObserver = null;
  if ("IntersectionObserver" in window) {
    intersectionObserver = new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
      sync();
    }, { threshold: 0 });
    intersectionObserver.observe(hero);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") stop();
    else sync();
  });

  canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault();
    stop();
    hero.classList.remove("is-webgl-ready");
  }, false);

  listen(motionQuery, function () {
    canvas.dataset.motion = motionQuery.matches ? "reduced" : "animated";
    if (motionQuery.matches) {
      stop();
      render(lastTime);
    } else {
      sync();
    }
  });

  listen(darkQuery, function () {
    currentTheme = theme();
    if (!running) render(lastTime);
  });

  canvas.dataset.motion = motionQuery.matches ? "reduced" : "animated";
  sync();
})();
