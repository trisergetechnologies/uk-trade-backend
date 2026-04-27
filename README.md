# UK Trade Backend

Express + MongoDB domain server for UK Trade.

## Quick start

1. Copy `.env.example` to `.env`.
2. Set `MONGO_URI` and `JWT_SECRET`.
3. Run `npm install`.
4. Start server with `npm run dev`.

## Core modules

- Auth + RBAC (`user`, `admin`)
- One wallet + wallet ledger
- Payment request + admin approval workflow
- Package purchase + daily trade credits (IST rules)
- Sponsor income with cap based on highest active package
- Binary tree/community placement
- Withdrawal request + admin review

## API prefix

All routes are under `/api`.

## Notes

- Timestamps are stored in UTC; business day logic uses IST.
- Matching income is intentionally not implemented yet.
