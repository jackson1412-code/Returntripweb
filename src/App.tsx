import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeIndianRupee,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ChevronRight,
  Filter,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  TimerReset,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import rootCabsLogo from './assets/rootcabs-logo.svg';
import {
  ApiRequestError,
  bookReturnTrip,
  loadBookingConfirmation,
  loadDriverReturnTrips,
  loadReturnTrip,
  loadReturnTrips,
  lookupCustomer,
  registerCustomer,
  sendCustomerOtp,
  startSession,
  subscribeReturnTripUnavailable,
  verifyCustomerOtp,
} from './api';
import type { BookingConfirmation, BookingCustomerDraft, ReturnTrip, ReturnTripPricing, ReturnTripStatusChangedEvent, SupportFare } from './types';

type BookingStep = 'phone' | 'otp' | 'identity' | 'confirm' | 'success';

type CustomerSessionState = {
  phoneNumber: string;
  name: string;
  isExistingCustomer: boolean;
  needsName: boolean;
  welcomeBackMessage: string;
};

type SessionBookingState = {
  tripId: number | string;
  bookingReference: string;
  customerName: string;
  phoneNumber: string;
  route: string;
  fare: string;
  driver: string;
  bookedAt: string;
  phase: 'pending' | 'support' | 'confirmed';
};

type BookingRequestState = {
  phase: 'pending' | 'support' | 'confirmed' | 'rejected' | 'expired' | 'error';
  tripId: number | string;
  bookingId?: number | string | null;
  bookingReference: string;
  customerName: string;
  phoneNumber: string;
  route: string;
  fare: string;
  driver: string;
  supportFare?: SupportFare | null;
  pricing?: ReturnTripPricing | null;
  pricingSource?: string | null;
  farePending?: boolean;
  originalFare?: string;
  discountPercentage?: string;
  discountAmount?: string;
  discountLabel?: string;
  pendingRequest?: unknown;
  supportReviewPending?: boolean;
  status?: string | null;
  bookingState?: string | null;
};

type FareSource = {
  supportFare?: SupportFare | null;
  returnTripPricing?: ReturnTripPricing | null;
  finalPrice?: unknown;
  driverOfferPrice?: unknown;
  discount?: unknown;
  discountAmount?: unknown;
};

type SessionConflictState = {
  message: string;
  confirmAction: () => Promise<void>;
};

type SortKey = 'relevance' | 'rating' | 'price' | 'fastest' | 'departure' | 'arrival';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'rating', label: 'Rating' },
  { key: 'price', label: 'Price' },
  { key: 'fastest', label: 'Fastest' },
  { key: 'departure', label: 'Departure' },
  { key: 'arrival', label: 'Arrival' },
];

const formatMoney = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(num);
};

const formatRating = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.0';
  return num.toFixed(1);
};

const formatTimeLeft = (value?: string | null, now = Date.now()) => {
  if (!value) return 'No expiry set';
  const expiresAt = new Date(value).getTime();
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'Ending now';
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s left`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
};

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeTripStatus = (value: unknown) => String(value ?? '').trim().toUpperCase();
const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(-10);
const toIndianPhone = (value: string) => `+91${digitsOnly(value)}`;

const matchesText = (trip: ReturnTrip, query: string) => {
  if (!query) return true;
  const haystack = [
    trip.Driver?.firstName,
    trip.Driver?.lastName,
    trip.pickupCity,
    trip.destinationCity,
    trip.cabSnapshot?.carNumber,
    trip.cabSnapshot?.vehicleType,
    trip.pickupFormatAddress?.formattedAddress,
    trip.dropFormatAddress?.formattedAddress,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
};

const buildRecommendedScore = (trip: ReturnTrip) =>
  (Number(trip.driverRating || trip.Driver?.rating || 0) * 2) - (Number(getTripFareValue(trip) || 0) / 1000);
const UI_DEBUG_PREFIX = '[return-trips:ui]';

const isTripSelectable = (trip: ReturnTrip) => {
  const isActive = trip.status === 'ACTIVE';
  const hasBooking = trip.bookingId !== null && trip.bookingId !== undefined;
  const expiresAt = trip.expiresAt ? new Date(trip.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return isActive && !hasBooking && expiresAt > Date.now();
};

const TERMINAL_RETURN_TRIP_EVENT_TYPES = new Set(['EXPIRED', 'CANCELLED', 'DELETED']);

const mergeTripStatusEvent = (
  trip: ReturnTrip | null | undefined,
  event: ReturnTripStatusChangedEvent,
): ReturnTrip | null => {
  const base = trip || (event.trip ? { ...event.trip } : null);
  if (!base) return null;

  return {
    ...base,
    status: event.status ?? base.status ?? null,
    bookingState: event.bookingState ?? base.bookingState ?? null,
    bookingId: event.bookingId ?? base.bookingId ?? null,
    pendingRequest: event.pendingRequest ?? base.pendingRequest,
    pendingResponse: event.pendingResponse ?? base.pendingResponse ?? null,
    driverId: event.driverId !== null && event.driverId !== undefined ? Number(event.driverId) : base.driverId,
    supportReviewPending: event.supportReviewPending ?? base.supportReviewPending,
    notificationType: event.notificationType ?? base.notificationType ?? null,
    linkedBooking: event.linkedBooking ?? base.linkedBooking ?? null,
    Driver: event.Driver ?? base.Driver ?? null,
    cabSnapshot: event.cabSnapshot ?? base.cabSnapshot ?? null,
  };
};

const shouldRemoveFromActiveList = (event: ReturnTripStatusChangedEvent) => {
  const normalizedEventType = normalizeTripStatus(event.eventType);
  const normalizedStatus = normalizeTripStatus(event.status);
  return TERMINAL_RETURN_TRIP_EVENT_TYPES.has(normalizedEventType) || TERMINAL_RETURN_TRIP_EVENT_TYPES.has(normalizedStatus);
};

const formatPhonePreview = (value: string) => {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return value;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

const getTripFareValue = (trip: ReturnTrip) => trip.supportFare?.finalPrice ?? trip.finalPrice ?? trip.driverOfferPrice;
const getTripDiscountPercentage = (trip: ReturnTrip) => trip.supportFare?.discountPercentage ?? trip.discount;
const getTripDiscountAmount = (trip: ReturnTrip) => trip.supportFare?.discountAmount ?? trip.discountAmount;
const getTripOriginalFare = (trip: ReturnTrip) => trip.supportFare?.originalFare;
const getPricingDiscountLabel = (source?: string | null) => (
  normalizeTripStatus(source) === 'RETURN_TRIP_SUPPORT'
    ? 'Support discount'
    : normalizeTripStatus(source) === 'RETURN_TRIP_DRIVER'
      ? 'Driver discount'
      : 'Discount'
);
const hasCompletePricing = (pricing?: ReturnTripPricing | null) => Boolean(
  pricing &&
  pricing.originalFare !== null &&
  pricing.originalFare !== undefined &&
  pricing.discountPercentage !== null &&
  pricing.discountPercentage !== undefined &&
  pricing.discountAmount !== null &&
  pricing.discountAmount !== undefined &&
  pricing.finalPrice !== null &&
  pricing.finalPrice !== undefined,
);
const isSupportTripState = (trip: Partial<ReturnTrip>) => (
  normalizeTripStatus(trip.status) === 'SUPPORT' ||
  normalizeTripStatus(trip.bookingState) === 'SUPPORT' ||
  Boolean(trip.supportReviewPending)
);

const buildFareSnapshot = (trip: FareSource) => {
  const pricing = trip.returnTripPricing ?? null;

  if (pricing) {
    if (!hasCompletePricing(pricing)) {
      return {
        pricing,
        pricingSource: pricing.source ?? null,
        supportFare: null,
        fare: 'Fare update pending',
        farePending: true,
        originalFare: undefined,
        discountPercentage: undefined,
        discountAmount: undefined,
        discountLabel: getPricingDiscountLabel(pricing.source),
      };
    }

    return {
      pricing,
      pricingSource: pricing.source ?? null,
      supportFare: null,
      fare: `Rs ${formatMoney(pricing.finalPrice)}`,
      farePending: false,
      originalFare: `Rs ${formatMoney(pricing.originalFare)}`,
      discountPercentage: `${formatMoney(pricing.discountPercentage)}%`,
      discountAmount: `Rs ${formatMoney(pricing.discountAmount)}`,
      discountLabel: getPricingDiscountLabel(pricing.source),
    };
  }

  const supportFare = trip.supportFare ?? null;
  const finalPrice = supportFare?.finalPrice ?? trip.finalPrice ?? trip.driverOfferPrice;
  const originalFare = supportFare?.originalFare;
  const discountPercentage = supportFare?.discountPercentage ?? trip.discount;
  const discountAmount = supportFare?.discountAmount ?? trip.discountAmount;

  return {
    pricing: null,
    pricingSource: null,
    supportFare,
    fare: `Rs ${formatMoney(finalPrice)}`,
    farePending: false,
    originalFare: originalFare !== null && originalFare !== undefined ? `Rs ${formatMoney(originalFare)}` : undefined,
    discountPercentage: discountPercentage !== null && discountPercentage !== undefined ? `${formatMoney(discountPercentage)}%` : undefined,
    discountAmount: discountAmount !== null && discountAmount !== undefined ? `Rs ${formatMoney(discountAmount)}` : undefined,
    discountLabel: supportFare ? 'Support discount' : 'Driver discount',
  };
};

const getBookingReference = (booking: { id?: number | string; bookingReference?: string | null; bookingNumber?: string | null } | null | undefined) => {
  if (!booking) return "";
  if (booking.bookingReference) return booking.bookingReference;
  if (booking.bookingNumber) return booking.bookingNumber;
  if (booking.id !== null && booking.id !== undefined) return String(booking.id);
  return "";
};

const resolveBookingPhase = (trip?: Partial<ReturnTrip> & {
  notificationType?: string | null;
  supportReviewPending?: boolean;
}) => {
  const status = normalizeTripStatus(trip?.status);
  const bookingState = normalizeTripStatus(trip?.bookingState);
  const notificationType = normalizeTripStatus(trip?.notificationType);
  const pendingResponse = normalizeTripStatus(trip?.pendingResponse?.response);
  const supportReviewPending = Boolean(trip?.supportReviewPending);
  const isSupport =
    bookingState === 'SUPPORT' ||
    status === 'SUPPORT' ||
    supportReviewPending ||
    pendingResponse === 'NO_RESPONSE' ||
    notificationType === 'ASSIGNED_TO_SUPPORT';

  if (isSupport) return "support" as const;

  const isConfirmed =
    status === 'BOOKED' ||
    bookingState === 'BOOKED';

  if (isConfirmed) return "confirmed" as const;

  return "pending" as const;
};

const getTripDriverLabel = (trip?: Partial<ReturnTrip> | null) => {
  if (!trip) return "Driver";
  const driverName = [trip.Driver?.firstName, trip.Driver?.lastName].filter(Boolean).join(' ').trim();
  if (driverName) return driverName;
  if (trip.cabSnapshot?.carType) return trip.cabSnapshot.carType;
  if (trip.cabSnapshot?.vehicleType) return trip.cabSnapshot.vehicleType;
  if (trip.driverCarType) return trip.driverCarType;
  return "Driver";
};

const getConfirmationBookingId = (confirmation?: BookingConfirmation | null) => (
  confirmation?.bookingId ?? confirmation?.id ?? null
);

const getConfirmationReturnTripId = (confirmation?: BookingConfirmation | null) => (
  confirmation?.returnTripId ?? confirmation?.returnTrip?.id ?? null
);

const getConfirmationDriverLabel = (confirmation?: BookingConfirmation | null) => {
  if (!confirmation) return '';
  const driver = confirmation.assignedDriver || confirmation.driver || confirmation.Driver;
  const driverName = [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim();
  if (driverName) return driverName;
  if (confirmation.cabSnapshot?.carType) return confirmation.cabSnapshot.carType;
  if (confirmation.cabSnapshot?.vehicleType) return confirmation.cabSnapshot.vehicleType;
  return '';
};

const getConfirmationPhase = (confirmation: BookingConfirmation) => {
  const ownership = normalizeTripStatus(confirmation.ownership);
  const status = normalizeTripStatus(confirmation.status);
  const bookingState = normalizeTripStatus(confirmation.bookingState);

  if (ownership === 'ASSIGNED_TO_SUPPORT' || bookingState === 'SUPPORT' || status === 'SUPPORT') return 'support' as const;
  if (bookingState === 'BOOKED' || status === 'BOOKED' || confirmation.driverId !== null && confirmation.driverId !== undefined) return 'confirmed' as const;
  if (bookingState === 'EXPIRED' || status === 'EXPIRED') return 'expired' as const;
  return 'pending' as const;
};

const NAV_LINKS = [
  { label: 'Home', href: 'https://rootcabs.com/', active: true },
  { label: 'Book Ride', href: 'https://rootcabs.com/book-ride' },
  { label: 'Return deals', href: 'https://rootcabs.com/returntrips' },
  { label: 'Services', href: 'https://rootcabs.com/services' },
  { label: 'Cities', href: 'https://rootcabs.com/cities' },
  { label: 'Drivers', href: 'https://rootcabs.com/drivers' },
  { label: 'Blog', href: 'https://rootcabs.com/blog' },
  { label: 'About', href: 'https://rootcabs.com/about' },
  { label: 'Support', href: 'https://rootcabs.com/support' },
];

const FEATURE_CARDS = [
  {
    key: 'refresh',
    eyebrow: 'Live availability',
    text: 'See the latest return trips available right now.',
    cta: 'Refresh now',
    tone: 'promo-card--violet',
  },
  {
    key: 'expiring',
    eyebrow: 'Expiring soon',
    text: 'Spot trips that are close to closing so you can book faster.',
    cta: 'Toggle filter',
    tone: 'promo-card--rose',
  },
  {
    key: 'rating',
    eyebrow: 'Top rated drivers',
    text: 'Bring the best-rated drivers to the top of the list.',
    cta: 'Sort by rating',
    tone: 'promo-card--mint',
  },
  {
    key: 'price',
    eyebrow: 'Lowest fare first',
    text: 'Show the most budget-friendly trips first.',
    cta: 'Sort by price',
    tone: 'promo-card--sky',
  },
];

const createDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}`;
};

const getBrowserDeviceToken = () => {
  if (typeof window === 'undefined') {
    return createDeviceId();
  }

  const storageKey = 'return-trips-browser-device-token';
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const nextToken = createDeviceId();
  window.localStorage.setItem(storageKey, nextToken);
  return nextToken;
};

const BookingProgress = ({ step }: { step: BookingStep }) => {
  const steps: { id: BookingStep; label: string }[] = [
    { id: 'phone', label: 'Phone' },
    { id: 'otp', label: 'OTP' },
    { id: 'identity', label: 'Profile' },
    { id: 'confirm', label: 'Confirm' },
  ];
  const activeIndex = steps.findIndex((item) => item.id === step);
  const resolvedIndex = step === 'success' ? steps.length - 1 : activeIndex;

  return (
    <div className="booking-progress" aria-label="Booking progress">
      {steps.map((item, index) => {
        const isDone = index < resolvedIndex || step === 'success';
        const isActive = index === resolvedIndex && step !== 'success';
        return (
          <Fragment key={item.id}>
            <div
              className={`booking-progress__step${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
              aria-label={`${index + 1}. ${item.label}`}
              title={item.label}
            >
              <span>{index + 1}</span>
            </div>
            {index < steps.length - 1 ? <ChevronRight size={16} className="booking-progress__arrow" aria-hidden="true" /> : null}
          </Fragment>
        );
      })}
    </div>
  );
};

const TripCard = ({ trip, onBook, now }: { trip: ReturnTrip; onBook: (trip: ReturnTrip) => void; now: number }) => {
  const driverName = [trip.Driver?.firstName, trip.Driver?.lastName].filter(Boolean).join(' ') || 'Driver';
  const pickup = trip.pickupFormatAddress?.formattedAddress || trip.pickupCity || '-';
  const drop = trip.dropFormatAddress?.formattedAddress || trip.destinationCity || '-';
  const ratingValue = Number(trip.driverRating ?? trip.Driver?.rating ?? 0);
  const rating = formatRating(ratingValue);
  const ratingTone = ratingValue >= 4.5 ? 'excellent' : ratingValue >= 4.0 ? 'good' : ratingValue >= 3.5 ? 'fair' : 'low';
  const cabLabel = [trip.cabSnapshot?.carType || trip.driverCarType, trip.cabSnapshot?.vehicleType]
    .filter(Boolean)
    .join(' / ');
  const countdown = formatTimeLeft(trip.expiresAt, now);
  const expiresAt = trip.expiresAt ? new Date(trip.expiresAt).getTime() : null;
  const isUrgent = expiresAt !== null ? expiresAt - now <= 60 * 60 * 1000 : false;
  const fareValue = Number(getTripFareValue(trip) || 0);
  const savingsValue = Number(trip.discountAmount || 0);
  const originalFareValue = fareValue + savingsValue;
  const discountPercent = originalFareValue > 0 && savingsValue > 0 ? Math.round((savingsValue / originalFareValue) * 100) : 0;

  return (
    <article className="trip-card">
      <div className="trip-card__top">
        <div className="trip-card__route-block">
          <div className="trip-card__route-head">
            <div className="trip-card__route-tags">
              <span className="route-tag route-tag--from">FROM</span>
              <span className="route-tag route-tag--to">TO</span>
            </div>
            <div className="trip-card__top-meta">
              <span className={`pill pill--rating pill--rating--${ratingTone}`}>
                <Star size={14} />
                {rating}
              </span>
              <span className="pill pill--car">
                <CarFront size={14} />
                {cabLabel || 'Cab details'}
              </span>
            </div>
            <div className="trip-card__route-spacer" aria-hidden="true" />
          </div>
          <div className="trip-card__route">
            <h3 className="trip-card__city trip-card__city--from">{trip.pickupCity || 'Pickup'}</h3>
            <ArrowRight size={16} />
            <h3 className="trip-card__city trip-card__city--to">{trip.destinationCity || 'Drop'}</h3>
          </div>
          <p className="trip-card__driver">by {driverName} - {trip.zone || trip.pickupCity || 'Zone not set'}</p>
        </div>

        <div className="trip-card__price trip-card__price--deal">
          {savingsValue > 0 ? (
            <span className="trip-card__price-savings">
              <BadgeIndianRupee size={12} />
              Rs. {formatMoney(savingsValue)} applied
            </span>
          ) : null}
          <div className="trip-card__price-original-row">
            {savingsValue > 0 ? (
              <span className="trip-card__price-original">
                <BadgeIndianRupee size={14} />
                {formatMoney(originalFareValue)}
              </span>
            ) : null}
            {discountPercent > 0 ? <span className="trip-card__price-discount">-{discountPercent}%</span> : null}
          </div>
          <strong className="trip-card__price-final">
            <BadgeIndianRupee size={16} />
            <span>{formatMoney(fareValue)}</span>
          </strong>
        </div>
      </div>

      <div className="trip-card__body">
        <div className="trip-locations trip-locations--inline">
          <div className="trip-location">
            <label>Pickup</label>
            <p>{pickup}</p>
          </div>
          <ArrowRight size={16} className="trip-location__arrow" />
          <div className="trip-location">
            <label>Drop</label>
            <p>{drop}</p>
          </div>
        </div>
      </div>

      <div className="trip-card__footer">
        <div className="trip-extra">
          <span><MapPin size={14} /> {trip.zone || trip.pickupCity || 'Zone not set'}</span>
          <span>
            <CalendarClock size={14} />
            {trip.created_at ? new Date(trip.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Created recently'}
          </span>
          <span><WalletCards size={14} /> Save {formatMoney(getTripDiscountAmount(trip))}</span>
        </div>

        <div className="trip-card__actions">
          <span className={`pill pill--danger${isUrgent ? ' pill--danger--pulse' : ''}`}><TimerReset size={14} /> {countdown}</span>
          <button className="ghost-btn" type="button" onClick={() => onBook(trip)}>
            Book Now
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
};

function App() {
  const [now, setNow] = useState(() => Date.now());
  const [trips, setTrips] = useState<ReturnTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [bookingRequestState, setBookingRequestState] = useState<BookingRequestState | null>(null);
  const bookingRequestStateRef = useRef<BookingRequestState | null>(null);
  const refreshTripsPromiseRef = useRef<Promise<void> | null>(null);
  const bookingRefreshTokenRef = useRef(0);
  const [customerSession, setCustomerSession] = useState<CustomerSessionState | null>(null);
  const [sessionBookings, setSessionBookings] = useState<SessionBookingState[]>([]);
  const tripsRef = useRef<ReturnTrip[]>([]);
  const [profileView, setProfileView] = useState<null | 'profile' | 'upcoming'>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('relevance');
  const [pickupCity, setPickupCity] = useState('all');
  const [destinationCity, setDestinationCity] = useState('all');
  const [minRating, setMinRating] = useState(0);
  const [onlyExpiringSoon, setOnlyExpiringSoon] = useState(false);
  const [maxPrice, setMaxPrice] = useState(0);

  const [selectedTrip, setSelectedTrip] = useState<ReturnTrip | null>(null);
  const [bookingStep, setBookingStep] = useState<BookingStep>('phone');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<SessionConflictState | null>(null);
  const [sid, setSid] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [deviceToken] = useState(getBrowserDeviceToken);
  const [customerId, setCustomerId] = useState<number | string | null>(null);
  const [bookingReference, setBookingReference] = useState('');
  const [bookingNotice, setBookingNotice] = useState('');
  const [customerDraft, setCustomerDraft] = useState<BookingCustomerDraft>({
    phoneNumber: '',
    isExistingCustomer: false,
    needsName: false,
    name: '',
    welcomeBackMessage: '',
  });
  const [otpCode, setOtpCode] = useState('');

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    tripsRef.current = trips;
  }, [trips]);

  useEffect(() => {
    bookingRequestStateRef.current = bookingRequestState;
  }, [bookingRequestState]);
  useEffect(() => {
    let mounted = true;
    const hydrateTrips = async (showLoader = false) => {
      if (showLoader) setLoading(true);
      setError(null);
      try {
        const data = (await loadReturnTrips()).filter(isTripSelectable);
        if (!mounted) return;
        setTrips(data);
        const priceCap = Math.max(...data.map((trip) => Number(getTripFareValue(trip)) || 0), 0);
        setMaxPrice(priceCap || 5000);
      } catch (err: unknown) {
        if (!mounted) return;
        setTrips([]);
        setError(err instanceof Error ? err.message : 'Failed to load return trips');
      } finally {
        if (mounted && showLoader) {
          setLoading(false);
        }
      }
    };

    hydrateTrips(true);

    const unsubscribe = subscribeReturnTripUnavailable(
      ({ tripIds, bookedReturnTripId, unavailableReturnTripIds, reason }) => {
        if (!mounted) return;
        const allIds = tripIds.length
          ? tripIds
          : [
            ...(bookedReturnTripId !== null && bookedReturnTripId !== undefined ? [bookedReturnTripId] : []),
            ...unavailableReturnTripIds,
          ];
        if (!allIds.length) return;
        console.info(`${UI_DEBUG_PREFIX} removing trips from UI`, allIds);
        const unavailableIds = new Set(allIds.map(String));
        setTrips((current) => current.filter((trip) => !unavailableIds.has(String(trip.id))));
        setPageNotice(
          reason === 'PENDING'
            ? 'A return trip is waiting on driver response and was removed from the list.'
            : 'Live availability changed. Unavailable trips were removed.',
        );
        void hydrateTrips(false);
      },
      (availableEvent) => {
        if (!mounted) return;
        console.info(`${UI_DEBUG_PREFIX} available event received`, availableEvent);
        if (availableEvent.trip && isTripSelectable(availableEvent.trip)) {
          console.info(`${UI_DEBUG_PREFIX} inserting available trip into UI`, availableEvent.trip.id);
          setTrips((current) => {
            const next = current.filter((trip) => String(trip.id) !== String(availableEvent.trip!.id));
            return [availableEvent.trip!, ...next];
          });
          setMaxPrice((current) => Math.max(current, Number(getTripFareValue(availableEvent.trip)) || 0, 5000));
        } else {
          console.warn(`${UI_DEBUG_PREFIX} available trip not inserted`, {
            hasTrip: Boolean(availableEvent.trip),
            selectable: availableEvent.trip ? isTripSelectable(availableEvent.trip) : false,
          });
        }
        setPageNotice(
          availableEvent.reason === 'REJECTED'
            ? 'A return trip is available again after driver rejection.'
            : 'A new return trip is live now.',
        );
        void hydrateTrips(false);
      },
      (statusEvent) => {
        if (!mounted) return;
        const eventType = normalizeTripStatus(statusEvent.eventType);
        const eventTripId = statusEvent.returnTripId ?? statusEvent.tripId ?? statusEvent.trip?.id ?? null;
        const eventBookingId = statusEvent.bookingId ?? statusEvent.trip?.bookingId ?? null;
        if (eventTripId === null && eventBookingId === null) return;

        const affectedIds = new Set([
          ...(eventTripId !== null && eventTripId !== undefined ? [String(eventTripId)] : []),
          ...(statusEvent.unavailableReturnTripIds || []).map(String),
        ]);
        const isSupportTransfer = eventType === 'NO_RESPONSE' || (eventType === 'REJECTED' && normalizeTripStatus(statusEvent.status) === 'SUPPORT');
        const isAccepted = eventType === 'ACCEPTED';
        const shouldRemoveFromListings = ['DELETED', 'CANCELLED'].includes(eventType) || isAccepted || isSupportTransfer;

        if (shouldRemoveFromListings && affectedIds.size > 0) {
          setTrips((current) => current.filter((trip) => !affectedIds.has(String(trip.id))));
        }

        const currentBooking = bookingRequestStateRef.current;
        const matchesCurrentBooking = Boolean(currentBooking) && (
          (eventTripId !== null && eventTripId !== undefined && String(currentBooking!.tripId) === String(eventTripId)) ||
          (eventBookingId !== null && eventBookingId !== undefined && currentBooking!.bookingId !== null && currentBooking!.bookingId !== undefined && String(currentBooking!.bookingId) === String(eventBookingId)) ||
          (eventBookingId !== null && eventBookingId !== undefined && currentBooking!.bookingReference && currentBooking!.bookingReference !== 'Pending' && String(currentBooking!.bookingReference) === String(eventBookingId))
        );

        if (matchesCurrentBooking && isSupportTransfer) {
          const nextBooking = {
            ...currentBooking!,
            bookingId: eventBookingId ?? currentBooking!.bookingId,
            bookingReference: eventBookingId ? String(eventBookingId) : currentBooking!.bookingReference,
            fare: 'Fare update pending',
            farePending: true,
            driver: 'Customer Support',
            pendingRequest: statusEvent.pendingRequest,
            supportReviewPending: statusEvent.supportReviewPending ?? true,
            status: statusEvent.status ?? null,
            bookingState: statusEvent.bookingState ?? null,
            phase: 'support' as const,
          };
          setBookingRequestState(nextBooking);
          upsertSessionBooking(nextBooking);
          setPageNotice('Customer Support is arranging another driver for your booking.');
        }

        if (matchesCurrentBooking && isAccepted && eventBookingId !== null && eventBookingId !== undefined) {
          setBookingRequestState((current) => current && (
            String(current.tripId) === String(eventTripId) ||
            String(current.bookingId ?? current.bookingReference) === String(eventBookingId)
          )
            ? {
              ...current,
              bookingId: eventBookingId,
              bookingReference: String(eventBookingId),
              status: statusEvent.status ?? current.status,
              bookingState: statusEvent.bookingState ?? current.bookingState,
              phase: 'confirmed',
            }
            : current);
        }

        if (eventTripId !== null && eventTripId !== undefined && (isSupportTransfer || isAccepted)) {
          const expectedState = isAccepted
            ? (trip: ReturnTrip) => normalizeTripStatus(trip.status) === 'BOOKED' || normalizeTripStatus(trip.bookingState) === 'BOOKED'
            : (trip: ReturnTrip) => isSupportTripState(trip);

          void loadReturnTripAfterCommit(eventTripId, expectedState)
            .then((trip) => {
              if (!mounted || !trip) return;
              applyTripToBookingState(trip, isAccepted ? 'confirmed' : 'support');
            })
            .catch((err) => console.warn(`${UI_DEBUG_PREFIX} failed to refresh status-changed trip`, err));
        }

        if (matchesCurrentBooking && eventBookingId !== null && eventBookingId !== undefined) {
          void refreshBookingConfirmation(eventBookingId, { retry: true })
            .catch((err) => console.warn(`${UI_DEBUG_PREFIX} failed to refresh booking confirmation`, err));
        }

        void refreshTrips(true).catch(() => undefined);
      },
      () => {
        if (!mounted) return;
        console.warn(`${UI_DEBUG_PREFIX} live updates paused, relying on refetch/manual refresh`);
      },
      () => {
        if (!mounted) return;
        void refreshTrips().catch(() => undefined);
        const currentBooking = bookingRequestStateRef.current;
        const currentBookingId = currentBooking?.bookingId ?? (
          currentBooking?.bookingReference && currentBooking.bookingReference !== 'Pending'
            ? currentBooking.bookingReference
            : null
        );
        if (currentBookingId) {
          void refreshBookingConfirmation(currentBookingId, { retry: false }).catch(() => undefined);
        }
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const refreshTrips = useCallback(async (preferDriverEndpoint = false) => {
    if (!refreshTripsPromiseRef.current) {
      const fetchTrips = async () => {
        if (preferDriverEndpoint) {
          try {
            return await loadDriverReturnTrips();
          } catch (error) {
            console.warn(`${UI_DEBUG_PREFIX} driver refresh failed, falling back to customer list`, error);
          }
        }

        return loadReturnTrips();
      };

      refreshTripsPromiseRef.current = fetchTrips()
        .then((loadedTrips) => {
          const data = loadedTrips.filter(isTripSelectable);
          setTrips(data);
          const priceCap = Math.max(...data.map((trip) => Number(getTripFareValue(trip)) || 0), 0);
          setMaxPrice(priceCap || 5000);
        })
        .finally(() => {
          refreshTripsPromiseRef.current = null;
        });
    }

    return refreshTripsPromiseRef.current;
  }, []);

  const upsertSessionBooking = useCallback((snapshot: BookingRequestState) => {
    setSessionBookings((current) => [
      {
        tripId: snapshot.tripId,
        bookingReference: snapshot.bookingReference || (snapshot.phase === "confirmed" ? "Confirmed" : "Reserved"),
        customerName: snapshot.customerName,
        phoneNumber: snapshot.phoneNumber,
        route: snapshot.route,
        fare: snapshot.fare,
        driver: snapshot.driver,
        bookedAt: new Date().toISOString(),
        phase: snapshot.phase === 'confirmed' ? 'confirmed' : snapshot.phase === 'support' ? 'support' : 'pending',
      },
      ...current.filter((item) => String(item.tripId) !== String(snapshot.tripId)),
    ]);
  }, []);

  const removeSessionBooking = useCallback((tripId: number | string) => {
    setSessionBookings((current) => current.filter((item) => String(item.tripId) !== String(tripId)));
  }, []);

  const loadReturnTripAfterCommit = useCallback(async (
    tripId: number | string,
    isReady: (trip: ReturnTrip) => boolean,
  ) => {
    let latest: ReturnTrip | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      latest = await loadReturnTrip(tripId);
      if (latest && isReady(latest)) return latest;
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
      }
    }

    return latest;
  }, []);

  const applyTripToBookingState = useCallback((trip: ReturnTrip, phaseOverride?: BookingRequestState['phase']) => {
    const nextPhase = phaseOverride || (
      isSupportTripState(trip)
        ? 'support'
        : normalizeTripStatus(trip.bookingState) === 'BOOKED' || normalizeTripStatus(trip.status) === 'BOOKED'
          ? 'confirmed'
          : 'pending'
    );
    const rawFareSnapshot = buildFareSnapshot(trip);
    const fareSnapshot = nextPhase === 'support' && !rawFareSnapshot.pricing
      ? {
        ...rawFareSnapshot,
        fare: 'Fare update pending',
        farePending: true,
        originalFare: undefined,
        discountPercentage: undefined,
        discountAmount: undefined,
        discountLabel: 'Support discount',
      }
      : rawFareSnapshot;

    setBookingRequestState((current) => {
      if (!current) return current;
      const sameTrip = String(current.tripId) === String(trip.id);
      const sameBooking = current.bookingId !== null && current.bookingId !== undefined && trip.bookingId !== null && trip.bookingId !== undefined
        ? String(current.bookingId) === String(trip.bookingId)
        : false;
      if (!sameTrip && !sameBooking) return current;

      const next = {
        ...current,
        bookingId: trip.bookingId ?? current.bookingId,
        bookingReference: trip.bookingId ? String(trip.bookingId) : current.bookingReference,
        fare: fareSnapshot.fare,
        pricing: fareSnapshot.pricing ?? current.pricing,
        pricingSource: fareSnapshot.pricingSource ?? current.pricingSource,
        farePending: fareSnapshot.farePending ?? current.farePending,
        supportFare: fareSnapshot.supportFare ?? current.supportFare,
        originalFare: fareSnapshot.originalFare ?? current.originalFare,
        discountPercentage: fareSnapshot.discountPercentage ?? current.discountPercentage,
        discountAmount: fareSnapshot.discountAmount ?? current.discountAmount,
        discountLabel: fareSnapshot.discountLabel ?? current.discountLabel,
        driver: nextPhase === 'support' ? 'Customer Support' : getTripDriverLabel(trip) || current.driver,
        pendingRequest: trip.pendingRequest,
        supportReviewPending: trip.supportReviewPending,
        status: trip.status ?? null,
        bookingState: trip.bookingState ?? null,
        phase: nextPhase,
      };

      upsertSessionBooking(next);
      return next;
    });
  }, [upsertSessionBooking]);

  const applyBookingConfirmation = useCallback((confirmation: BookingConfirmation, token?: number) => {
    if (token !== undefined && token !== bookingRefreshTokenRef.current) return;

    const fareSnapshot = buildFareSnapshot({ returnTripPricing: confirmation.returnTripPricing ?? null });
    const nextPhase = getConfirmationPhase(confirmation);
    const confirmationBookingId = getConfirmationBookingId(confirmation);
    const confirmationReturnTripId = getConfirmationReturnTripId(confirmation);
    const assignedDriver = getConfirmationDriverLabel(confirmation);

    setBookingRequestState((current) => {
      if (!current) return current;
      const sameBooking = confirmationBookingId !== null && confirmationBookingId !== undefined && (
        String(current.bookingId ?? '') === String(confirmationBookingId) ||
        String(current.bookingReference ?? '') === String(confirmationBookingId)
      );
      const sameTrip = confirmationReturnTripId !== null && confirmationReturnTripId !== undefined && String(current.tripId) === String(confirmationReturnTripId);
      if (!sameBooking && !sameTrip) return current;

      const next = {
        ...current,
        tripId: confirmationReturnTripId ?? current.tripId,
        bookingId: confirmationBookingId ?? current.bookingId,
        bookingReference: confirmation.bookingReference || confirmation.bookingNumber || (confirmationBookingId ? String(confirmationBookingId) : current.bookingReference),
        fare: fareSnapshot.fare,
        pricing: fareSnapshot.pricing ?? current.pricing,
        pricingSource: fareSnapshot.pricingSource ?? current.pricingSource,
        farePending: fareSnapshot.farePending,
        originalFare: fareSnapshot.originalFare,
        discountPercentage: fareSnapshot.discountPercentage,
        discountAmount: fareSnapshot.discountAmount,
        discountLabel: fareSnapshot.discountLabel,
        driver: nextPhase === 'support' ? 'Customer Support' : assignedDriver || current.driver,
        status: confirmation.status ?? current.status,
        bookingState: confirmation.bookingState ?? current.bookingState,
        supportReviewPending: nextPhase === 'support' ? true : current.supportReviewPending,
        phase: nextPhase,
      };

      upsertSessionBooking(next);
      return next;
    });
  }, [upsertSessionBooking]);

  const refreshBookingConfirmation = useCallback(async (bookingId: number | string, options: { retry?: boolean } = {}) => {
    const token = bookingRefreshTokenRef.current + 1;
    bookingRefreshTokenRef.current = token;

    for (let attempt = 0; attempt < (options.retry ? 3 : 1); attempt += 1) {
      const confirmation = await loadBookingConfirmation(bookingId);
      if (token !== bookingRefreshTokenRef.current) return null;
      if (confirmation?.returnTripPricing || attempt === (options.retry ? 2 : 0)) {
        if (confirmation) applyBookingConfirmation(confirmation, token);
        return confirmation;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
    }

    return null;
  }, [applyBookingConfirmation]);

  useEffect(() => {
    if (!bookingRequestState || !['pending', 'support'].includes(bookingRequestState.phase)) return;

    let active = true;

    const pollBookingStatus = async () => {
      try {
        const currentBookingId = bookingRequestState.bookingId ?? (
          bookingRequestState.bookingReference && bookingRequestState.bookingReference !== 'Pending'
            ? bookingRequestState.bookingReference
            : null
        );
        if (currentBookingId) {
          await refreshBookingConfirmation(currentBookingId, { retry: false });
        }

        const trip = await loadReturnTrip(bookingRequestState.tripId);
        if (!active || !trip) return;

        console.info(`${UI_DEBUG_PREFIX} polled trip status`, {
          tripId: bookingRequestState.tripId,
          status: trip.status,
          bookingState: trip.bookingState,
          pendingRequest: trip.pendingRequest,
        });

        if (trip.bookingState === 'PENDING' || trip.pendingRequest) {
          setBookingRequestState((current) => (
            current && current.phase === 'pending'
              ? {
                ...current,
                pendingRequest: trip.pendingRequest,
                status: trip.status ?? null,
                bookingState: trip.bookingState ?? null,
              }
              : current
          ));
          return;
        }

        if (isSupportTripState(trip)) {
          applyTripToBookingState(trip, 'support');
          setTrips((current) => current.filter((item) => String(item.id) !== String(trip.id)));
          return;
        }

        if (trip.bookingState === 'BOOKED' || trip.status === 'BOOKED') {
          applyTripToBookingState(trip, 'confirmed');
          void refreshTrips().catch(() => undefined);
          return;
        }

        if (trip.status === 'EXPIRED') {
          setBookingRequestState((current) => (
            current
              ? {
                ...current,
                phase: 'expired',
                status: trip.status ?? null,
                bookingState: trip.bookingState ?? null,
                pendingRequest: trip.pendingRequest,
              }
              : current
          ));
          removeSessionBooking(bookingRequestState.tripId);
          void refreshTrips().catch(() => undefined);
          return;
        }

        if (trip.status === 'ACTIVE' && !trip.pendingRequest) {
          setBookingRequestState((current) => (
            current
              ? {
                ...current,
                phase: 'rejected',
                status: trip.status ?? null,
                bookingState: trip.bookingState ?? null,
                pendingRequest: trip.pendingRequest,
              }
              : current
          ));
          removeSessionBooking(bookingRequestState.tripId);
          void refreshTrips().catch(() => undefined);
          return;
        }

        setBookingRequestState((current) => (
          current
            ? {
              ...current,
              phase: 'error',
              status: trip.status ?? null,
              bookingState: trip.bookingState ?? null,
              pendingRequest: trip.pendingRequest,
            }
            : current
        ));
      } catch (err) {
        console.warn(`${UI_DEBUG_PREFIX} failed to poll booking status`, err);
      }
    };

    void pollBookingStatus();
    const intervalId = window.setInterval(() => {
      void pollBookingStatus();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [applyTripToBookingState, bookingRequestState, refreshBookingConfirmation, refreshTrips, removeSessionBooking, upsertSessionBooking]);
  const cityOptions = useMemo(() => {
    const pickups = Array.from(new Set(trips.map((trip) => trip.pickupCity).filter(Boolean) as string[]));
    const drops = Array.from(new Set(trips.map((trip) => trip.destinationCity).filter(Boolean) as string[]));
    return { pickups, drops };
  }, [trips]);

  const filteredTrips = useMemo(() => {
    const now = Date.now();
    return trips
      .filter((trip) => {
        if (!isTripSelectable(trip)) return false;
        if (pickupCity !== 'all' && normalize(trip.pickupCity) !== pickupCity) return false;
        if (destinationCity !== 'all' && normalize(trip.destinationCity) !== destinationCity) return false;
        if (onlyExpiringSoon) {
          const expiresAt = trip.expiresAt ? new Date(trip.expiresAt).getTime() : Number.POSITIVE_INFINITY;
          if (expiresAt < now || expiresAt - now > 6 * 60 * 60 * 1000) return false;
        }
        if (Number(trip.driverRating || trip.Driver?.rating || 0) < minRating) return false;
        if (maxPrice > 0 && Number(getTripFareValue(trip) || 0) > maxPrice) return false;
        return matchesText(trip, query);
      })
      .sort((a, b) => {
        if (sortKey === 'rating') return Number(b.driverRating || b.Driver?.rating || 0) - Number(a.driverRating || a.Driver?.rating || 0);
        if (sortKey === 'price') return Number(getTripFareValue(a) || 0) - Number(getTripFareValue(b) || 0);
        if (sortKey === 'fastest') return Number(a.estimatedMin || Number.MAX_SAFE_INTEGER) - Number(b.estimatedMin || Number.MAX_SAFE_INTEGER);
        if (sortKey === 'departure') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        if (sortKey === 'arrival') return new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime();
        return buildRecommendedScore(b) - buildRecommendedScore(a);
      });
  }, [destinationCity, maxPrice, minRating, onlyExpiringSoon, pickupCity, query, sortKey, trips]);

  const highestPrice = useMemo(() => Math.max(...trips.map((trip) => Number(getTripFareValue(trip)) || 0), 0), [trips]);
  const upcomingSessionBookings = useMemo(
    () => [...sessionBookings].sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime()),
    [sessionBookings],
  );
  const maxPriceLabel = maxPrice || highestPrice || 0;
  const selectedTripPickup = selectedTrip?.pickupFormatAddress?.formattedAddress || selectedTrip?.pickupCity || '-';
  const selectedTripDrop = selectedTrip?.dropFormatAddress?.formattedAddress || selectedTrip?.destinationCity || '-';
  const selectedTripDriver = [selectedTrip?.Driver?.firstName, selectedTrip?.Driver?.lastName].filter(Boolean).join(' ') || 'Driver';
  const canContinuePhone = digitsOnly(customerDraft.phoneNumber).length === 10;
  const canContinueIdentity = !customerDraft.needsName || customerDraft.name.trim().length >= 2;
  const canContinueOtp = otpCode.trim().length >= 4;

  const startBooking = (trip: ReturnTrip) => {
    if (!isTripSelectable(trip)) {
      setPageNotice('This return trip is no longer available.');
      return;
    }
    setPageNotice(null);
    setBookingRequestState(null);
    setSelectedTrip(trip);
    setBookingStep('phone');
    setBookingBusy(false);
    setBookingError(null);
    setBookingNotice('');
    setBookingReference('');
    setSid('');
    setDeviceId(createDeviceId());
    setCustomerId(null);
    setOtpCode('');
    setCustomerDraft({
      phoneNumber: customerSession?.phoneNumber || '',
      isExistingCustomer: customerSession?.isExistingCustomer || false,
      needsName: customerSession?.needsName || false,
      name: customerSession?.name || '',
      welcomeBackMessage: customerSession?.welcomeBackMessage || '',
    });
  };

  const closeBooking = () => {
    setSelectedTrip(null);
    setBookingStep('phone');
    setBookingBusy(false);
    setBookingError(null);
    setSessionConflict(null);
    setBookingNotice('');
    setBookingReference('');
    setSid('');
    setCustomerId(null);
    setOtpCode('');
  };

  const applyVerifiedCustomer = (
    nextCustomerId: number | string | null,
    nextCustomer: { firstName?: string; status?: string; phoneNumber?: string } | undefined,
    forceExistingCustomer = customerDraft.isExistingCustomer,
  ) => {
    setCustomerId(nextCustomerId);
    setCustomerSession({
      phoneNumber: digitsOnly(customerDraft.phoneNumber),
      name: nextCustomer?.firstName || customerDraft.name || '',
      isExistingCustomer: forceExistingCustomer,
      needsName: Boolean(customerDraft.needsName || nextCustomer?.status === 'NOT_ACTIVE'),
      welcomeBackMessage: customerDraft.welcomeBackMessage,
    });
    const needsProfile = customerDraft.needsName || nextCustomer?.status === 'NOT_ACTIVE';
    setBookingNotice(
      needsProfile
        ? 'OTP accepted. Complete the customer profile before final booking.'
        : 'Customer verified successfully. Booking can be confirmed now.',
    );
    setBookingStep(needsProfile ? 'identity' : 'confirm');
  };

  const continueFromPhone = async () => {
    if (!canContinuePhone) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const normalizedPhone = digitsOnly(customerDraft.phoneNumber);
      const nextSid = await startSession();
      setSid(nextSid);
      const lookup = await lookupCustomer(toIndianPhone(normalizedPhone), nextSid);
      setCustomerDraft((current) => ({
        ...current,
        phoneNumber: normalizedPhone,
        isExistingCustomer: lookup.exists,
        needsName: lookup.needsName,
        name: lookup.firstName || current.name,
        welcomeBackMessage: lookup.welcomeBackMessage,
      }));
      setBookingNotice(
        lookup.needsName
          ? 'OTP will be verified first. If the customer is incomplete, name capture will happen right after OTP.'
          : lookup.welcomeBackMessage || `Welcome back, ${lookup.firstName}`,
      );
      await sendCustomerOtp(toIndianPhone(normalizedPhone), nextSid);
      setBookingNotice(`OTP sent to ${formatPhonePreview(normalizedPhone)}`);
      setBookingStep('otp');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Unable to check customer details');
    } finally {
      setBookingBusy(false);
    }
  };

  const continueFromIdentity = async () => {
    if (!canContinueIdentity) return;
    setCustomerSession((current) => current ? { ...current, name: customerDraft.name.trim() || current.name } : {
      phoneNumber: digitsOnly(customerDraft.phoneNumber),
      name: customerDraft.name.trim(),
      isExistingCustomer: customerDraft.isExistingCustomer,
      needsName: customerDraft.needsName,
      welcomeBackMessage: customerDraft.welcomeBackMessage,
    });
    setBookingError(null);
    setBookingNotice('Customer profile is ready. Confirm the booking to continue.');
    setBookingStep('confirm');
  };

  const continueFromOtp = async () => {
    if (!sid || !deviceId || !canContinueOtp) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const verification = await verifyCustomerOtp(otpCode, sid, deviceToken, deviceId);
      if (verification.requiresDeviceOverride) {
        setSessionConflict({
          message: 'This phone number is already being used elsewhere. Would you like to continue here?',
          confirmAction: async () => {
            setBookingBusy(true);
            setBookingError(null);
            try {
              const retryResult = await verification.confirmLogoutAllDevices?.();
              if (!retryResult?.success) {
                throw new Error(retryResult?.message || 'OTP retry failed');
              }
              setSessionConflict(null);
              applyVerifiedCustomer(retryResult.customerId ?? null, retryResult.customer, true);
            } catch (err) {
              setBookingError(
                err instanceof Error && err.message
                  ? err.message
                  : 'We could not switch this customer to the current browser. Please try again.',
              );
            } finally {
              setBookingBusy(false);
            }
          },
        });
        return;
      }

      if (!verification.success) {
        throw new Error('OTP verification failed');
      }
      applyVerifiedCustomer(verification.customerId ?? null, verification.customer, customerDraft.isExistingCustomer);
    } catch (err) {
      setBookingError(
        err instanceof Error && err.message
          ? err.message
          : 'We could not verify the OTP. Check the code and try again.',
      );
    } finally {
      setBookingBusy(false);
    }
  };

  const confirmBooking = async () => {
    if (!sid || !selectedTrip) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const firstName = customerDraft.name.trim();
      const selectedFare = buildFareSnapshot(selectedTrip);
      const requestSnapshot = {
        tripId: selectedTrip.id,
        customerName: firstName || 'Customer',
        phoneNumber: formatPhonePreview(customerDraft.phoneNumber),
        route: `${selectedTrip.pickupCity || 'Pickup'} -> ${selectedTrip.destinationCity || 'Drop'}`,
        fare: selectedFare.fare,
        driver: getTripDriverLabel(selectedTrip),
        bookingReference: 'Pending',
        supportFare: selectedFare.supportFare,
        originalFare: selectedFare.originalFare,
        discountPercentage: selectedFare.discountPercentage,
        discountAmount: selectedFare.discountAmount,
        pendingRequest: selectedTrip.pendingRequest,
        status: selectedTrip.status ?? null,
        bookingState: selectedTrip.bookingState ?? null,
        phase: 'pending' as const,
      };

      setBookingRequestState(requestSnapshot);
      bookingRequestStateRef.current = requestSnapshot;
      upsertSessionBooking(requestSnapshot);

      if (customerDraft.needsName) {
        await registerCustomer(firstName, toIndianPhone(customerDraft.phoneNumber), sid);
      }

      const bookingResponse = await bookReturnTrip(
        selectedTrip,
        firstName,
        toIndianPhone(customerDraft.phoneNumber),
        sid,
      ) as {
        data?: {
          linkedBooking?: { id?: string | number; bookingReference?: string | null; bookingNumber?: string | null } | null;
          bookingReference?: string | null;
          pendingRequest?: unknown;
          pendingResponse?: unknown;
          supportReviewPending?: boolean;
          notificationType?: string | null;
          status?: string | null;
          bookingState?: string | null;
          booking?: { id?: string | number } | null;
          returnTrip?: ReturnTrip | null;
          trip?: ReturnTrip | null;
        };
        booking?: { id?: string | number } | null;
        linkedBooking?: { id?: string | number; bookingReference?: string | null; bookingNumber?: string | null } | null;
        bookingReference?: string | null;
        returnTrip?: ReturnTrip | null;
        trip?: ReturnTrip | null;
      };

      const data = bookingResponse?.data || bookingResponse;
      const responseTrip = data?.returnTrip || bookingResponse?.returnTrip || data?.trip || bookingResponse?.trip || selectedTrip;
      const linkedBooking = data?.linkedBooking || responseTrip?.linkedBooking || data?.booking || bookingResponse?.booking || bookingResponse?.linkedBooking || null;
      const bookingId = linkedBooking?.id || data?.booking?.id || bookingResponse?.booking?.id || responseTrip?.bookingId || null;
      const bookingReferenceFromResponse = getBookingReference(linkedBooking) || data?.bookingReference || bookingResponse?.bookingReference || "";
      const pendingRequest = data?.pendingRequest || responseTrip?.pendingRequest || selectedTrip.pendingRequest || null;
      const mergedResponseTrip = {
        ...selectedTrip,
        ...responseTrip,
        linkedBooking,
        pendingRequest,
        pendingResponse: data?.pendingResponse || responseTrip?.pendingResponse || null,
        supportReviewPending: Boolean(data?.supportReviewPending || responseTrip?.supportReviewPending),
        notificationType: data?.notificationType || responseTrip?.notificationType || null,
      };
      const resolvedPhase = normalizeTripStatus(mergedResponseTrip.status) === 'EXPIRED'
        ? 'expired'
        : resolveBookingPhase(mergedResponseTrip);
      const nextFare = buildFareSnapshot(mergedResponseTrip);
      const nextBooking: BookingRequestState = {
        ...requestSnapshot,
        bookingId,
        bookingReference: bookingReferenceFromResponse || (bookingId ? String(bookingId) : resolvedPhase === "confirmed" ? "Confirmed" : "Reserved"),
        fare: nextFare.fare,
        supportFare: nextFare.supportFare ?? requestSnapshot.supportFare,
        originalFare: nextFare.originalFare ?? requestSnapshot.originalFare,
        discountPercentage: nextFare.discountPercentage ?? requestSnapshot.discountPercentage,
        discountAmount: nextFare.discountAmount ?? requestSnapshot.discountAmount,
        pendingRequest,
        status: responseTrip?.status ?? data?.status ?? selectedTrip.status ?? null,
        bookingState: responseTrip?.bookingState ?? data?.bookingState ?? selectedTrip.bookingState ?? null,
        phase: resolvedPhase === "confirmed" ? "confirmed" : resolvedPhase === "support" ? "support" : resolvedPhase === "expired" ? "expired" : "pending",
        driver: resolvedPhase === "support" ? "Customer Support" : getTripDriverLabel(responseTrip || selectedTrip),
      };

      setTrips((current) => current.filter((trip) => String(trip.id) !== String(selectedTrip.id)));
      setBookingRequestState(nextBooking);
      bookingRequestStateRef.current = nextBooking;
      upsertSessionBooking(nextBooking);
      setBookingReference(nextBooking.bookingReference);
      setCustomerSession((current) => current ? { ...current, name: nextBooking.customerName } : current);
      closeBooking();
      if (bookingId) {
        void refreshBookingConfirmation(bookingId, { retry: true }).catch((err) => {
          console.warn(`${UI_DEBUG_PREFIX} failed to refresh booking confirmation after request`, err);
        });
      }
      try {
        await refreshTrips();
      } catch {
        setPageNotice(
          nextBooking.phase === 'pending'
            ? 'Your booking request is waiting for driver response. Availability will refresh on the next reload.'
            : nextBooking.phase === 'confirmed'
              ? 'Return trip booking is confirmed. Availability will refresh on the next reload.'
              : 'Return trip status changed. Availability will refresh on the next reload.',
        );
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        closeBooking();
        setBookingRequestState(null);
        bookingRequestStateRef.current = null;
        setPageNotice(err.message || 'Driver is unavailable for this return trip');
        void refreshTrips().catch(() => undefined);
      } else {
        setBookingError(err instanceof Error ? err.message : 'Unable to send booking request');
      }
    } finally {
      setBookingBusy(false);
    }
  };

  const startAnotherBooking = () => {
    closeBooking();
  };

  const handleFeatureAction = (key: string) => {
    if (key === 'refresh') {
      void refreshTrips();
      return;
    }
    if (key === 'expiring') {
      setOnlyExpiringSoon((current) => !current);
      return;
    }
    if (key === 'rating') {
      setSortKey('rating');
      return;
    }
    if (key === 'price') {
      setSortKey('price');
    }
  };

  useEffect(() => {
    if (!selectedTrip || bookingBusy) return;
    const selectedTripStillVisible = trips.some((trip) => String(trip.id) === String(selectedTrip.id));
    if (!selectedTripStillVisible) {
      closeBooking();
      setPageNotice('This return trip is no longer available.');
    }
  }, [selectedTrip, trips, bookingBusy]);

  return (
    <div className={`page-shell${selectedTrip || bookingRequestState || profileView ? ' page-shell--booking-open' : ''}`}>
      <header className="site-nav">
        <div className="site-nav__brand">
          <img className="site-nav__logo" src={rootCabsLogo} alt="Root Cabs" />
        </div>
        <div className="site-nav__actions">
          <nav className="site-nav__links" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                className={`site-nav__link${link.active ? ' is-active' : ''}`}
                href={link.href}
              >
                <span>{link.label}</span>
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="site-nav__contact"
            onClick={() => {
              window.location.href = 'https://rootcabs.com/book-ride';
            }}
          >
            Book Now
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="filters">
          <div className="filters__head">
            <Filter size={18} />
            <h2>Filters</h2>
          </div>

          <button className="filters__action filters__action--top" type="button" onClick={() => setProfileView('upcoming')}>
            <span>Upcoming trips</span>
            <strong>{upcomingSessionBookings.length}</strong>
          </button>

          <section className="filter-group">
            <label>Pickup city</label>
            <select value={pickupCity} onChange={(e) => setPickupCity(e.target.value)}>
              <option value="all">All pickup cities</option>
              {cityOptions.pickups.map((city) => (
                <option key={city} value={normalize(city)}>{city}</option>
              ))}
            </select>
          </section>

          <section className="filter-group">
            <label>Destination city</label>
            <select value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)}>
              <option value="all">All destination cities</option>
              {cityOptions.drops.map((city) => (
                <option key={city} value={normalize(city)}>{city}</option>
              ))}
            </select>
          </section>

          <section className="filter-group">
            <label>Minimum rating</label>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
            />
            <div className="range-meta">
              <span>0.0</span>
              <strong>{minRating.toFixed(1)}</strong>
              <span>5.0</span>
            </div>
          </section>

          <section className="filter-group">
            <label>Max fare</label>
            <input
              type="range"
              min="0"
              max={Math.max(highestPrice, 1000)}
              step="50"
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
            />
            <div className="range-meta">
              <span>0</span>
              <strong>Rs {formatMoney(maxPriceLabel)}</strong>
              <span>Rs {formatMoney(Math.max(highestPrice, 1000))}</span>
            </div>
          </section>

          <section className="filter-group">
            <label className="checkrow">
              <input
                type="checkbox"
                checked={onlyExpiringSoon}
                onChange={(e) => setOnlyExpiringSoon(e.target.checked)}
              />
              <span>Expiring soon</span>
            </label>
          </section>

          <section className="filter-summary">
            <span><Sparkles size={15} /> {filteredTrips.length} trips visible</span>
          </section>
        </aside>

        <section className="results">
          <div className="results-board">
            <div className="promo-strip">
              {FEATURE_CARDS.map((card) => (
                <article key={card.key} className={`promo-card ${card.tone}`}>
                  <strong>{card.eyebrow}</strong>
                  <p>{card.text}</p>
                  <button type="button" className="promo-card__cta" onClick={() => handleFeatureAction(card.key)}>
                    {card.key === 'expiring' && onlyExpiringSoon ? 'Show all rides' : card.cta}
                  </button>
                </article>
              ))}
            </div>

            <div className="results-toolbar">
              <div className="results-toolbar__count">{filteredTrips.length} trips found</div>
              <div className="results-toolbar__sort">
                <span className="results-toolbar__label">Sort by</span>
                <div className="sort-chips">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`sort-chip${sortKey === option.key ? ' is-active' : ''}`}
                      onClick={() => setSortKey(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {pageNotice ? (
            <div className="booking-inline-message booking-inline-message--muted">
              <Sparkles size={16} />
              <span>{pageNotice}</span>
            </div>
          ) : null}
          <div className="trip-list">
            {error ? (
              <div className="empty-state">
                <h3>Live data is unavailable</h3>
                <p>{error}</p>
              </div>
            ) : loading
              ? Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)
              : filteredTrips.length
                ? filteredTrips.map((trip) => <TripCard key={trip.id} trip={trip} onBook={startBooking} now={now} />)
                : (
                  <div className="empty-state">
                    <h3>No return trips match the filters</h3>
                    <p>Try clearing one filter or search for a different city pair.</p>
                  </div>
                )}
          </div>
        </section>
      </main>

      {selectedTrip ? (
        <div className="booking-drawer">
          <div className="booking-drawer__overlay" />
          <aside className="booking-panel">
            <div className="booking-panel__header">
              <div>
                <p className="booking-panel__eyebrow">Customer booking</p>
                <h2>Secure this return trip</h2>
              </div>
              <button className="icon-btn" type="button" onClick={closeBooking}>
                <X size={18} />
              </button>
            </div>

            <BookingProgress step={bookingStep} />

            {bookingStep !== 'otp' ? (
              <section className="booking-card">
                <div className="booking-card__route">
                  <strong>{selectedTrip.pickupCity || 'Pickup'}</strong>
                  <ChevronRight size={16} />
                  <strong>{selectedTrip.destinationCity || 'Drop'}</strong>
                </div>
                <div className="booking-card__meta">
                  <span><CarFront size={14} /> {selectedTrip.cabSnapshot?.vehicleType || selectedTrip.driverCarType || 'Cab ready'}</span>
                  <span><TimerReset size={14} /> {formatTimeLeft(selectedTrip.expiresAt)}</span>
                  <span><BadgeIndianRupee size={14} /> {formatMoney(getTripFareValue(selectedTrip))}</span>
                </div>
                <div className="booking-card__addresses">
                  <div>
                    <label>Pickup</label>
                    <p>{selectedTripPickup}</p>
                  </div>
                  <div>
                    <label>Drop</label>
                    <p>{selectedTripDrop}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {bookingError ? (
              <div className="booking-inline-message booking-inline-message--error">
                <X size={16} />
                <span>{bookingError}</span>
              </div>
            ) : null}

            {bookingNotice ? (
              <div className="booking-inline-message booking-inline-message--muted">
                <Sparkles size={16} />
                <span>{bookingNotice}</span>
              </div>
            ) : null}

            {bookingStep === 'phone' ? (
              <section className="booking-stage booking-stage--phone">
                <div className="booking-stage__head">
                  <Phone size={18} />
                  <div>
                    <h3>Start with the customer phone number</h3>
                    <p>We will start a session and check if this rider already exists before moving to OTP verification.</p>
                  </div>
                </div>
                <label className="booking-field">
                  <span>Phone number</span>
                  <input
                    value={customerDraft.phoneNumber}
                    onChange={(e) => setCustomerDraft((current) => ({ ...current, phoneNumber: digitsOnly(e.target.value) }))}
                    placeholder="Enter 10 digit mobile number"
                    inputMode="numeric"
                  />
                </label>
                <div className="booking-actions">
                  <button className="ghost-btn ghost-btn--soft" type="button" onClick={closeBooking}>Cancel</button>
                  <button className="ghost-btn" type="button" disabled={!canContinuePhone || bookingBusy} onClick={continueFromPhone}>
                    {bookingBusy ? 'Checking...' : 'Send OTP'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {bookingStep === 'identity' ? (
              <section className="booking-stage">
                <div className="booking-stage__head">
                  <UserRound size={18} />
                  <div>
                    <h3>
                      {customerDraft.isExistingCustomer
                        ? customerDraft.welcomeBackMessage || `Welcome back, ${customerDraft.name}`
                        : 'Please enter your name to continue'}
                    </h3>
                    <p>
                      {customerDraft.isExistingCustomer
                        ? `OTP is complete for ${formatPhonePreview(customerDraft.phoneNumber)}. Review the profile and continue to booking.`
                        : 'OTP is complete. Capture the customer name now so the profile can be registered before booking.'}
                    </p>
                  </div>
                </div>
                <div className="booking-badge-row">
                  <span className={`booking-badge${customerDraft.isExistingCustomer ? ' booking-badge--success' : ''}`}>
                    {customerDraft.isExistingCustomer ? 'Existing customer' : 'New customer'}
                  </span>
                  <span className="booking-badge">{formatPhonePreview(customerDraft.phoneNumber)}</span>
                </div>
                {customerDraft.needsName ? (
                  <label className="booking-field">
                    <span>Customer name</span>
                    <input
                      value={customerDraft.name}
                      onChange={(e) => setCustomerDraft((current) => ({ ...current, name: e.target.value }))}
                      placeholder="Enter customer first name"
                    />
                  </label>
                ) : (
                  <div className="booking-inline-message">
                    <CheckCircle2 size={16} />
                    <span>Name has already been fetched. You can move straight to OTP.</span>
                  </div>
                )}
                <div className="booking-actions">
                  <button className="ghost-btn ghost-btn--soft" type="button" onClick={() => setBookingStep('phone')}>
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button className="ghost-btn" type="button" disabled={!canContinueIdentity || bookingBusy} onClick={continueFromIdentity}>
                    Continue
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {bookingStep === 'otp' ? (
              <section className="booking-stage booking-stage--otp">
                <div className="booking-stage__head">
                  <ShieldCheck size={18} />
                  <div>
                    <h3>Verify OTP before the booking is locked</h3>
                    <p>Enter the OTP sent to {formatPhonePreview(customerDraft.phoneNumber)}. This step confirms the rider before the booking is submitted.</p>
                  </div>
                </div>
                <div className="booking-inline-message booking-inline-message--otp">
                  <Sparkles size={16} />
                  <span>OTP verification is required to continue.</span>
                </div>
                <label className="booking-field">
                  <span>OTP code</span>
                  <input
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 4 digit OTP"
                    inputMode="numeric"
                  />
                </label>
                <div className="booking-actions">
                  <button className="ghost-btn ghost-btn--soft" type="button" onClick={() => setBookingStep('phone')}>
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button className="ghost-btn" type="button" disabled={!canContinueOtp || bookingBusy} onClick={continueFromOtp}>
                    {bookingBusy ? 'Verifying...' : 'Verify OTP'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {bookingStep === 'confirm' ? (
              <section className="booking-stage">
                <div className="booking-stage__head">
                  <CheckCircle2 size={18} />
                  <div>
                    <h3>Send return-trip request</h3>
                    <p>The customer is verified. Submit this request and wait for the driver to accept or reject it.</p>
                  </div>
                </div>
                <div className="booking-summary-grid">
                  <div>
                    <label>Customer</label>
                    <p>{customerDraft.name || 'Customer name'}</p>
                  </div>
                  <div>
                    <label>Phone</label>
                    <p>{formatPhonePreview(customerDraft.phoneNumber)}</p>
                  </div>
                  <div>
                    <label>Driver</label>
                    <p>{selectedTripDriver}</p>
                  </div>
                  <div>
                    <label>Fare</label>
                    <p>Rs {formatMoney(getTripFareValue(selectedTrip))}</p>
                  </div>
                  <div>
                    <label>Customer id</label>
                    <p>{customerId ? String(customerId) : 'Verified in session'}</p>
                  </div>
                  <div>
                    <label>Session</label>
                    <p>{sid ? 'Verified session active' : 'Not ready'}</p>
                  </div>
                </div>
                <div className="booking-actions">
                  <button className="ghost-btn ghost-btn--soft" type="button" onClick={() => setBookingStep('otp')}>
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button className="ghost-btn" type="button" disabled={bookingBusy} onClick={confirmBooking}>
                    {bookingBusy ? 'Sending...' : 'Send Request'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {bookingStep === 'success' ? (
              <section className="booking-stage booking-stage--success">
                <div className="booking-stage__head">
                  <CheckCircle2 size={20} />
                  <div>
                    <h3>Return trip request submitted</h3>
                    <p>The customer is verified and the request has been sent. Wait for the driver response.</p>
                  </div>
                </div>
                <div className="success-card">
                  <p><strong>{customerDraft.name}</strong> has been validated with OTP on {formatPhonePreview(customerDraft.phoneNumber)}.</p>
                  <p>{bookingReference ? `Booking reference: ${bookingReference}` : 'Booking reference was not returned in the response body.'}</p>
                </div>
                <div className="booking-actions">
                  <button className="ghost-btn ghost-btn--soft" type="button" onClick={closeBooking}>Close</button>
                  <button className="ghost-btn" type="button" onClick={startAnotherBooking}>
                    Book another trip
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      {bookingRequestState ? (
        <div className="success-modal">
          <div className="success-modal__overlay" />
          <div className="success-modal__card">
            <button className="icon-btn success-modal__close" type="button" onClick={() => setBookingRequestState(null)}>
              <X size={18} />
            </button>
            <div className={`success-modal__icon${bookingRequestState.phase !== 'confirmed' ? ` success-modal__icon--${bookingRequestState.phase}` : ''}`}>
              {bookingRequestState.phase === 'pending' ? <TimerReset size={34} /> : null}
              {bookingRequestState.phase === 'support' ? <ShieldCheck size={34} /> : null}
              {bookingRequestState.phase === 'confirmed' ? <CheckCircle2 size={34} /> : null}
            </div>
            <div className="success-modal__copy">
              <p className="booking-panel__eyebrow">
                {bookingRequestState.phase === 'pending' ? 'Waiting for Driver Response' : null}
                {bookingRequestState.phase === 'support' ? 'Customer Support' : null}
                {bookingRequestState.phase === 'confirmed' ? 'Booking Confirmed' : null}
                {bookingRequestState.phase === 'rejected' ? 'Request Rejected' : null}
                {bookingRequestState.phase === 'expired' ? 'Request Expired' : null}
                {bookingRequestState.phase === 'error' ? 'Request Status Unclear' : null}
              </p>
              <h2>
                {bookingRequestState.phase === 'pending' ? 'Your request is pending' : null}
                {bookingRequestState.phase === 'support' ? 'Customer Support is arranging another driver.' : null}
                {bookingRequestState.phase === 'confirmed' ? 'Return trip booked successfully' : null}
                {bookingRequestState.phase === 'rejected' ? 'This trip is available again' : null}
                {bookingRequestState.phase === 'expired' ? 'This return trip expired' : null}
                {bookingRequestState.phase === 'error' ? 'We could not confirm this request yet' : null}
              </h2>
              <p>
                {bookingRequestState.phase === 'pending' ? 'The driver has not responded yet. This screen will update automatically.' : null}
                {bookingRequestState.phase === 'support' ? 'Pricing has been updated and the original driver is no longer assigned to this booking.' : null}
                {bookingRequestState.phase === 'confirmed' ? 'The driver accepted the request and the booking is now confirmed.' : null}
                {bookingRequestState.phase === 'rejected' ? 'The driver did not accept this request. You can close this and try again.' : null}
                {bookingRequestState.phase === 'expired' ? 'The trip expired before the driver accepted it. Please pick another return trip.' : null}
                {bookingRequestState.phase === 'error' ? 'The request was created, but confirmation was not returned. Please retry or refresh the trip list.' : null}
              </p>
            </div>
            <div className="success-modal__grid">
              <div>
                <label>Booking ref</label>
                <p>{bookingRequestState.bookingReference || 'Pending'}</p>
              </div>
              <div>
                <label>Customer</label>
                <p>{bookingRequestState.customerName}</p>
              </div>
              <div>
                <label>Phone</label>
                <p>{bookingRequestState.phoneNumber}</p>
              </div>
              <div>
                <label>Fare</label>
                <p>{bookingRequestState.fare}</p>
              </div>
              <div>
                <label>Route</label>
                <p>{bookingRequestState.route}</p>
              </div>
              <div>
                <label>Driver</label>
                <p>{bookingRequestState.phase === 'support' ? 'Not assigned yet' : bookingRequestState.driver}</p>
              </div>
            </div>
            {bookingRequestState.phase === 'support' && (
              <div className="support-fare-card">
                <div>
                  <label>Original fare</label>
                  <p>{bookingRequestState.farePending ? 'Fare update pending' : bookingRequestState.originalFare || 'Fare update pending'}</p>
                </div>
                <div>
                  <label>{bookingRequestState.discountLabel || 'Discount'}</label>
                  <p>
                    {bookingRequestState.farePending
                      ? 'Fare update pending'
                      : `${bookingRequestState.discountPercentage || '-'}${bookingRequestState.discountAmount ? ` (${bookingRequestState.discountAmount})` : ''}`}
                  </p>
                </div>
                <div>
                  <label>Updated booking fare</label>
                  <p>{bookingRequestState.farePending ? 'Fare update pending' : bookingRequestState.fare}</p>
                </div>
              </div>
            )}
            <div className="success-modal__actions">
              <button className="ghost-btn ghost-btn--soft" type="button" onClick={() => setBookingRequestState(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sessionConflict ? (
        <div className="success-modal">
          <div className="success-modal__overlay" />
          <div className="success-modal__card success-modal__card--compact">
            <button className="icon-btn success-modal__close" type="button" onClick={() => setSessionConflict(null)}>
              <X size={18} />
            </button>
            <div className="success-modal__icon success-modal__icon--pending">
              <ShieldCheck size={34} />
            </div>
            <div className="success-modal__copy">
              <p className="booking-panel__eyebrow">Booking already open</p>
              <h2>Continue this booking?</h2>
              <p>{sessionConflict.message}</p>
            </div>
            <div className="success-modal__actions success-modal__actions--split">
              <button className="ghost-btn ghost-btn--soft" type="button" disabled={bookingBusy} onClick={() => setSessionConflict(null)}>
                Keep current booking
              </button>
              <button className="ghost-btn" type="button" autoFocus disabled={bookingBusy} onClick={() => void sessionConflict.confirmAction()}>
                {bookingBusy ? 'Continuing...' : 'Continue here'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileView ? (
        <div className="success-modal">
          <div className="success-modal__overlay" />
          <div className="success-modal__card profile-screen">
            <button className="icon-btn success-modal__close" type="button" onClick={() => setProfileView(null)}>
              <X size={18} />
            </button>
            <div className="success-modal__copy">
              <p className="booking-panel__eyebrow">
                {profileView === 'profile' ? 'Customer Profile' : 'Upcoming Trips'}
              </p>
              <h2>{profileView === 'profile' ? (customerSession?.name || 'Verified customer') : 'Your upcoming trips'}</h2>
            </div>

            {profileView === 'profile' ? (
              <div className="success-modal__grid">
                <div>
                  <label>Name</label>
                  <p>{customerSession?.name || 'Not set'}</p>
                </div>
                <div>
                  <label>Phone</label>
                  <p>{customerSession ? formatPhonePreview(customerSession.phoneNumber) : 'Not available'}</p>
                </div>
                <div>
                  <label>Customer type</label>
                  <p>{customerSession?.isExistingCustomer ? 'Existing customer' : 'New customer'}</p>
                </div>
                <div>
                  <label>Upcoming trips</label>
                  <p>{upcomingSessionBookings.length}</p>
                </div>
              </div>
            ) : upcomingSessionBookings.length ? (
              <div className="session-bookings-list">
                {upcomingSessionBookings.map((booking) => (
                  <article className="session-booking-item" key={`${booking.tripId}-${booking.bookingReference}`}>
                    <div>
                      <label>Route</label>
                      <p>{booking.route}</p>
                    </div>
                    <div>
                      <label>Booking ref</label>
                      <p>{booking.bookingReference}</p>
                    </div>
                    <div>
                      <label>Status</label>
                      <p>{booking.phase === 'confirmed' ? 'Your booking is confirmed' : booking.phase === 'support' ? 'Your request is under review' : 'Waiting for driver response'}</p>
                    </div>
                    <div>
                      <label>Fare</label>
                      <p>{booking.fare}</p>
                    </div>
                    <div>
                      <label>Booked</label>
                      <p>{new Date(booking.bookedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state profile-screen__empty">
                <h3>No upcoming trips in this session</h3>
                <p>Confirmed trips for this customer will appear here during this page session.</p>
              </div>
            )}

            <div className="success-modal__actions">
              <button className="ghost-btn ghost-btn--soft" type="button" onClick={() => setProfileView(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;












