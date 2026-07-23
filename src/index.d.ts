/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class DeliveryError extends Error {
  readonly gateway: string;
  readonly code: string;
  readonly originalError: unknown;
  /** HTTP status, when the error came from a response. */
  readonly statusCode?: number;
  /** Redacted response body, when available. */
  readonly responseBody?: unknown;
  constructor(message: string, gateway: string, code: string, originalError?: unknown);
  toJSON(): Record<string, unknown>;
}

export class GatewayNotFoundError extends DeliveryError {
  readonly supportedGateways: string[];
  constructor(gatewayName: string, supported?: string[]);
}

export class ConfigurationError extends DeliveryError {
  readonly missingKeys: string[];
  constructor(gateway: string, missingKeys: string[] | string);
}

export class ValidationError extends DeliveryError {
  readonly fields: string[];
  constructor(message: string, gateway: string, fields?: string[]);
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type DeliveryStatus =
  | "pending"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "partial_delivered"
  | "returned"
  | "cancelled"
  | "on_hold"
  | "failed"
  | "unknown";

export const STATUS: {
  readonly PENDING: "pending";
  readonly PICKED_UP: "picked_up";
  readonly IN_TRANSIT: "in_transit";
  readonly DELIVERED: "delivered";
  readonly PARTIAL_DELIVERED: "partial_delivered";
  readonly RETURNED: "returned";
  readonly CANCELLED: "cancelled";
  readonly ON_HOLD: "on_hold";
  readonly FAILED: "failed";
  readonly UNKNOWN: "unknown";
};

export interface DeliveryResult<TRaw = unknown> {
  gateway: GatewayName;
  /** Canonical status. Never a raw provider string. */
  status: DeliveryStatus;
  /** The provider's own status value, preserved verbatim. */
  providerStatus?: string | null;
  trackingId?: string;
  /** Paperfly returns its own tracking number alongside the merchant reference. */
  providerTrackingNumber?: string;
  /** Steadfast returns a tracking code alongside the consignment id. */
  trackingCode?: string;
  raw: TRaw;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export type GatewayName = "pathao" | "steadfast" | "paperfly";

/** Transport options accepted by every gateway. */
export interface TransportOptions {
  /** Override the API host. Also the way to point a gateway at a test endpoint. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Retry attempts for idempotent requests. Default 2. Never applied to createOrder. */
  retries?: number;
  retryBaseMs?: number;
  signal?: AbortSignal;
}

export interface PathaoConfig extends TransportOptions {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  storeId?: string | number;
  sandbox?: boolean;
}

export interface SteadfastConfig extends TransportOptions {
  apiKey?: string;
  secretKey?: string;
  /** Steadfast publishes no sandbox host; setting this throws. Use `baseUrl`. */
  sandbox?: boolean;
}

export interface PaperflyConfig extends TransportOptions {
  username?: string;
  password?: string;
  paperflyKey?: string;
  /** Paperfly publishes no sandbox host; setting this throws. Use `baseUrl`. */
  sandbox?: boolean;
}

export interface GatewayConfigs {
  pathao?: PathaoConfig;
  steadfast?: SteadfastConfig;
  paperfly?: PaperflyConfig;
}

export function configure(configs: GatewayConfigs): void;
export function unconfigure(gateway: GatewayName): boolean;
export function clearConfig(): void;
export function clearTokenCaches(): void;
export function getSupportedGateways(): GatewayName[];

/* ------------------------------------------------------------------ *
 * Order options
 *
 * These deliberately have no `[key: string]: any` index signature: it would defeat
 * excess-property checking, which is what catches a field name meant for a different
 * gateway. Use `extra` for anything unmodelled.
 * ------------------------------------------------------------------ */

interface CommonOrderFields {
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  /** Merchant's own order reference. */
  invoice: string;
  codAmount?: number;
  note?: string;
  itemDescription?: string;
  extra?: Record<string, unknown>;
}

export interface PathaoCreateOrderOptions
  extends CommonOrderFields,
    PathaoConfig {
  gateway: "pathao";
  /** Required — via options, configure(), or PATHAO_STORE_ID. */
  storeId?: string | number;
  /** Pathao requires at least 10 characters. */
  recipientAddress: string;
  deliveryType?: number;
  itemType?: number;
  itemQuantity?: number;
  /** Between 0.5 and 10 kg. */
  itemWeight?: number;
  cityId?: number;
  zoneId?: number;
  areaId?: number;
}

export interface SteadfastCreateOrderOptions
  extends CommonOrderFields,
    SteadfastConfig {
  gateway: "steadfast";
  alternativePhone?: string;
  recipientEmail?: string;
  totalLot?: number;
  deliveryType?: string | number;
}

export interface PaperflyCreateOrderOptions
  extends CommonOrderFields,
    PaperflyConfig {
  gateway: "paperfly";
  storeName?: string;
  maxWeight?: number;
}

export type CreateOrderOptions =
  | PathaoCreateOrderOptions
  | SteadfastCreateOrderOptions
  | PaperflyCreateOrderOptions;

export interface TrackOrderOptions extends TransportOptions {
  gateway: GatewayName;
  trackingId?: string;
  /** Steadfast only: track by merchant invoice instead of consignment id. */
  invoice?: string;
  /** Steadfast only: track by tracking code. */
  trackingCode?: string;
  [credential: string]: unknown;
}

export interface CancelOrderOptions extends TransportOptions {
  gateway: GatewayName;
  trackingId: string;
  [credential: string]: unknown;
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

export function createOrder(options: CreateOrderOptions): Promise<DeliveryResult>;
export function trackOrder(options: TrackOrderOptions): Promise<DeliveryResult>;
export function cancelOrder(options: CancelOrderOptions): Promise<DeliveryResult>;

export type GatewayMethod =
  | "createOrder"
  | "trackOrder"
  | "cancelOrder"
  | "createBulkOrder"
  | "getBalance"
  | "createReturnRequest"
  | "getReturnRequest"
  | "getReturnRequests"
  | "getPayments"
  | "getPayment"
  | "getPoliceStations"
  | "getStores";

export interface CallGatewayOptions extends TransportOptions {
  gateway: GatewayName;
  method: GatewayMethod;
  [option: string]: unknown;
}

/** Call a gateway-specific operation with no cross-gateway equivalent. */
export function callGateway<T = any>(options: CallGatewayOptions): Promise<T>;

export function getGatewayCapabilities(
  gateway: GatewayName
): Promise<Record<GatewayMethod, boolean>>;

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/**
 * An isolated client with its own credential store. Use instead of the global
 * `configure()` when one process serves several merchants.
 */
export class DeliveryClient {
  constructor(configs?: GatewayConfigs);
  configure(configs: GatewayConfigs): this;
  unconfigure(gateway: GatewayName): boolean;
  clearConfig(): this;
  createOrder(options: CreateOrderOptions): Promise<DeliveryResult>;
  trackOrder(options: TrackOrderOptions): Promise<DeliveryResult>;
  cancelOrder(options: CancelOrderOptions): Promise<DeliveryResult>;
  callGateway<T = any>(options: CallGatewayOptions): Promise<T>;
}
