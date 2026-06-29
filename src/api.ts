import type { ApiResponse, ReturnTrip } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://t264m53j-3000.inc1.devtunnels.ms';

type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
};

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
    const detail = body.trim().slice(0, 300);
    throw new Error(detail ? `Request failed with ${response.status}: ${detail}` : `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function loadReturnTrips(): Promise<ReturnTrip[]> {
  const payload = await requestJson<ApiResponse>('/api/customer/dev/return-trips');
  return toArray(payload);
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
