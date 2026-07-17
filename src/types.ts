export type AddressPayload = {
  name?: string | null;
  formattedAddress?: string | null;
  address?: string | null;
  city?: string | null;
};

export type CabSnapshot = {
  id?: number | null;
  carType?: string | null;
  carNumber?: string | null;
  vehicleType?: string | null;
  modelYear?: string | number | null;
};

export type ReturnTrip = {
  id: number;
  driverId: number;
  bookingId?: number | string | null;
  bookingState?: string | null;
  pendingRequest?: unknown;
  pendingResponse?: {
    response?: string | null;
    reason?: string | null;
    [key: string]: unknown;
  } | null;
  linkedBooking?: {
    id?: number | string;
    bookingReference?: string | null;
    status?: string | null;
    [key: string]: unknown;
  } | null;
  pickupLocation?: unknown;
  pickupLat?: number | null;
  pickupLong?: number | null;
  driverRating?: string | number | null;
  driverCarType?: string | null;
  pickupCity?: string | null;
  destinationCity?: string | null;
  pickupFormatAddress?: AddressPayload | null;
  dropFormatAddress?: AddressPayload | null;
  cabSnapshot?: CabSnapshot | null;
  driverOfferPrice?: number | string | null;
  finalPrice?: number | string | null;
  discountAmount?: number | string | null;
  estimatedMin?: number | null;
  expiresAt?: string | null;
  status?: string | null;
  minutesToExpiry?: number | null;
  created_at?: string | null;
  zone?: string | null;
  Driver?: {
    id?: number;
    firstName?: string | null;
    lastName?: string | null;
    phoneNumber?: string | null;
    rating?: string | number | null;
    carType?: string | null;
    cabId?: number | null;
  } | null;
};

export type BookingCustomerDraft = {
  phoneNumber: string;
  isExistingCustomer: boolean;
  needsName: boolean;
  name: string;
  welcomeBackMessage: string;
};

export type ApiResponse = {
  success?: boolean;
  code?: number;
  data?: ReturnTrip | ReturnTrip[] | { rows?: ReturnTrip[]; count?: number; totalPages?: number };
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    totalItems?: number;
    itemsPerPage?: number;
  };
};

export type ReturnTripUnavailableEvent = {
  tripIds: Array<number | string>;
  bookedReturnTripId?: number | string | null;
  unavailableReturnTripIds: Array<number | string>;
  reason?: string;
  ts?: number;
};

export type ReturnTripAvailableEvent = {
  tripIds: Array<number | string>;
  availableReturnTripIds: Array<number | string>;
  createdReturnTripId?: number | string | null;
  trip?: ReturnTrip | null;
  reason?: string;
  ts?: number;
};
