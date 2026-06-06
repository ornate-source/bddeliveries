import { DeliveryError } from "../errors.js";
import { request, normalizePhone } from "../utils.js";

export const META = {
    envMap: {
        clientId: "PATHAO_CLIENT_ID",
        clientSecret: "PATHAO_CLIENT_SECRET",
        username: "PATHAO_USERNAME",
        password: "PATHAO_PASSWORD",
        sandbox: "PATHAO_SANDBOX",
    },
    requiredKeys: ["clientId", "clientSecret", "username", "password"],
};

function getBaseUrl(config) {
    if (config.baseUrl) return config.baseUrl;
    if (config.sandbox) return "https://courier-api-sandbox.pathao.com";
    return "https://api-hermes.pathao.com";
}

async function pathaoRequest(url, options, contextMessage) {
    const data = await request(url, options, "pathao", contextMessage);
    
    // Pathao returns 200 OK for logical errors like validation failures
    if (data.type === "error" || (data.code && data.code !== 200 && data.code !== 202)) {
        const validationErrors = data.errors ? Object.values(data.errors).flat().join(", ") : null;
        const errorDetail = validationErrors || data.message || contextMessage;
        throw new DeliveryError(errorDetail, "pathao", "API_ERROR");
    }
    return data;
}

async function getAccessToken(config) {
    const baseUrl = getBaseUrl(config);
    const data = await pathaoRequest(`${baseUrl}/aladdin/api/v1/issue-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "password",
            username: config.username,
            password: config.password,
        }),
    }, "Failed to issue access token");

    if (!data.access_token) {
        throw new DeliveryError("Failed to obtain Pathao access token", "pathao", "AUTH_ERROR");
    }
    return data.access_token;
}

async function getStoresList(token, baseUrl) {
    try {
        const data = await pathaoRequest(`${baseUrl}/aladdin/api/v1/stores`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        }, "Failed to fetch stores");

        if (data?.data?.data && Array.isArray(data.data.data)) {
            return data.data.data;
        }
    } catch (e) {
        console.error("Failed to fetch stores list:", e);
    }
    return [];
}

export async function createOrder(config, options) {
    try {
        const token = await getAccessToken(config);
        const baseUrl = getBaseUrl(config);

        const storeId = config.storeId || options.store_id;
        if (!storeId) {
            throw new DeliveryError("storeId is required for Pathao", "pathao", "MISSING_PARAM");
        }

        const phone = normalizePhone(options.recipient_phone);
        let address = (options.recipient_address || "").trim();
        if (address.length < 10) address = address.padEnd(10, " ");

        const payload = {
            store_id: Number(storeId),
            merchant_order_id: (options.invoice || options.merchant_order_id || "").toString(),
            recipient_name: options.recipient_name,
            recipient_phone: phone,
            recipient_address: address,
            delivery_type: options.delivery_type || 48,
            item_type: options.item_type || 2,
            special_instruction: options.note || "",
            item_quantity: options.item_quantity || 1,
            item_weight: parseFloat(options.item_weight || 0.5),
            item_description: options.item_description || "Order Fulfillment",
            amount_to_collect: Math.round(options.cod_amount || 0),
        };

        if (options.city_id) payload.recipient_city = Number(options.city_id);
        if (options.zone_id) payload.recipient_zone = Number(options.zone_id);
        if (options.area_id) payload.recipient_area = Number(options.area_id);

        let data;
        try {
            data = await pathaoRequest(`${baseUrl}/aladdin/api/v1/orders`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            }, "Failed to create order");
        } catch (error) {
            if (error instanceof DeliveryError && error.message.includes("Wrong Store")) {
                const stores = await getStoresList(token, baseUrl);
                if (stores.length > 0) {
                    const storeDetails = stores.map(s => `* ${s.store_name} (ID: ${s.store_id})`).join("\n");
                    throw new DeliveryError(`Wrong Store selected. Available stores:\n${storeDetails}`, "pathao", "API_ERROR");
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
        throw new DeliveryError("trackingId (consignment_id) is required for trackOrder", "pathao", "MISSING_PARAM");
    }

    try {
        const token = await getAccessToken(config);
        const baseUrl = getBaseUrl(config);

        const data = await pathaoRequest(`${baseUrl}/aladdin/api/v1/orders/${options.trackingId}/info`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        }, "Failed to track order");

        const rawStatus = data.data?.order_status_slug?.toLowerCase() || "processing";
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
        throw new DeliveryError("trackingId is required for cancelOrder", "pathao", "MISSING_PARAM");
    }
    throw new DeliveryError("Pathao API does not support order cancellation. Please cancel via the Merchant Panel.", "pathao", "NOT_SUPPORTED");
}
