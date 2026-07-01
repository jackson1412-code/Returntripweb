## Customer Return Trips Handoff

### Endpoints used by the customer frontend

- `GET /api/customer/dev/return-trips`
- `GET /api/customer/dev/return-trips/:id`
- `POST /api/customer/dev/return-trips/:id/book`
- `GET /api/customer/dev/return-trips/events`

### Customer list behavior

The customer home screen keeps the browse-first list view.

The frontend hides a trip from the visible list when any of these are true:

- `status !== "ACTIVE"`
- `bookingId` exists
- `expiresAt` is in the past

There is no customer-facing status filter on this page. The page is meant to show only currently bookable active trips.

### Booking flow behavior

`POST /api/customer/dev/return-trips/:id/book` no longer means immediate confirmation.

It now creates a pending request. After the request succeeds, the frontend:

1. removes that trip from the local visible list immediately
2. closes the booking drawer
3. opens a `Waiting for Driver Response` modal
4. keeps refetching the list in the background

The waiting modal polls `GET /api/customer/dev/return-trips/:id`.

### Polling rules on trip detail

The frontend checks:

- `bookingState === "PENDING"`  
  Keep showing the waiting state.

- `status === "BOOKED"`  
  Move the UI to confirmed booking state.

- `status === "ACTIVE"` and `pendingRequest` is empty  
  Treat the request as rejected and allow the customer to retry from the list.

### Live SSE behavior

The frontend subscribes with:

```ts
new EventSource("<base>/api/customer/dev/return-trips/events", {
  withCredentials: true
})
```

The frontend listens to:

- `return_trip_unavailable`
- `return_trip_created`

### SSE handling rules

#### `return_trip_unavailable`

The frontend removes ids from the list in this order of preference:

- `tripIds`
- `ids`
- `bookedReturnTripId` plus `unavailableReturnTripIds`

Reason handling:

- `reason: "PENDING"`  
  Remove the trip while a customer request is waiting for driver response.

- `reason: "BOOKED"`  
  Remove the trip permanently because the booking is confirmed.

#### `return_trip_created`

The frontend accepts both of these reasons as a live availability add/restore signal:

- `reason: "CREATED"`
- `reason: "REJECTED"`

Handling:

1. if the payload includes a full selectable `trip`, insert it into local state immediately
2. perform a background refetch of `GET /api/customer/dev/return-trips`

`reason: "REJECTED"` means a previously pending trip became available again after driver rejection and should reappear in the list.

### Expected SSE payloads

#### Unavailable event

```json
{
  "bookedReturnTripId": 185,
  "unavailableReturnTripIds": [186, 187],
  "tripIds": [185, 186, 187],
  "ids": [185, 186, 187],
  "reason": "BOOKED",
  "ts": 1719390000000
}
```

#### Created / available-again event

```json
{
  "trip": { /* full return trip object */ },
  "tripId": 207,
  "tripIds": [207],
  "ids": [207],
  "reason": "CREATED",
  "ts": 1719390000000
}
```

Or after rejection:

```json
{
  "trip": { /* full return trip object */ },
  "tripId": 207,
  "tripIds": [207],
  "ids": [207],
  "reason": "REJECTED",
  "ts": 1719390000000
}
```

### Important response fields used by the frontend

- `pickupCity`
- `destinationCity`
- `pickupFormatAddress`
- `dropFormatAddress`
- `driverRating`
- `cabSnapshot`
- `driverCarType`
- `driverOfferPrice` or `finalPrice`
- `bookingState`
- `pendingRequest`

### UI expectations already aligned with backend

- fare display prefers `driverOfferPrice`, then falls back to `finalPrice`
- rounded fare values are displayed as whole numbers
- formatted pickup/drop addresses are shown from backend-provided formatted values
- driver rating display uses the normal booking average rating

### Fallback behavior

If SSE disconnects:

- the page still works
- pending-request polling still works
- list refetch still works
- manual refresh remains a valid recovery path
