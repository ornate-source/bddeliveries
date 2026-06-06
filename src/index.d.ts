export function configure(configs: Record<string, any>): void;
export function clearConfig(): void;

export class DeliveryError extends Error {
  gateway: string;
  code: string;
  originalError: any;
  constructor(message: string, gateway: string, code: string, originalError?: any);
}

export class GatewayNotFoundError extends DeliveryError {
  constructor(gatewayName: string);
}

export class ConfigurationError extends DeliveryError {
  missingKeys: string[];
  constructor(gateway: string, missingKeys: string[]);
}

export function getSupportedGateways(): string[];

export interface BaseOptions {
  gateway: 'pathao' | 'steadfast' | 'paperfly' | string;
  [key: string]: any;
}

export interface CreateOrderOptions extends BaseOptions {
  // specific fields like recipientName, address, phone, amount etc.
}

export interface TrackOrderOptions extends BaseOptions {
  trackingId: string;
}

export interface CancelOrderOptions extends BaseOptions {
  trackingId: string;
}

export function createOrder(options: CreateOrderOptions): Promise<any>;
export function trackOrder(options: TrackOrderOptions): Promise<any>;
export function cancelOrder(options: CancelOrderOptions): Promise<any>;
