import { useEffect, useMemo, useState } from 'react';
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
import {
  bookReturnTrip,
  loadReturnTrips,
  lookupCustomer,
  registerCustomer,
  sendCustomerOtp,
  startSession,
  verifyCustomerOtp,
} from './api';
import type { BookingCustomerDraft, ReturnTrip } from './types';

type SortMode = 'recommended' | 'price-asc' | 'price-desc' | 'rating-desc' | 'expiry-asc';
type BookingStep = 'phone' | 'otp' | 'identity' | 'confirm' | 'success';

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

const formatTimeLeft = (value?: string | null) => {
  if (!value) return 'No expiry set';
  const expiresAt = new Date(value).getTime();
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) return `${minutes} min left`;
  return `${hours}h ${minutes}m left`;
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
  (Number(trip.driverRating || trip.Driver?.rating || 0) * 2) - (Number(trip.finalPrice || 0) / 1000);

const formatPhonePreview = (value: string) => {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return value;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

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
    <div className="booking-progress">
      {steps.map((item, index) => {
        const isDone = index < resolvedIndex || step === 'success';
        const isActive = index === resolvedIndex && step !== 'success';
        return (
          <div
            key={item.id}
            className={`booking-progress__step${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
            aria-label={`${index + 1}. ${item.label}`}
            title={item.label}
          >
            <span>{index + 1}</span>
          </div>
        );
      })}
    </div>
  );
};

const TripCard = ({ trip, onBook }: { trip: ReturnTrip; onBook: (trip: ReturnTrip) => void }) => {
  const driverName = [trip.Driver?.firstName, trip.Driver?.lastName].filter(Boolean).join(' ') || 'Driver';
  const pickup = trip.pickupFormatAddress?.formattedAddress || trip.pickupCity || '-';
  const drop = trip.dropFormatAddress?.formattedAddress || trip.destinationCity || '-';
  const rating = formatRating(trip.driverRating ?? trip.Driver?.rating);
  const cabLabel = [trip.cabSnapshot?.carType || trip.driverCarType, trip.cabSnapshot?.vehicleType]
    .filter(Boolean)
    .join(' / ');

  return (
    <article className="trip-card">
      <div className="trip-card__top">
        <div className="trip-card__route-block">
          <div className="trip-card__route-head">
            <span className="route-tag route-tag--from">FROM</span>
            <span className="route-tag route-tag--to">TO</span>
          </div>
          <div className="trip-card__route">
            <h3 className="trip-card__city trip-card__city--from">{trip.pickupCity || 'Pickup'}</h3>
            <ArrowRight size={16} />
            <h3 className="trip-card__city trip-card__city--to">{trip.destinationCity || 'Drop'}</h3>
          </div>
          <p className="trip-card__driver">by {driverName}</p>
        </div>

        <div className="trip-card__price">
          <span className="trip-card__price-label">Fare</span>
          <strong>
            <BadgeIndianRupee size={16} />
            {formatMoney(trip.finalPrice)}
          </strong>
        </div>
      </div>

      <div className="trip-meta">
        <span className="pill"><Star size={14} /> {rating}</span>
        <span className="pill"><CarFront size={14} /> {cabLabel || 'Cab details'}</span>
        <span className="pill"><TimerReset size={14} /> {formatTimeLeft(trip.expiresAt)}</span>
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

        <button className="ghost-btn" type="button" onClick={() => onBook(trip)}>
          Book Now
          <ArrowRight size={16} />
        </button>
      </div>
    </article>
  );
};

function App() {
  const [trips, setTrips] = useState<ReturnTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pickupCity, setPickupCity] = useState('all');
  const [destinationCity, setDestinationCity] = useState('all');
  const [minRating, setMinRating] = useState(0);
  const [onlyExpiringSoon, setOnlyExpiringSoon] = useState(false);
  const [maxPrice, setMaxPrice] = useState(0);

  const [selectedTrip, setSelectedTrip] = useState<ReturnTrip | null>(null);
  const [bookingStep, setBookingStep] = useState<BookingStep>('phone');
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
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
    let mounted = true;
    setLoading(true);
    setError(null);
    loadReturnTrips()
      .then((data) => {
        if (!mounted) return;
        setTrips(data);
        const priceCap = Math.max(...data.map((trip) => Number(trip.finalPrice) || 0), 0);
        setMaxPrice(priceCap || 5000);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setTrips([]);
        setError(err instanceof Error ? err.message : 'Failed to load return trips');
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
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
        if (pickupCity !== 'all' && normalize(trip.pickupCity) !== pickupCity) return false;
        if (destinationCity !== 'all' && normalize(trip.destinationCity) !== destinationCity) return false;
        if (onlyExpiringSoon) {
          const expiresAt = trip.expiresAt ? new Date(trip.expiresAt).getTime() : Number.POSITIVE_INFINITY;
          if (expiresAt < now || expiresAt - now > 6 * 60 * 60 * 1000) return false;
        }
        if (Number(trip.driverRating || trip.Driver?.rating || 0) < minRating) return false;
        if (maxPrice > 0 && Number(trip.finalPrice || 0) > maxPrice) return false;
        return matchesText(trip, query);
      })
      .sort((a, b) => buildRecommendedScore(b) - buildRecommendedScore(a));
  }, [destinationCity, maxPrice, minRating, onlyExpiringSoon, pickupCity, query, trips]);

  const highestPrice = useMemo(() => Math.max(...trips.map((trip) => Number(trip.finalPrice) || 0), 0), [trips]);
  const maxPriceLabel = maxPrice || highestPrice || 0;
  const selectedTripPickup = selectedTrip?.pickupFormatAddress?.formattedAddress || selectedTrip?.pickupCity || '-';
  const selectedTripDrop = selectedTrip?.dropFormatAddress?.formattedAddress || selectedTrip?.destinationCity || '-';
  const selectedTripDriver = [selectedTrip?.Driver?.firstName, selectedTrip?.Driver?.lastName].filter(Boolean).join(' ') || 'Driver';
  const canContinuePhone = digitsOnly(customerDraft.phoneNumber).length === 10;
  const canContinueIdentity = !customerDraft.needsName || customerDraft.name.trim().length >= 2;
  const canContinueOtp = otpCode.trim().length >= 4;

  const startBooking = (trip: ReturnTrip) => {
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
      phoneNumber: '',
      isExistingCustomer: false,
      needsName: false,
      name: '',
      welcomeBackMessage: '',
    });
  };

  const closeBooking = () => {
    setSelectedTrip(null);
    setBookingStep('phone');
    setBookingBusy(false);
    setBookingError(null);
    setBookingNotice('');
    setBookingReference('');
    setSid('');
    setCustomerId(null);
    setOtpCode('');
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
        const confirmed = window.confirm(
          verification.message || 'This phone number is active on another device. Continue on this browser?',
        );

        if (!confirmed) {
          setBookingNotice('Continue when the customer is ready to use this browser for verification.');
          return;
        }

        const retryResult = await verification.confirmLogoutAllDevices?.();
        if (!retryResult?.success) {
          throw new Error(retryResult?.message || 'OTP retry failed');
        }
        setCustomerId(retryResult.customerId ?? null);
        const needsProfile = customerDraft.needsName || retryResult.customer?.status === 'NOT_ACTIVE';
        setBookingNotice(
          needsProfile
            ? 'OTP accepted. Complete the customer profile before final booking.'
            : 'Customer verified successfully. Booking can be confirmed now.',
        );
        setBookingStep(needsProfile ? 'identity' : 'confirm');
        return;
      }

      if (!verification.success) {
        throw new Error('OTP verification failed');
      }
      setCustomerId(verification.customerId ?? null);
      const needsProfile = customerDraft.needsName || verification.customer?.status === 'NOT_ACTIVE';
      setBookingNotice(
        needsProfile
          ? 'OTP accepted. Complete the customer profile before final booking.'
          : 'Customer verified successfully. Booking can be confirmed now.',
      );
      setBookingStep(needsProfile ? 'identity' : 'confirm');
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
      if (customerDraft.needsName) {
        await registerCustomer(firstName, toIndianPhone(customerDraft.phoneNumber), sid);
      }

      const bookingResponse = await bookReturnTrip(
        selectedTrip,
        firstName,
        toIndianPhone(customerDraft.phoneNumber),
        sid,
      ) as { booking?: { id?: string | number }; notifications?: unknown; data?: { booking?: { id?: string | number } } };

      const bookingId = bookingResponse.booking?.id || bookingResponse.data?.booking?.id;
      setBookingReference(bookingId ? String(bookingId) : '');
      setBookingNotice('Booking created and WhatsApp confirmation should now be handled by the backend.');
      setBookingStep('success');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Unable to confirm booking');
    } finally {
      setBookingBusy(false);
    }
  };

  const startAnotherBooking = () => {
    closeBooking();
  };

  return (
    <div className={`page-shell${selectedTrip ? ' page-shell--booking-open' : ''}`}>
      <header className="topbar">
        <div>
          <h1>Return Trips</h1>
        </div>
        <div className="topbar__actions">
          <label className="searchbox">
            <Search size={18} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city, driver, cab" />
          </label>
        </div>
      </header>

      <main className="layout">
        <aside className="filters">
          <div className="filters__head">
            <Filter size={18} />
            <h2>Filters</h2>
          </div>

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
          <div className="trip-list">
            {error ? (
              <div className="empty-state">
                <h3>Live data is unavailable</h3>
                <p>{error}</p>
              </div>
            ) : loading
              ? Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)
              : filteredTrips.length
                ? filteredTrips.map((trip) => <TripCard key={trip.id} trip={trip} onBook={startBooking} />)
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

            <section className="booking-card">
              <div className="booking-card__route">
                <strong>{selectedTrip.pickupCity || 'Pickup'}</strong>
                <ChevronRight size={16} />
                <strong>{selectedTrip.destinationCity || 'Drop'}</strong>
              </div>
              <div className="booking-card__meta">
                <span><CarFront size={14} /> {selectedTrip.cabSnapshot?.vehicleType || selectedTrip.driverCarType || 'Cab ready'}</span>
                <span><TimerReset size={14} /> {formatTimeLeft(selectedTrip.expiresAt)}</span>
                <span><BadgeIndianRupee size={14} /> {formatMoney(selectedTrip.finalPrice)}</span>
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
              <section className="booking-stage">
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
              <section className="booking-stage">
                <div className="booking-stage__head">
                  <ShieldCheck size={18} />
                  <div>
                    <h3>Verify OTP before the booking is locked</h3>
                    <p>An OTP should be sent to {formatPhonePreview(customerDraft.phoneNumber)} for both new and existing customers.</p>
                  </div>
                </div>
                <label className="booking-field">
                  <span>OTP code</span>
                  <input
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 4 to 6 digit OTP"
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
                    <h3>Confirm return-trip booking</h3>
                    <p>The customer is verified. Confirm now to create the booking and let the backend send WhatsApp confirmation.</p>
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
                    <p>Rs {formatMoney(selectedTrip.finalPrice)}</p>
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
                    {bookingBusy ? 'Booking...' : 'Confirm Booking'}
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
                    <h3>Return trip reserved</h3>
                    <p>The customer is verified, the booking is created, and WhatsApp confirmation should already be triggered by the backend.</p>
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
    </div>
  );
}

export default App;
