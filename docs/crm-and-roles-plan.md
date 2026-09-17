# Support CRM, roles and multi-tenancy — staged plan

Agreed 2026-09-17. Customers sign in with Google; the platform is
multi-tenant from the start; the CRM is built in stages with the ticket
thread first; existing dummy users are backed up, deleted and reseeded.

## The model underneath

### Businesses

One `businesses` document per lending company. Every record that belongs to
a business carries its `businessId`.

| Field | Notes |
| --- | --- |
| `pid` | Opaque public id, same 12-character Crockford scheme as application references |
| `tradingName` | "Loan It Financing" |
| `legalName` | Registered company name |
| `trn` | Company TRN |
| `regulator` / `licenceNumber` / `licenceVerified` | BOJ licence under the Microcredit Act. **See the caveat below.** |
| `address`, `parish`, `phone`, `email` | Shown on printed documents |
| `status`, `createdAt` | |

### Roles

Role lives on the user record, not in an environment variable. The
doxservices address stays in `functions/.env` purely as the bootstrap for
`superAdmin`, so a bad users table can never lock everyone out.

| Role | Who | Sees |
| --- | --- | --- |
| `superAdmin` | doxservices | Everything, every business, the business directory |
| `businessAdmin` | loanit1876@gmail.com, ejunkiex@gmail.com | Their own business's contracts, standing orders and salary deductions, read-only — unchanged from what is built today. Widening this is a separate decision. |
| `support` | internal staff, `@loanapp.com` | Tickets and the records a ticket points at |
| `underwriter` | `@bank.com` | Applications and contracts for their business |
| `applicant` | customers, `@gmail.com` | Only their own records and tickets |

### Users

`pid`, `email`, `role`, `businessId`, name, phone, TRN, address, `status`,
`createdAt`, `lastLoginAt` (a real timestamp — today it is free text such as
"Today, 10:20 AM"), `profileCompletedAt`.

On first sign-in any user with no `profileCompletedAt` is held in a modal
that collects their details before the app opens. One component, every role,
so the experience is the same for staff and customers.

### Migration order

Additive first, enforcing second, so nothing breaks halfway:

1. Create `businesses`, seed Loan It Financing, backfill `businessId` onto
   every existing record.
2. Resolve roles from the users table, keeping the env bootstrap.
3. Only then filter every query by `businessId`.

## The CRM, in stages

### Stage 1 — the ticket thread (build now)

- `tickets`: `pid`, `businessId`, `subject`, `status` (open / waiting on
  customer / resolved), `priority`, customer (`userId`, name, email, TRN),
  `about` (`{ type, id }` pointing at a contract, standing order, salary
  deduction or application), `assignedTo`, `createdAt`, `lastReplyAt`.
- `tickets/{id}/messages`: `author` (customer or staff), `authorId`, `body`,
  `createdAt`.
- `admin-tickets.html` for staff — the same table, ⋮ menu and detail modal
  as the other admin lists.
- A customer page to raise a ticket and follow the thread.
- Opening a ticket from a record carries the link, so support sees the case
  without asking for it.

### Stage 2 — working the queue

Assignment to a person, status transitions with timestamps, internal notes
that the customer never sees, and filters for "mine" and "unassigned".

### Stage 3 — customer view

One page per customer pulling together their applications, authorization
forms, contracts, loans, payments and tickets — the thing support actually
wants open while talking to someone.

### Stage 4 — service levels and reporting

First-response and resolution timers, breach flags, and ticket counts on
the admin dashboard alongside the loan figures.

### Stage 5 — channels

Email in and out of a thread, attachments, and canned replies.

## Caveat on the licence details

TAJ does not license or list lenders; the Bank of Jamaica does, under the
Microcredit Act 2021. BOJ's register lists ten licensed microcredit
institutions and **no Loan It entity appears on it**, and the register
carries no licence numbers, so `MCA-016-2025` — printed on the loan
agreement — cannot be verified against it.

The business record is therefore seeded with the details the app already
uses (trading name, address, phone, email) and `licenceVerified: false`.
The licence number and legal name need confirming from the actual licence
document before they are treated as established fact anywhere.
