import test from "node:test";
import assert from "node:assert/strict";
import { buildPositionFromLayout } from "../services/printful.js";

// -- buildDefaultPosition (called via buildPositionFromLayout with layout=null) --

test("default position returns square dimensions for square image (1:1)", () => {
  const pos = buildPositionFromLayout({ width: 1800, height: 2400 }, null);
  assert.equal(pos.area_width, 1800);
  assert.equal(pos.area_height, 2400);
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 1800);
  // Centered vertically: (2400 - 1800) / 2 = 300
  assert.equal(pos.top, 300);
  assert.equal(pos.left, 0);
});

test("default position with no options behaves as square image", () => {
  const pos = buildPositionFromLayout({ width: 1800, height: 2400 });
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 1800);
  assert.equal(pos.top, 300);
});

test("default position fills entire area when image AR matches area AR", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    null,
    { imageAspectRatio: 1800 / 2400 }
  );
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 2400);
  assert.equal(pos.top, 0);
  assert.equal(pos.left, 0);
});

test("default position with landscape image constrains width", () => {
  // Area is taller than wide (1800x2400), image is landscape (1.5:1)
  // areaAspect = 0.75 < 1.5 → reduce height
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    null,
    { imageAspectRatio: 1.5 }
  );
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, Math.round(1800 / 1.5)); // 1200
  assert.equal(pos.top, Math.round((2400 - 1200) / 2)); // 600
  assert.equal(pos.left, 0);
});

test("default position with square area needs no correction", () => {
  const pos = buildPositionFromLayout({ width: 1800, height: 1800 }, null);
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 1800);
  assert.equal(pos.top, 0);
  assert.equal(pos.left, 0);
});

// -- buildPositionFromLayout with layout --

test("layout constrains height for square image in rectangular area", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    { scale: 0.8, offset_x: 0, offset_y: 0 }
  );
  // width = 1800*0.8 = 1440, height would be 2400*0.8 = 1920
  // scaledAspect = 1440/1920 = 0.75 < 1.0 → constrain height = 1440
  assert.equal(pos.width, 1440);
  assert.equal(pos.height, 1440);
});

test("layout centers with zero offset", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    { scale: 0.8, offset_x: 0, offset_y: 0 }
  );
  // leftRange = 1800-1440 = 360, offset_x=0 → left = 360*0.5 = 180
  // topRange = 2400-1440 = 960, offset_y=0 → top = 960*0.5 = 480
  assert.equal(pos.left, 180);
  assert.equal(pos.top, 480);
});

test("layout with rectangular image constrains correctly", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    { scale: 1, offset_x: 0, offset_y: 0 },
    { imageAspectRatio: 1.5 }
  );
  // width = 1800*1 = 1800, height = 2400*1 = 2400
  // scaledAspect = 0.75 < 1.5 → constrain height
  // height = 1800/1.5 = 1200
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 1200);
});

test("layout with square area needs no aspect correction", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 1800 },
    { scale: 0.9, offset_x: 0, offset_y: 0 }
  );
  // width = 1800*0.9 = 1620, height = 1800*0.9 = 1620
  // scaledAspect = 1.0 = imageAR → no correction
  assert.equal(pos.width, 1620);
  assert.equal(pos.height, 1620);
});

test("layout with scale > 1 overflows area correctly", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    { scale: 1.35, offset_x: 0, offset_y: 0 }
  );
  // width = 1800*1.35 = 2430, height = 2400*1.35 = 3240
  // scaledAspect = 0.75 < 1.0 → constrain height = 2430
  assert.equal(pos.width, 2430);
  assert.equal(pos.height, 2430);
  // Both dimensions overflow → negative ranges, centered
  assert.ok(pos.width > pos.area_width);
});

test("layout with offset moves position within range", () => {
  const pos = buildPositionFromLayout(
    { width: 1800, height: 2400 },
    { scale: 0.5, offset_x: -100, offset_y: 100 }
  );
  // width = 900, height constrained to 900 (square)
  // leftRange = 1800-900 = 900, offset_x=-100 → left = 900*0 = 0
  // topRange = 2400-900 = 1500, offset_y=100 → top = 1500*1 = 1500
  assert.equal(pos.width, 900);
  assert.equal(pos.height, 900);
  assert.equal(pos.left, 0);
  assert.equal(pos.top, 1500);
});

test("defaults to 1800x2400 area when fileSpec is empty", () => {
  const pos = buildPositionFromLayout({}, null);
  assert.equal(pos.area_width, 1800);
  assert.equal(pos.area_height, 2400);
  assert.equal(pos.width, 1800);
  assert.equal(pos.height, 1800);
});
