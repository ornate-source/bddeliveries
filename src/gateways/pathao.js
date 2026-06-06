import { DeliveryError } from "../errors.js";

function getBaseUrl(config) {
    // If the config specifies sandbox mode or a custom URL, use it, else use live Pathao API URL
    if (config.baseUrl) return config.baseUrl;
    if (config.sandbox) return "https://courier-api-sandbox.pathao.com";
    return "https://api-hermes.pathao.com";
}

async function handleResponse(response, contextMessage) {
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        let errorMsg = text || contextMessage;
        if (!response.ok) {
            errorMsg = `Pathao API Error ${response.status} ${response.statusText} - The endpoint might be incorrect or unavailable.`;
        }
        throw new DeliveryError(errorMsg, "pathao", "API_ERROR");
    }

    if (
        data.type === "error" ||
        (data.code && data.code !== 200 && data.code !== 202)
    ) {
        const validationErrors = data.errors ? Object.values(data.errors).flat().join(", ") : null;
        const errorDetail =
            validationErrors ||
            data.message ||
            contextMessage;
        throw new DeliveryError(errorDetail, "pathao", "API_ERROR");
    }

    return data;
}

async function getAccessToken(config) {
    // Note: In a production app, the token should be cached and refreshed using `refresh_token`.
    // We are requesting a new token dynamically here for simplicity and safety.
    if (
        !config.clientId ||
        !config.clientSecret ||
        !config.username ||
        !config.password
    ) {
        throw new DeliveryError(
            "clientId, clientSecret, username, and password are required for Pathao",
            "pathao",
            "MISSING_PARAM",
        );
    }

    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "password",
            username: config.username,
            password: config.password,
        }),
    });

    const data = await handleResponse(response, "Failed to issue access token");
    if (!data.access_token) {
        throw new DeliveryError(
            "Failed to obtain Pathao access token",
            "pathao",
            "AUTH_ERROR",
        );
    }
    return data.access_token;
}

async function getStoresList(token, baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/aladdin/api/v1/stores`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        const data = await handleResponse(response, "Failed to fetch stores");
        if (data && data.data && Array.isArray(data.data.data)) {
            return data.data.data;
        }
    } catch (e) {
        console.error("Failed to fetch stores list:", e);
    }
    return [];
}

/**
 * Pathao Delivery API Adapter
 */

export async function createOrder(config, options) {
    try {
        const token = await getAccessToken(config);
        const baseUrl = getBaseUrl(config);

        const storeId = config.storeId || options.store_id;
        if (!storeId) {
            throw new DeliveryError(
                "storeId is required for Pathao",
                "pathao",
                "MISSING_PARAM",
            );
        }

        let phone = (options.recipient_phone || "").toString().replace(/\s+/g, "");
        if (phone.startsWith("+88")) {
            phone = phone.substring(3);
        } else if (phone.startsWith("88")) {
            phone = phone.substring(2);
        }

        let address = (options.recipient_address || "").trim();
        if (address.length < 10) {
            address = address.padEnd(10, " ");
        }

        const payload = {
            store_id: Number(storeId),
            merchant_order_id:
                (options.invoice || options.merchant_order_id || "").toString(),
            recipient_name: options.recipient_name,
            recipient_phone: phone,
            recipient_address: address,
            delivery_type: options.delivery_type || 48, // 48 = Normal Delivery
            item_type: options.item_type || 2, // 2 = Parcel
            special_instruction: options.note || "",
            item_quantity: options.item_quantity || 1,
            item_weight: parseFloat(options.item_weight || 0.5),
            item_description: options.item_description || "Order Fulfillment",
            amount_to_collect: Math.round(options.cod_amount || 0),
        };

        // Add optional fields only if they exist to prevent validation errors
        if (options.city_id) payload.recipient_city = Number(options.city_id);
        if (options.zone_id) payload.recipient_zone = Number(options.zone_id);
        if (options.area_id) payload.recipient_area = Number(options.area_id);

        const response = await fetch(`${baseUrl}/aladdin/api/v1/orders`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        let data;
        try {
            data = await handleResponse(response, "Failed to create order");
        } catch (error) {
            if (error instanceof DeliveryError && error.message.includes("Wrong Store")) {
                const stores = await getStoresList(token, baseUrl);
                if (stores.length > 0) {
                    const storeDetails = stores
                        .map(s => `* ${s.store_name} (ID: ${s.store_id})`)
                        .join("\n");
                    throw new DeliveryError(
                        `Wrong Store selected. Available stores:\n${storeDetails}`,
                        "pathao",
                        "API_ERROR"
                    );
                }
            }
            throw error;
        }

        return {
            gateway: "pathao",
            status: "created",
            trackingId: data.data?.consignment_id,
            raw: data,
        };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "pathao", "API_ERROR");
    }
}

export async function trackOrder(config, options) {
    if (!options.trackingId) {
        throw new DeliveryError(
            "trackingId (consignment_id) is required for trackOrder",
            "pathao",
            "MISSING_PARAM",
        );
    }

    try {
        const token = await getAccessToken(config);
        const baseUrl = getBaseUrl(config);

        const response = await fetch(
            `${baseUrl}/aladdin/api/v1/orders/${options.trackingId}/info`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            },
        );

        const data = await handleResponse(response, "Failed to track order");

        const rawStatus =
            data.data?.order_status_slug?.toLowerCase() || "processing";
        let status = rawStatus;

        if (rawStatus.includes("delivered")) status = "delivered";
        else if (rawStatus.includes("return")) status = "returned";
        else if (rawStatus.includes("transit")) status = "in_transit";
        else if (rawStatus.includes("pick")) status = "picked_up";

        return {
            gateway: "pathao",
            status,
            trackingId: options.trackingId,
            raw: data,
        };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "pathao", "API_ERROR");
    }
}

export async function cancelOrder(config, options) {
    if (!options.trackingId) {
        throw new DeliveryError(
            "trackingId is required for cancelOrder",
            "pathao",
            "MISSING_PARAM",
        );
    }

    // Pathao Courier API does not expose a public endpoint for order cancellation
    // Cancellations must be performed manually via the Pathao Merchant Panel
    throw new DeliveryError(
        "Pathao API does not support order cancellation. Please cancel via the Merchant Panel.",
        "pathao",
        "NOT_SUPPORTED",
    );
}
