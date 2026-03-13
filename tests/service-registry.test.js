import test from "node:test";
import assert from "node:assert/strict";
import {
  registerService,
  getService,
  hasService,
  listServices,
  _resetRegistryForTests,
} from "../services/registry.js";

test.beforeEach(() => {
  _resetRegistryForTests();
});

test.afterEach(() => {
  _resetRegistryForTests();
});

test("registerService and getService work", () => {
  const mockStorage = { upload: () => "ok" };
  registerService("storage", mockStorage);
  const result = getService("storage");
  assert.equal(result, mockStorage);
  assert.equal(result.upload(), "ok");
});

test("getService throws for unregistered service", () => {
  assert.throws(
    () => getService("nonexistent"),
    /Service "nonexistent" is not registered/
  );
});

test("hasService returns true/false correctly", () => {
  assert.equal(hasService("test"), false);
  registerService("test", { fn: () => {} });
  assert.equal(hasService("test"), true);
});

test("listServices returns all registered names", () => {
  registerService("a", {});
  registerService("b", {});
  registerService("c", {});
  const names = listServices();
  assert.deepEqual(names.sort(), ["a", "b", "c"]);
});

test("registerService overwrites previous registration", () => {
  registerService("x", { version: 1 });
  registerService("x", { version: 2 });
  assert.equal(getService("x").version, 2);
});

test("_resetRegistryForTests clears all services", () => {
  registerService("a", {});
  registerService("b", {});
  _resetRegistryForTests();
  assert.equal(listServices().length, 0);
  assert.equal(hasService("a"), false);
});
