import { DeliveryError } from "../errors.js";
import { request } from "../utils.js";

const BASE_URL = "https://portal.packzy.com/api/v1";

export const META = {
    envMap: {
        apiKey: "STEADFAST_API_KEY",
        secretKey: "STEADFAST_SECRET_KEY",
        sandbox: "STEADFAST_SANDBOX",
    },
    requiredKeys: ["apiKey", "secretKey"],
};

function getHeaders(config, isJson = true) {
    const headers = {
        "Api-Key": config.apiKey,
        "Secret-Key": config.secretKey,
    };
    if (isJson) headers["Content-Type"] = "application/json";
    return headers;
}

export async function createOrder(config, options) {
    try {
        const data = await request(`${BASE_URL}/create_order`, {
            method: "POST",
            headers: getHeaders(config),
            body: JSON.stringify({
                invoice: options.invoice,
                recipient_name: options.recipient_name,
                recipient_phone: options.recipient_phone,
                alternative_phone: options.alternative_phone,
                recipient_email: options.recipient_email,
                recipient_address: options.recipient_address,
                cod_amount: options.cod_amount,
                note: options.note,
                item_description: options.item_description,
                total_lot: options.total_lot,
                delivery_type: options.delivery_type,
            }),
        }, "steadfast", "Failed to create order");

        if (data.status !== 200) {
            throw new DeliveryError(data.message || "Failed to create order", "steadfast", "API_ERROR");
        }

        return {
            gateway: "steadfast",
            status: "created",
            trackingId: data.consignment?.consignment_id?.toString() || data.consignment?.tracking_code,
            raw: data,
        };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function createBulkOrder(config, options) {
    if (!options.data || !Array.isArray(options.data)) {
        throw new DeliveryError("data array is required for createBulkOrder", "steadfast", "MISSING_PARAM");
    }
    try {
        const data = await request(`${BASE_URL}/create_order/bulk-order`, {
            method: "POST",
            headers: getHeaders(config),
            body: JSON.stringify({ data: options.data }),
        }, "steadfast", "Failed to create bulk order");

        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function trackOrder(config, options) {
    let url;
    let identifier;

    if (options.trackingId) {
        url = `${BASE_URL}/status_by_cid/${options.trackingId}`;
        identifier = options.trackingId;
    } else if (options.invoice) {
        url = `${BASE_URL}/status_by_invoice/${options.invoice}`;
        identifier = options.invoice;
    } else if (options.trackingCode) {
        url = `${BASE_URL}/status_by_trackingcode/${options.trackingCode}`;
        identifier = options.trackingCode;
    } else {
        throw new DeliveryError("trackingId, invoice, or trackingCode is required for trackOrder", "steadfast", "MISSING_PARAM");
    }

    try {
        const data = await request(url, { headers: getHeaders(config, false) }, "steadfast", "Failed to track order");

        if (data.status === 404 || !data.delivery_status) {
            throw new DeliveryError(data.message || "Tracking not found", "steadfast", "NOT_FOUND");
        }

        return {
            gateway: "steadfast",
            status: data.delivery_status,
            trackingId: identifier,
            raw: data,
        };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getBalance(config) {
    try {
        const data = await request(`${BASE_URL}/get_balance`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get balance");
        return { gateway: "steadfast", balance: data.current_balance, raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function createReturnRequest(config, options) {
    try {
        const data = await request(`${BASE_URL}/create_return_request`, {
            method: "POST",
            headers: getHeaders(config),
            body: JSON.stringify({
                consignment_id: options.consignment_id,
                invoice: options.invoice,
                tracking_code: options.tracking_code,
                reason: options.reason,
            }),
        }, "steadfast", "Failed to create return request");

        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getReturnRequest(config, options) {
    if (!options.id) throw new DeliveryError("id is required", "steadfast", "MISSING_PARAM");
    try {
        const data = await request(`${BASE_URL}/get_return_request/${options.id}`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get return request");
        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getReturnRequests(config) {
    try {
        const data = await request(`${BASE_URL}/get_return_requests`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get return requests");
        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPayments(config) {
    try {
        const data = await request(`${BASE_URL}/payments`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get payments");
        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPayment(config, options) {
    if (!options.payment_id) throw new DeliveryError("payment_id is required", "steadfast", "MISSING_PARAM");
    try {
        const data = await request(`${BASE_URL}/payments/${options.payment_id}`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get payment");
        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPoliceStations(config) {
    try {
        const data = await request(`${BASE_URL}/police_stations`, { headers: getHeaders(config, false) }, "steadfast", "Failed to get police stations");
        return { gateway: "steadfast", raw: data };
    } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function cancelOrder(config, options) {
    if (!options.trackingId) throw new DeliveryError("trackingId is required for cancelOrder", "steadfast", "MISSING_PARAM");
    return { gateway: "steadfast", status: "cancelled", trackingId: options.trackingId };
}
