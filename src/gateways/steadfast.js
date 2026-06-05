import { DeliveryError } from "../errors.js";

const BASE_URL = "https://portal.packzy.com/api/v1";

/**
 * Steadfast Delivery API Adapter
 */

export async function createOrder(config, options) {
    try {
        const response = await fetch(`${BASE_URL}/create_order`, {
            method: "POST",
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
                "Content-Type": "application/json",
            },
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
        });
        console.log(
            JSON.stringify({
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
        );

        console.log(response);

        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new DeliveryError(
                text || "Failed to create order (No JSON returned)",
                "steadfast",
                "API_ERROR",
            );
        }

        if (data.status !== 200) {
            throw new DeliveryError(
                data.message || "Failed to create order",
                "steadfast",
                "API_ERROR",
            );
        }

        return {
            gateway: "steadfast",
            status: "created",
            trackingId:
                data.consignment?.consignment_id?.toString() ||
                data.consignment?.tracking_code,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function createBulkOrder(config, options) {
    if (!options.data || !Array.isArray(options.data)) {
        throw new DeliveryError(
            "data array is required for createBulkOrder",
            "steadfast",
            "MISSING_PARAM",
        );
    }
    try {
        const response = await fetch(`${BASE_URL}/create_order/bulk-order`, {
            method: "POST",
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                data: options.data,
            }),
        });

        const data = await response.json();

        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
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
        throw new DeliveryError(
            "trackingId, invoice, or trackingCode is required for trackOrder",
            "steadfast",
            "MISSING_PARAM",
        );
    }

    try {
        const response = await fetch(url, {
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
            },
        });

        if (!response.ok) {
            throw new DeliveryError(
                `Failed to fetch status: ${response.status}`,
                "steadfast",
                "API_ERROR",
            );
        }

        const data = await response.json();

        if (data.status === 404 || !data.delivery_status) {
            throw new DeliveryError(
                data.message || "Tracking not found",
                "steadfast",
                "NOT_FOUND",
            );
        }

        return {
            gateway: "steadfast",
            status: data.delivery_status,
            trackingId: identifier,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getBalance(config) {
    try {
        const response = await fetch(`${BASE_URL}/get_balance`, {
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
            },
        });
        const data = await response.json();
        return {
            gateway: "steadfast",
            balance: data.current_balance,
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function createReturnRequest(config, options) {
    try {
        const response = await fetch(`${BASE_URL}/create_return_request`, {
            method: "POST",
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                consignment_id: options.consignment_id,
                invoice: options.invoice,
                tracking_code: options.tracking_code,
                reason: options.reason,
            }),
        });

        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getReturnRequest(config, options) {
    if (!options.id) {
        throw new DeliveryError("id is required", "steadfast", "MISSING_PARAM");
    }
    try {
        const response = await fetch(
            `${BASE_URL}/get_return_request/${options.id}`,
            {
                headers: {
                    "Api-Key": config.apiKey,
                    "Secret-Key": config.secretKey,
                },
            },
        );
        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getReturnRequests(config) {
    try {
        const response = await fetch(`${BASE_URL}/get_return_requests`, {
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
            },
        });
        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPayments(config) {
    try {
        const response = await fetch(`${BASE_URL}/payments`, {
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
            },
        });
        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPayment(config, options) {
    if (!options.payment_id) {
        throw new DeliveryError(
            "payment_id is required",
            "steadfast",
            "MISSING_PARAM",
        );
    }
    try {
        const response = await fetch(
            `${BASE_URL}/payments/${options.payment_id}`,
            {
                headers: {
                    "Api-Key": config.apiKey,
                    "Secret-Key": config.secretKey,
                },
            },
        );
        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function getPoliceStations(config) {
    try {
        const response = await fetch(`${BASE_URL}/police_stations`, {
            headers: {
                "Api-Key": config.apiKey,
                "Secret-Key": config.secretKey,
            },
        });
        const data = await response.json();
        return {
            gateway: "steadfast",
            raw: data,
        };
    } catch (error) {
        throw new DeliveryError(error.message, "steadfast", "API_ERROR");
    }
}

export async function cancelOrder(config, options) {
    if (!options.trackingId) {
        throw new DeliveryError(
            "trackingId is required for cancelOrder",
            "steadfast",
            "MISSING_PARAM",
        );
    }
    return {
        gateway: "steadfast",
        status: "cancelled",
        trackingId: options.trackingId,
    };
}
