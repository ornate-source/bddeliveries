import { DeliveryError } from "../errors.js";

const BASE_URL = "https://api.paperfly.com.bd";

function getBasicAuth(config) {
    if (!config.username || !config.password) {
        throw new DeliveryError(
            "Username and password are required for Paperfly",
            "paperfly",
            "MISSING_PARAM",
        );
    }
    const credentials = `${config.username}:${config.password}`;
    const base64 =
        typeof btoa === "function"
            ? btoa(credentials)
            : Buffer.from(credentials).toString("base64");
    return "Basic " + base64;
}

async function handleResponse(response, contextMessage) {
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        let errorMsg = text || contextMessage;
        if (!response.ok) {
            errorMsg = `Paperfly API Error ${response.status} ${response.statusText} - The endpoint might be incorrect or unavailable.`;
        }
        throw new DeliveryError(errorMsg, "paperfly", "API_ERROR");
    }
    return data;
}

/**
 * Paperfly Delivery API Adapter
 */

export async function createOrder(config, options) {
    try {
        const reference = options.invoice || options.merchantOrderReference;
        if (!reference) {
            throw new DeliveryError(
                "invoice or merchantOrderReference is required",
                "paperfly",
                "MISSING_PARAM",
            );
        }

        const payload = {
            merchantOrderReference: reference,
            storeName: options.storeName || "",
            productBrief:
                options.item_description || options.productBrief || "Product",
            packagePrice:
                options.cod_amount?.toString() || options.packagePrice || "0",
            max_weight: options.max_weight?.toString() || "0.5",
            customerName:
                options.recipient_name || options.customerName || "Customer",
            customerAddress:
                options.recipient_address || options.customerAddress || "",
            customerPhone:
                options.recipient_phone || options.customerPhone || "",
        };

        const response = await fetch(
            `${BASE_URL}/merchant/api/service/new_order_v2.php`,
            {
                method: "POST",
                headers: {
                    Authorization: getBasicAuth(config),
                    paperflykey: config.paperflyKey || "Paperfly_~La?Rj73FcLm",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );

        const data = await handleResponse(response, "Failed to create order");

        if (String(data.response_code) !== "200") {
            throw new DeliveryError(
                data.error?.message ||
                    data.success?.message ||
                    "Failed to create order",
                "paperfly",
                "API_ERROR",
            );
        }

        return {
            gateway: "paperfly",
            status: "created",
            trackingId: reference,
            providerTrackingNumber: data.success?.tracking_number,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "paperfly", "API_ERROR");
    }
}

export async function trackOrder(config, options) {
    if (!options.trackingId) {
        throw new DeliveryError(
            "trackingId (ReferenceNumber) is required for trackOrder",
            "paperfly",
            "MISSING_PARAM",
        );
    }

    try {
        const response = await fetch(`${BASE_URL}/API-Order-Tracking`, {
            method: "POST",
            headers: {
                Authorization: getBasicAuth(config),
                paperflykey: config.paperflyKey || "Paperfly_~La?Rj73FcLm",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ReferenceNumber: options.trackingId,
            }),
        });

        const data = await handleResponse(response, "Failed to track order");

        if (String(data.response_code) !== "200") {
            throw new DeliveryError(
                data.error?.message ||
                    data.success?.message ||
                    "Failed to track order",
                "paperfly",
                "API_ERROR",
            );
        }

        const statusData = data.success?.trackingStatus?.[0] || {};
        let status = "processing";
        if (statusData.Delivered) status = "delivered";
        else if (statusData.Returned) status = "returned";
        else if (statusData.inTransit) status = "in_transit";
        else if (statusData.Pick) status = "picked_up";

        return {
            gateway: "paperfly",
            status,
            trackingId: options.trackingId,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "paperfly", "API_ERROR");
    }
}

export async function cancelOrder(config, options) {
    if (!options.trackingId) {
        throw new DeliveryError(
            "trackingId (order_id) is required for cancelOrder",
            "paperfly",
            "MISSING_PARAM",
        );
    }

    try {
        const response = await fetch(`${BASE_URL}/api/v1/cancel-order`, {
            method: "POST",
            headers: {
                Authorization: getBasicAuth(config),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                order_id: options.trackingId,
            }),
        });

        const data = await handleResponse(response, "Failed to cancel order");

        if (String(data.response_code) !== "200" && String(data.success?.response_code) !== "200") {
            throw new DeliveryError(
                data.error?.message ||
                    data.success?.message ||
                    "Failed to cancel order",
                "paperfly",
                "API_ERROR",
            );
        }

        return {
            gateway: "paperfly",
            status: "cancelled",
            trackingId: options.trackingId,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "paperfly", "API_ERROR");
    }
}
