# JetSpeed Couriers API

The API is versioned under `/api/v1` and returns JSON. `GET /health` is unauthenticated.

## Resources

- `GET /api/v1/packages` and `GET /api/v1/packages/:trackingNumber` — package and tracking lookup.
- `GET|POST /api/v1/prealerts` — submit and list prealerts.
- `GET|POST /api/v1/invoices` — invoice records.
- `GET|POST /api/v1/payments` — payment records (integrate a payment provider before production).
- `GET|POST /api/v1/deliveries` — delivery operations.
- `GET|POST /api/v1/admin` — administrative scaffold.

Send `Authorization: Bearer <Supabase access token>` when Supabase is configured. Without Supabase variables, the server intentionally uses an in-memory demo store and permits scaffold requests; do not use that mode in production.
