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
  finalPrice?: number | string | null;
  discountAmount?: number | string | null;
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
  data?: ReturnTrip[] | { rows?: ReturnTrip[]; count?: number; totalPages?: number };
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    totalItems?: number;
    itemsPerPage?: number;
  };
};
