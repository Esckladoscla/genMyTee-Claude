/**
 * Service registry — centralizes access to all external service dependencies.
 *
 * This registry allows swapping providers for testing and multi-provider
 * configurations without modifying route or business logic.
 *
 * Usage:
 *   import { getService, registerService } from "./services/registry.js";
 *   const storage = getService("storage");
 *   await storage.uploadImageBuffer(buffer, options);
 *
 * Default registrations are loaded from the real service modules.
 * Override with registerService() for testing or provider swaps.
 */

const services = new Map();

/**
 * Register a service implementation.
 * @param {string} name - Service name (e.g., "storage", "image", "fulfillment")
 * @param {object} implementation - Object with the service methods
 */
export function registerService(name, implementation) {
  services.set(name, implementation);
}

/**
 * Get a registered service. Throws if not registered.
 * @param {string} name
 * @returns {object}
 */
export function getService(name) {
  const service = services.get(name);
  if (!service) {
    throw new Error(`Service "${name}" is not registered. Register it with registerService().`);
  }
  return service;
}

/**
 * Check if a service is registered.
 * @param {string} name
 * @returns {boolean}
 */
export function hasService(name) {
  return services.has(name);
}

/**
 * List all registered service names.
 * @returns {string[]}
 */
export function listServices() {
  return [...services.keys()];
}

/**
 * Reset all registrations (for tests).
 */
export function _resetRegistryForTests() {
  services.clear();
}

// ── Default registrations ──
// Loaded lazily to avoid circular dependencies

let defaultsLoaded = false;

export async function loadDefaults() {
  if (defaultsLoaded) return;

  const [storage, openai, printful, stripe] = await Promise.all([
    import("./storage.js"),
    import("./openai.js"),
    import("./printful.js"),
    import("./stripe.js"),
  ]);

  if (!services.has("storage")) {
    registerService("storage", {
      uploadImageBuffer: storage.uploadImageBuffer,
    });
  }

  if (!services.has("image")) {
    registerService("image", {
      generateImage: openai.generateImageFromPrompt,
      moderatePrompt: openai.moderatePrompt,
      normalizePrompt: openai.normalizePrompt,
    });
  }

  if (!services.has("fulfillment")) {
    registerService("fulfillment", {
      createOrder: printful.createPrintfulOrder,
      generateMockup: printful.generateMockupForVariant,
      getMockupTask: printful.getMockupTask,
    });
  }

  if (!services.has("payments")) {
    registerService("payments", {
      createCheckoutSession: stripe.createCheckoutSession,
      verifyWebhookSignature: stripe.verifyWebhookSignature,
      extractOrderFromSession: stripe.extractOrderFromSession,
    });
  }

  defaultsLoaded = true;
}
