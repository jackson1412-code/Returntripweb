import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeIndianRupee,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ChevronRight,
  Filter,
  MapPin,
  Phone,
  Search,
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
  loadReturnTrips,
  lookupCustomer,
  registerCustomer,
  sendCustomerOtp,
  startSession,
  subscribeReturnTripUnavailable,
  verifyCustomerOtp,
} from './api';
import type { BookingCustomerDraft, ReturnTrip } from './types';

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
  phase: 'pending' | 'confirmed' | 'rejected' | 'support' | 'error';
  tripId: number | string;
  bookingReference: string;
  customerName: string;
  phoneNumber: string;
  route: string;
  fare: string;
  driver: string;
  pendingRequest?: unknown;
  status?: string | null;
  bookingState?: string | null;
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

const formatPhonePreview = (value: string) => {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return value;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

const getTripFareValue = (trip: ReturnTrip) => trip.driverOfferPrice ?? trip.finalPrice;

const getBookingReference = (booking: { id?: number | string; bookingReference?: string | null } | null | undefined) => {
  if (!booking) return '';
  if (booking.bookingReference) return booking.bookingReference;
  if (booking.id !== null && booking.id !== undefined) return String(booking.id);
  return '';
};

const NAV_LINKS = [
  { label: 'Home', active: true },
  { label: 'Join Us', href: 'https://rootcabs.com/join-us/' },
  { label: 'Cab Cities', dropdown: true },
];

const CAB_CITY_LINKS = [
  { label: 'Chennai', href: 'https://rootcabs.com/taxi-in-chennai/' },
  { label: 'Kanchipuram', href: 'https://rootcabs.com/taxi-service-in-kanchipuram' },
  { label: 'Tiruvannamalai', href: 'https://rootcabs.com/taxi-in-tiruvannamalai/' },
  { label: 'Ranipet', href: 'https://rootcabs.com/taxi-in-ranipet/' },
  { label: 'Vellore', href: 'https://rootcabs.com/taxi-in-vellore/' },
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
          <span><WalletCards size={14} /> Save {formatMoney(trip.discountAmount)}</span>
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
  const [customerSession, setCustomerSession] = useState<CustomerSessionState | null>(null);
  const [sessionBookings, setSessionBookings] = useState<SessionBookingState[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cabCitiesOpen, setCabCitiesOpen] = useState(false);
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
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
      () => {
        if (!mounted) return;
        console.warn(`${UI_DEBUG_PREFIX} live updates paused, relying on refetch/manual refresh`);
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const refreshTrips = useCallback(async () => {
    const data = (await loadReturnTrips()).filter(isTripSelectable);
    setTrips(data);
    const priceCap = Math.max(...data.map((trip) => Number(getTripFareValue(trip)) || 0), 0);
    setMaxPrice(priceCap || 5000);
  }, []);

  const upsertSessionBooking = useCallback((snapshot: BookingRequestState) => {
    setSessionBookings((current) => [
      {
        tripId: snapshot.tripId,
        bookingReference: snapshot.bookingReference || (snapshot.phase === 'confirmed' ? 'Confirmed' : 'Reserved'),
        customerName: snapshot.customerName,
        phoneNumber: snapshot.phoneNumber,
        route: snapshot.route,
        fare: snapshot.fare,
        driver: snapshot.driver,
        bookedAt: new Date().toISOString(),
        phase: snapshot.phase === 'confirmed' ? 'confirmed' : 'pending',
      },
      ...current.filter((item) => String(item.tripId) !== String(snapshot.tripId)),
    ]);
  }, []);

  const removeSessionBooking = useCallback((tripId: number | string) => {
    setSessionBookings((current) => current.filter((item) => String(item.tripId) !== String(tripId)));
  }, []);

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
      const requestSnapshot = {
        tripId: selectedTrip.id,
        customerName: firstName || 'Customer',
        phoneNumber: formatPhonePreview(customerDraft.phoneNumber),
        route: `${selectedTrip.pickupCity || 'Pickup'} -> ${selectedTrip.destinationCity || 'Drop'}`,
        fare: `Rs ${formatMoney(getTripFareValue(selectedTrip))}`,
        driver: selectedTripDriver,
        bookingReference: 'Pending',
        pendingRequest: selectedTrip.pendingRequest,
        status: selectedTrip.status ?? null,
        bookingState: selectedTrip.bookingState ?? null,
        phase: 'pending' as const,
      };
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
          linkedBooking?: { id?: string | number; bookingReference?: string | null } | null;
          bookingReference?: string | null;
          pendingRequest?: unknown;
          returnTrip?: {
            linkedBooking?: { id?: string | number; bookingReference?: string | null } | null;
            pendingRequest?: unknown;
          } | null;
        };
        booking?: { id?: string | number };
        linkedBooking?: { id?: string | number; bookingReference?: string | null } | null;
        bookingReference?: string | null;
        returnTrip?: {
          linkedBooking?: { id?: string | number; bookingReference?: string | null } | null;
          pendingRequest?: unknown;
        } | null;
      };

      const data = bookingResponse?.data || bookingResponse;
      const responseTrip = data?.returnTrip || bookingResponse?.returnTrip;
      const linkedBooking = data?.linkedBooking || responseTrip?.linkedBooking || data?.booking || bookingResponse?.booking || bookingResponse?.linkedBooking || null;
      const bookingReferenceFromResponse = getBookingReference(linkedBooking) || data?.bookingReference || bookingResponse?.bookingReference || "";
      const pendingRequest = data?.pendingRequest || responseTrip?.pendingRequest || selectedTrip.pendingRequest || null;
      const nextBooking: BookingRequestState = {
        ...requestSnapshot,
        bookingReference: bookingReferenceFromResponse || requestSnapshot.bookingReference,
        pendingRequest,
      };

      setBookingRequestState(nextBooking);
      upsertSessionBooking(nextBooking);
      setBookingReference(bookingReferenceFromResponse || "");
      setCustomerSession((current) => current ? { ...current, name: nextBooking.customerName } : current);
      closeBooking();
      void refreshTrips().catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        closeBooking();
        setBookingRequestState(null);
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
    if (!selectedTrip || bookingBusy || bookingRequestState) return;
    const selectedTripStillVisible = trips.some((trip) => String(trip.id) === String(selectedTrip.id));
    if (!selectedTripStillVisible) {
      closeBooking();
      setPageNotice('This return trip is no longer available.');
    }
  }, [selectedTrip, trips, bookingBusy, bookingRequestState]);

  return (
    <div className={`page-shell${selectedTrip || bookingRequestState || profileView ? ' page-shell--booking-open' : ''}`}>
      <header className="site-nav">
        <div className="site-nav__brand">
          <img className="site-nav__logo" src={rootCabsLogo} alt="Root Cabs" />
        </div>
        <div className="site-nav__actions">
          <label className="searchbox site-nav__search">
            <Search size={18} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city, driver, cab" />
          </label>
          <nav className="site-nav__links" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              link.dropdown ? (
                <div key={link.label} className={`site-nav__dropdown${cabCitiesOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className={`site-nav__link${link.active ? ' is-active' : ''}`}
                    aria-expanded={cabCitiesOpen}
                    aria-haspopup="menu"
                    onClick={() => setCabCitiesOpen((current) => !current)}
                  >
                    <span>{link.label}</span>
                    <ChevronRight size={14} className="site-nav__caret" />
                  </button>
                  {cabCitiesOpen ? (
                    <div className="site-nav__dropdown-menu" role="menu" aria-label="Cab cities">
                      {CAB_CITY_LINKS.map((city) => (
                        <a
                          key={city.label}
                          className="site-nav__dropdown-item"
                          role="menuitem"
                          href={city.href}
                          onClick={() => setCabCitiesOpen(false)}
                        >
                          {city.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  key={link.label}
                  type="button"
                  className={`site-nav__link${link.active ? ' is-active' : ''}`}
                  onClick={() => {
                    if (link.href) {
                      window.location.href = link.href;
                    }
                  }}
                >
                  <span>{link.label}</span>
                </button>
              )
            ))}
          </nav>
          {customerSession ? (
            <div className="topbar__profile">
              <button className="profile-chip" type="button" onClick={() => setProfileOpen((current) => !current)}>
                <UserRound size={16} />
                <span>{customerSession.name || formatPhonePreview(customerSession.phoneNumber)}</span>
              </button>
            </div>
          ) : null}
          <button type="button" className="site-nav__contact">Contact Us</button>
        </div>
      </header>

      {customerSession && profileOpen ? (
        <div className="profile-popover">
          <button className="profile-popover__overlay" type="button" aria-label="Close profile menu" onClick={() => setProfileOpen(false)} />
          <div className="profile-menu">
            <button
              className="profile-menu__item"
              type="button"
              onClick={() => {
                setProfileView('profile');
                setProfileOpen(false);
              }}
            >
              Profile
            </button>
            <button
              className="profile-menu__item"
              type="button"
              onClick={() => {
                setProfileView('upcoming');
                setProfileOpen(false);
              }}
            >
              Upcoming trips
            </button>
          </div>
        </div>
      ) : null}

      {cabCitiesOpen ? (
        <button
          className="site-nav__dropdown-overlay"
          type="button"
          aria-label="Close cab cities menu"
          onClick={() => setCabCitiesOpen(false)}
        />
      ) : null}

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
          <div className="booking-drawer__overlay" onClick={closeBooking} />
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
          <div className="success-modal__overlay" onClick={() => setBookingRequestState(null)} />
          <div className="success-modal__card">
            <button className="icon-btn success-modal__close" type="button" onClick={() => setBookingRequestState(null)}>
              <X size={18} />
            </button>
            <div className={`success-modal__icon${bookingRequestState.phase !== 'confirmed' ? ` success-modal__icon--${bookingRequestState.phase}` : ''}`}>
              {bookingRequestState.phase === 'pending' ? <TimerReset size={34} /> : null}
              {bookingRequestState.phase === 'confirmed' ? <CheckCircle2 size={34} /> : null}
              {bookingRequestState.phase === 'rejected' ? <X size={34} /> : null}
              {bookingRequestState.phase === 'support' ? <ShieldCheck size={34} /> : null}
              {bookingRequestState.phase === 'error' ? <X size={34} /> : null}
            </div>
            <div className="success-modal__copy">
              <p className="booking-panel__eyebrow">
                {bookingRequestState.phase === 'pending' ? 'Waiting for driver response' : null}
                {bookingRequestState.phase === 'confirmed' ? 'Booking Confirmed' : null}
                {bookingRequestState.phase === 'rejected' ? 'Request Rejected' : null}
                {bookingRequestState.phase === 'support' ? 'Booking Reserved' : null}
                {bookingRequestState.phase === 'error' ? 'Request Status Unclear' : null}
              </p>
              <h2>
                {bookingRequestState.phase === 'pending' ? 'Your booking is reserved' : null}
                {bookingRequestState.phase === 'confirmed' ? 'Return trip booked successfully' : null}
                {bookingRequestState.phase === 'rejected' ? 'This trip is available again' : null}
                {bookingRequestState.phase === 'support' ? 'Your request is under review' : null}
              </h2>
              <p>
                {bookingRequestState.phase === 'pending' ? 'Waiting for driver response.' : null}
                {bookingRequestState.phase === 'confirmed' ? 'The driver accepted the request and the booking is now confirmed.' : null}
                {bookingRequestState.phase === 'rejected' ? 'The driver did not accept this request. You can close this and try again.' : null}
                {bookingRequestState.phase === 'support' ? 'Your request is under review. Customer support will contact you shortly.' : null}
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
                <p>{bookingRequestState.driver}</p>
              </div>
            </div>
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
          <div className="success-modal__overlay" onClick={() => setSessionConflict(null)} />
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
          <div className="success-modal__overlay" onClick={() => setProfileView(null)} />
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












