import type { ApiResponse, ReturnTrip, ReturnTripAvailableEvent, ReturnTripUnavailableEvent } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://t264m53j-3000.inc1.devtunnels.ms';
const RETURN_TRIPS_SSE_PATH = import.meta.env.VITE_RETURN_TRIPS_SSE_PATH || '/api/customer/dev/return-trips/events';
const SSE_DEBUG_PREFIX = '[return-trips:sse]';

type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
};

export class ApiRequestError extends Error {
  status: number;
  code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

type SessionStartResponse = {
  sid?: string;
  sessionId?: string;
  sessionData?: {
    sessionId?: string;
  };
  data?: {
    sid?: string;
  };
};

type CustomerLookupResponse = {
  exists?: boolean;
  needsName?: boolean;
  welcomeBackMessage?: string;
  customer?: {
    firstName?: string;
  };
  data?: {
    exists?: boolean;
    needsName?: boolean;
    welcomeBackMessage?: string;
    customer?: {
      firstName?: string;
    };
  };
};

type OtpVerifyResponse = {
  success?: boolean;
  code?: number;
  action?: string;
  message?: string;
  isNewCustomer?: boolean;
  isVerified?: boolean;
  customerId?: number | string;
  customer?: {
    id?: number | string;
    firstName?: string;
    status?: string;
    phoneNumber?: string;
  };
  data?: {
    success?: boolean;
    code?: number;
    action?: string;
    message?: string;
    isNewCustomer?: boolean;
    isVerified?: boolean;
    customerId?: number | string;
    customer?: {
      id?: number | string;
      firstName?: string;
      status?: string;
      phoneNumber?: string;
    };
  };
};

const toArray = (payload: ApiResponse): ReturnTrip[] => {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray((payload.data as { rows?: ReturnTrip[] } | undefined)?.rows)) {
    return (payload.data as { rows?: ReturnTrip[] }).rows || [];
  }
  return [];
};

const toTrip = (payload: ApiResponse): ReturnTrip | null => {
  if (!payload.data || Array.isArray(payload.data)) return null;
  if ('id' in payload.data) return payload.data as ReturnTrip;
  return null;
};

const normalizeUnavailableEvent = (payload: unknown): ReturnTripUnavailableEvent | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload as {
    tripIds?: Array<number | string>;
    ids?: Array<number | string>;
    bookedReturnTripId?: number | string | null;
    unavailableReturnTripIds?: Array<number | string>;
    reason?: string;
    ts?: number;
    data?: unknown;
  };

  if (source.data !== undefined) {
    return normalizeUnavailableEvent(source.data);
  }

  const tripIds = Array.isArray(source.tripIds)
    ? source.tripIds
    : Array.isArray(source.ids)
      ? source.ids
      : [
        ...(source.bookedReturnTripId !== null && source.bookedReturnTripId !== undefined ? [source.bookedReturnTripId] : []),
        ...(Array.isArray(source.unavailableReturnTripIds) ? source.unavailableReturnTripIds : []),
      ];

  return {
    tripIds,
    bookedReturnTripId: source.bookedReturnTripId ?? null,
    unavailableReturnTripIds: Array.isArray(source.unavailableReturnTripIds) ? source.unavailableReturnTripIds : [],
    reason: source.reason,
    ts: source.ts,
  };
};

const normalizeAvailableEvent = (payload: unknown): ReturnTripAvailableEvent | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload as {
    tripIds?: Array<number | string>;
    ids?: Array<number | string>;
    createdReturnTripId?: number | string | null;
    availableReturnTripIds?: Array<number | string>;
    trip?: ReturnTrip;
    reason?: string;
    ts?: number;
    data?: unknown;
  };

  if (source.data !== undefined) {
    return normalizeAvailableEvent(source.data);
  }

  const tripIds = Array.isArray(source.tripIds)
    ? source.tripIds
    : Array.isArray(source.ids)
      ? source.ids
      : [
        ...(source.createdReturnTripId !== null && source.createdReturnTripId !== undefined ? [source.createdReturnTripId] : []),
        ...(Array.isArray(source.availableReturnTripIds) ? source.availableReturnTripIds : []),
      ];

  return {
    tripIds,
    createdReturnTripId: source.createdReturnTripId ?? null,
    availableReturnTripIds: Array.isArray(source.availableReturnTripIds) ? source.availableReturnTripIds : [],
    trip: source.trip ?? null,
    reason: source.reason,
    ts: source.ts,
  };
};

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let parsedMessage = '';
    let parsedCode: number | undefined;

    try {
      const parsed = JSON.parse(body) as {
        message?: string;
        code?: number;
        data?: { message?: string; code?: number };
      };
      parsedMessage = parsed.message || parsed.data?.message || '';
      parsedCode = parsed.code || parsed.data?.code;
    } catch {
      parsedMessage = '';
    }

    const detail = (parsedMessage || body.trim()).slice(0, 300);
    throw new ApiRequestError(
      detail || `Request failed with ${response.status}`,
      response.status,
      parsedCode,
    );
  }

  return response.json() as Promise<T>;
}

export async function loadReturnTrips(): Promise<ReturnTrip[]> {
  const payload = await requestJson<ApiResponse>('/api/customer/dev/return-trips');
  return toArray(payload);
}

export async function loadReturnTrip(tripId: number | string): Promise<ReturnTrip | null> {
  const payload = await requestJson<ApiResponse>(`/api/customer/dev/return-trips/${tripId}`);
  return toTrip(payload);
}

export function subscribeReturnTripUnavailable(
  onUnavailable: (event: ReturnTripUnavailableEvent) => void,
  onAvailable?: (event: ReturnTripAvailableEvent) => void,
  onConnectionError?: (error: Event) => void,
) {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    console.warn(`${SSE_DEBUG_PREFIX} EventSource is not available in this browser/environment`);
    return () => {};
  }

  console.info(`${SSE_DEBUG_PREFIX} opening stream`, `${API_BASE}${RETURN_TRIPS_SSE_PATH}`);
  const stream = new window.EventSource(`${API_BASE}${RETURN_TRIPS_SSE_PATH}`, { withCredentials: true });

  const dispatchParsedPayload = (payload: unknown) => {
    console.debug(`${SSE_DEBUG_PREFIX} raw payload`, payload);

    const availableEvent = normalizeAvailableEvent(payload);
    if (
      availableEvent &&
      (
        availableEvent.trip !== null ||
        availableEvent.tripIds.length > 0 ||
        availableEvent.availableReturnTripIds.length > 0 ||
        availableEvent.createdReturnTripId !== null
      ) &&
      (availableEvent.reason === 'CREATED' || availableEvent.reason === 'REJECTED')
    ) {
      console.info(`${SSE_DEBUG_PREFIX} parsed available event`, availableEvent);
      onAvailable?.(availableEvent);
      return;
    }

    const unavailableEvent = normalizeUnavailableEvent(payload);
    if (
      unavailableEvent &&
      (
        unavailableEvent.tripIds.length > 0 ||
        unavailableEvent.unavailableReturnTripIds.length > 0 ||
        unavailableEvent.bookedReturnTripId !== null
      )
    ) {
      console.info(`${SSE_DEBUG_PREFIX} parsed unavailable event`, unavailableEvent);
      onUnavailable(unavailableEvent);
      return;
    }

    console.debug(`${SSE_DEBUG_PREFIX} payload ignored`);
  };

  const handleUnavailableMessage = (event: MessageEvent<string>) => {
    try {
      console.debug(`${SSE_DEBUG_PREFIX} named event return_trip_unavailable`, event.data);
      dispatchParsedPayload(JSON.parse(event.data));
    } catch {
      console.warn(`${SSE_DEBUG_PREFIX} failed to parse return_trip_unavailable payload`, event.data);
    }
  };

  const handleAvailableMessage = (event: MessageEvent<string>) => {
    try {
      console.debug(`${SSE_DEBUG_PREFIX} named event return_trip_created/available`, event.data);
      dispatchParsedPayload(JSON.parse(event.data));
    } catch {
      console.warn(`${SSE_DEBUG_PREFIX} failed to parse return_trip_created/available payload`, event.data);
    }
  };

  const handleGenericMessage = (event: MessageEvent<string>) => {
    try {
      console.debug(`${SSE_DEBUG_PREFIX} generic message`, event.data);
      dispatchParsedPayload(JSON.parse(event.data));
    } catch {
      console.debug(`${SSE_DEBUG_PREFIX} ignored non-JSON generic message`, event.data);
    }
  };

  const handleOpen = () => {
    console.info(`${SSE_DEBUG_PREFIX} stream connected`);
  };

  stream.addEventListener('return_trip_unavailable', handleUnavailableMessage as EventListener);
  stream.addEventListener('return_trip_available', handleAvailableMessage as EventListener);
  stream.addEventListener('return_trip_created', handleAvailableMessage as EventListener);
  stream.addEventListener('message', handleGenericMessage as EventListener);
  stream.addEventListener('open', handleOpen as EventListener);
  stream.onerror = (error) => {
    console.warn(`${SSE_DEBUG_PREFIX} stream error`, error);
    onConnectionError?.(error);
  };

  return () => {
    stream.removeEventListener('return_trip_unavailable', handleUnavailableMessage as EventListener);
    stream.removeEventListener('return_trip_available', handleAvailableMessage as EventListener);
    stream.removeEventListener('return_trip_created', handleAvailableMessage as EventListener);
    stream.removeEventListener('message', handleGenericMessage as EventListener);
    stream.removeEventListener('open', handleOpen as EventListener);
    console.info(`${SSE_DEBUG_PREFIX} stream closed`);
    stream.close();
  };
}

export async function startSession(): Promise<string> {
  const payload = await requestJson<SessionStartResponse>('/api/customer/dev/session/start');
  const sid = payload.sid || payload.sessionId || payload.sessionData?.sessionId || payload.data?.sid;
  if (!sid) throw new Error('Session id was not returned by /session/start');
  return sid;
}

export async function lookupCustomer(phoneNumber: string, sid: string) {
  const payload = await requestJson<CustomerLookupResponse>('/api/customer/dev/customer/lookup', {
    method: 'POST',
    headers: {
      token: sid,
    },
    body: {
      phoneNumber,
    },
  });

  const source = payload.data || payload;
  return {
    exists: Boolean(source.exists),
    needsName: Boolean(source.needsName),
    welcomeBackMessage: source.welcomeBackMessage || '',
    firstName: source.customer?.firstName || '',
  };
}

export async function sendCustomerOtp(phoneNumber: string, sid: string) {
  return requestJson('/api/customer/dev/verify', {
    method: 'POST',
    headers: {
      token: sid,
    },
    body: {
      phoneNumber,
      user: 'CUSTOMER',
    },
  });
}

export async function verifyCustomerOtp(otp: string, sid: string, deviceToken: string, deviceId: string) {
  const runVerify = async (logoutAllDevices = false) => {
    const response = await fetch(`${API_BASE}/api/customer/dev/otp-verify`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        token: sid,
      },
      body: JSON.stringify({
        otp: Number(otp),
        deviceToken,
        deviceId,
        ...(logoutAllDevices ? { logoutAllDevices: true } : {}),
      }),
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({} as OtpVerifyResponse));
    return { response, payload };
  };

  let { response, payload } = await runVerify(false);
  let source = payload.data || payload;

  if (!response.ok && !(payload.code === 409 && payload.action === 'LOGOUT_ALL_DEVICES')) {
    throw new Error(payload.message || source.message || `Request failed with ${response.status}`);
  }

  if (payload.code === 409 && payload.action === 'LOGOUT_ALL_DEVICES') {
    return {
      success: false,
      requiresDeviceOverride: true,
      message: 'This phone number is active on another device. Sign out there and continue on this browser?',
      isNewCustomer: false,
      isVerified: false,
      customerId: null,
      customer: source.customer,
      confirmLogoutAllDevices: async () => {
        const retried = await runVerify(true);
        response = retried.response;
        payload = retried.payload;
        source = payload.data || payload;

        if (!response.ok || !(payload.success ?? source.success)) {
          throw new Error('We could not switch this customer to the current browser. Please try again.');
        }

        return {
          success: true,
          requiresDeviceOverride: false,
          message: payload.message || source.message || '',
          isNewCustomer: Boolean(source.isNewCustomer),
          isVerified: Boolean(source.isVerified),
          customerId: source.customerId || source.customer?.id,
          customer: source.customer,
        };
      },
    };
  }

  return {
    success: payload.success ?? source.success ?? true,
    requiresDeviceOverride: false,
    message: payload.message || source.message || '',
    isNewCustomer: Boolean(source.isNewCustomer),
    isVerified: Boolean(source.isVerified),
    customerId: source.customerId || source.customer?.id,
    customer: source.customer,
  };
}

export async function registerCustomer(firstName: string, phoneNumber: string, sid: string) {
  return requestJson('/api/customer/dev/register', {
    method: 'POST',
    headers: {
      token: sid,
    },
    body: {
      firstName,
      phoneNumber,
      source: 'Website',
    },
  });
}

export async function bookReturnTrip(trip: ReturnTrip, firstName: string, phoneNumber: string, sid: string) {
  return requestJson(`/api/customer/dev/return-trips/${trip.id}/book`, {
    method: 'POST',
    headers: {
      token: sid,
    },
    body: {
      firstName,
      phoneNumber,
      source: 'Website',
      pickupLocation: trip.pickupLocation || {
        name: trip.pickupFormatAddress?.formattedAddress || trip.pickupCity || 'Pickup',
        latitude: trip.pickupLat ?? null,
        longitude: trip.pickupLong ?? null,
      },
    },
  });
}
