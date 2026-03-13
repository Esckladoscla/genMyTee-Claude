import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createExperiment,
  assignVariant,
  trackEvent,
  getExperimentResults,
  listExperiments,
  isAbTestingEnabled,
  _resetAbTestingForTests,
} from "../services/ab-testing.js";

describe("ab-testing", () => {
  beforeEach(() => {
    process.env.AB_TESTING_ENABLED = "true";
    process.env.APP_DB_PATH = ":memory:";
    _resetAbTestingForTests();
  });

  afterEach(() => {
    delete process.env.AB_TESTING_ENABLED;
    delete process.env.APP_DB_PATH;
    _resetAbTestingForTests();
  });

  test("isAbTestingEnabled returns false by default", () => {
    delete process.env.AB_TESTING_ENABLED;
    assert.equal(isAbTestingEnabled(), false);
  });

  test("isAbTestingEnabled returns true when set", () => {
    assert.equal(isAbTestingEnabled(), true);
  });

  test("createExperiment creates experiment with default variants", () => {
    const exp = createExperiment("hero_cta_test");
    assert.ok(exp.id.startsWith("exp_"));
    assert.equal(exp.name, "hero_cta_test");
    assert.deepEqual(exp.variants, ["control", "variant_a"]);
    assert.equal(exp.active, true);
  });

  test("createExperiment accepts custom variants", () => {
    const exp = createExperiment("pricing_test", ["low", "medium", "high"]);
    assert.deepEqual(exp.variants, ["low", "medium", "high"]);
  });

  test("listExperiments returns all experiments", () => {
    createExperiment("test_1");
    createExperiment("test_2");
    const list = listExperiments();
    assert.equal(list.length, 2);
  });

  test("assignVariant returns consistent result for same session", () => {
    const exp = createExperiment("consistency_test");
    const v1 = assignVariant(exp.id, "session_abc");
    const v2 = assignVariant(exp.id, "session_abc");
    assert.equal(v1, v2);
    assert.ok(exp.variants.includes(v1));
  });

  test("assignVariant returns null when disabled", () => {
    delete process.env.AB_TESTING_ENABLED;
    const exp = createExperiment("disabled_test");
    const variant = assignVariant(exp.id, "session_xyz");
    assert.equal(variant, null);
  });

  test("trackEvent records an event", () => {
    const exp = createExperiment("event_test");
    assignVariant(exp.id, "session_1");
    trackEvent(exp.id, "session_1", "click_cta");
    trackEvent(exp.id, "session_1", "click_cta");
    trackEvent(exp.id, "session_1", "purchase");

    const results = getExperimentResults(exp.id);
    const variant = results.results[assignVariant(exp.id, "session_1")];
    assert.equal(variant.events.click_cta, 2);
    assert.equal(variant.events.purchase, 1);
  });

  test("getExperimentResults returns null for unknown experiment", () => {
    const result = getExperimentResults("exp_nonexistent");
    assert.equal(result, null);
  });

  test("getExperimentResults shows assigned counts per variant", () => {
    const exp = createExperiment("results_test");
    // Assign multiple sessions
    for (let i = 0; i < 10; i++) {
      assignVariant(exp.id, `session_${i}`);
    }
    const results = getExperimentResults(exp.id);
    const totalAssigned = Object.values(results.results)
      .reduce((sum, v) => sum + v.assigned, 0);
    assert.equal(totalAssigned, 10);
  });
});
