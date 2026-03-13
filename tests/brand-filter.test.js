import test from "node:test";
import assert from "node:assert/strict";
import {
  checkBrandBlacklist,
  _resetBrandFilterForTests,
} from "../services/brand-filter.js";

test.beforeEach(() => {
  _resetBrandFilterForTests();
});

test("blocks exact brand name (case-insensitive)", () => {
  const result = checkBrandBlacklist("Quiero una camiseta de Nike");
  assert.equal(result.blocked, true);
  assert.equal(result.brand, "Nike");
});

test("blocks brand in mixed case", () => {
  const result = checkBrandBlacklist("diseño estilo ADIDAS retro");
  assert.equal(result.blocked, true);
  assert.equal(result.brand, "Adidas");
});

test("blocks multi-word brands", () => {
  const result = checkBrandBlacklist("un logo de Star Wars galáctico");
  assert.equal(result.blocked, true);
  assert.equal(result.brand, "Star Wars");
});

test("blocks character names", () => {
  const result = checkBrandBlacklist("dibuja a Spider-Man volando");
  assert.equal(result.blocked, true);
  assert.equal(result.brand, "Spider-Man");
});

test("allows generic prompts without brands", () => {
  const result = checkBrandBlacklist("un zorro geométrico mirando la luna");
  assert.equal(result.blocked, false);
  assert.equal(result.brand, undefined);
});

test("allows empty or null prompt", () => {
  assert.equal(checkBrandBlacklist("").blocked, false);
  assert.equal(checkBrandBlacklist(null).blocked, false);
  assert.equal(checkBrandBlacklist(undefined).blocked, false);
});

test("does not false-positive on partial word matches", () => {
  // "mars" should not trigger "Mario" or similar
  const result = checkBrandBlacklist("paisaje de marte con estrellas");
  assert.equal(result.blocked, false);
});

test("blocks Pokémon with accent", () => {
  const result = checkBrandBlacklist("un Pokémon en la selva");
  assert.equal(result.blocked, true);
});
