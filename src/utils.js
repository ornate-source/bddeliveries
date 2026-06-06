import { DeliveryError } from "./errors.js";

/**
 * Standardize phone numbers by stripping country code +88 or 88,
 * and removing spaces.
 * @param {string|number} phone 
 * @returns {string} Normalized phone number.
 */
export function normalizePhone(phone) {
  let p = (phone || "").toString().replace(/\s+/g, "");
  if (p.startsWith("+88")) {
    p = p.substring(3);
  } else if (p.startsWith("88")) {
    p = p.substring(2);
  }
  return p;
}

/**
 * Perform a fetch request and handle JSON parsing and generic errors.
 * Adapters should perform their own logical error checks on the returned data.
 * 
 * @param {string} url 
 * @param {object} options 
 * @param {string} gatewayName 
 * @param {string} contextMessage 
 * @returns {Promise<any>} Parsed JSON data.
 */
export async function request(url, options, gatewayName, contextMessage) {
  const response = await fetch(url, options);
  const text = await response.text();
  
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    let errorMsg = text || contextMessage;
    if (!response.ok) {
      errorMsg = `${gatewayName} API Error ${response.status} ${response.statusText} - The endpoint might be incorrect or unavailable.`;
    }
    throw new DeliveryError(errorMsg, gatewayName, "API_ERROR");
  }

  // Basic HTTP level error throwing, though gateways often return 200 with logical errors.
  if (!response.ok) {
    // Attempt to extract common error fields
    const validationErrors = data.errors ? Object.values(data.errors).flat().join(", ") : null;
    const errorDetail = validationErrors || data.message || contextMessage;
    throw new DeliveryError(errorDetail, gatewayName, "API_ERROR");
  }

  return data;
}
