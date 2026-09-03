# Contract prefill: what the source records are missing

Notes only — nothing here is implemented yet. Recorded 2026-09-03 while
wiring standing orders and salary deductions up to the loan contract.

## What the contract requires

`loan-contract.html` marks these fields required before it will print:

| Field | Comes from the borrower | Comes from the deal |
| --- | --- | --- |
| `borrowerName` | ✅ | |
| `trn` | ✅ | |
| `contactNo` | ✅ | |
| `addressLine1` | ✅ | |
| `town` | ✅ | |
| `parish` | ✅ | |
| `principal` | | ✅ |
| `processingFee` | | ✅ |
| `dailyRate` | | ✅ |
| `lateFee` | | ✅ |
| `agreementDate` | | ✅ |
| `firstPaymentDate` | | ✅ |
| `frequency` | | ✅ |
| `instalments` | | ✅ |

`email` is on the agreement but is not required.

## Gap 1 — the authorization forms carry no borrower address

Both forms collect the borrower's name, TRN and contact number, and enough
of the deal to seed the schedule, but neither collects where the borrower
lives. A contract opened from either record therefore always leaves the
operator to type the address by hand.

| Contract field | Standing order | Salary deduction |
| --- | --- | --- |
| `borrowerName` | `borrowerName` | `borrowerName` |
| `trn` | `trn` | `trn` |
| `contactNo` | `contactNo` | `contactNo` |
| `addressLine1` | **missing** | **missing** |
| `addressLine2` | **missing** | **missing** |
| `town` | **missing** | **missing** |
| `parish` | **missing** | **missing** |
| `email` | **missing** | **missing** |
| `principal` | `loanAmount` | `loanAmount` |
| `instalments` | `totalMonths` | `totalMonths` |
| `frequency` | `repaymentFrequency` | `payFrequency` |
| `firstPaymentDate` | `startDate` | `startDate` |
| `agreementDate` | `contractDate` | `contractDate` |
| instalment amount | `paymentAmount` | `deductionAmount` |
| `processingFee` | **missing** | **missing** |
| `dailyRate` | **missing** | **missing** |
| `lateFee` | **missing** | **missing** |

Note the standing order *does* collect an address — `bankAddress1`,
`bankTown`, `bankParish` — but that is the **bank's** address, not the
borrower's. It must not be used to fill the borrower's address on the
contract.

**To do:** add a borrower address block (address line 1, address line 2,
town/city, parish) to both `standing-order.html` and
`salary-deduction.html`, using the same parish dropdown and validation as
the profile page. Worth doing even before the contract needs it, so the
records can later be matched to and loaded from a borrower profile.

## Gap 2 — user profile creation does not collect everything either

The `users` documents hold:

```
firstName, lastName, email, phone, addressLine1, addressLine2, parish,
role, status, createdAt, lastLogin
```

Against the contract's required list, a profile is missing:

- **`trn`** — the contract requires it, the profile has nowhere to put it.
  This is the significant one: TRN is the field that would let a standing
  order, a salary deduction and an application be recognised as the same
  person.
- **`town` / city** — the profile has `addressLine1`, `addressLine2` and
  `parish` but no town, so a contract prefilled from a profile would still
  stop on a required field.

**To do:** add TRN (9 digits, same rule as the forms and the contract) and
town/city to user creation and to the profile edit page, then treat the
profile as the canonical borrower record the other three read from.

## Gap 3 — the forms and the contract price a loan differently

The authorization forms have no interest model: on the salary deduction
used to test this, `loanAmount` is 154,800 and `deductionAmount` is
12,900, and 12 × 12,900 comes to exactly 154,800. The contract charges
daily interest on a principal, which on the same figures would produce a
total nearer 361,600.

**Settled for now:** on an authorization form the amount is the *final*
amount — what the borrower repays in full — not a principal to charge
interest on. The contract carries it as the total repayable and divides
the schedule out of it, so 154,800 closes at J$0.00 over 12 instalments
of 12,900.

The two are kept apart rather than reconciled. The contract's daily
interest calculation is untouched and still applies to a contract filled
in by hand and to one seeded from a loan application, where the principal
really is a principal. Editing the principal, processing fee or daily
rate on a form-seeded contract hands pricing back to the contract's own
model, and the Calculated Totals box says which of the two is in force.

**Still to resolve:** the Loan Details table on a form-seeded contract
still prints "Principal Loan Amount" against a figure that is really the
total, and the stated Daily Interest Rate has not been applied to it.
Reconciling the two models — or relabelling the row — is the open piece.

## Also open — the schedule does not paginate

Unrelated to prefill, but found while measuring: the contract's repayment
schedule renders as one table on the agreement page with no page
splitting. It fits up to **17 instalments**; at 18 the page reaches
14.06in against a 14in Legal sheet, and `.page` is `overflow: hidden`, so
rows past the bottom are dropped rather than flowing onto another sheet.
Any term of 18 months or more prints an incomplete schedule.

`standing-order.html` and `salary-deduction.html` already solve this by
chunking rows across pages; the contract needs the same treatment.

## Why this matters together

Once the forms carry a borrower address and profiles carry TRN, TRN
becomes the join key: a new standing order could look up an existing
borrower and fill itself in, and the contract could be seeded from the
profile rather than from whichever record happened to be opened. Until
then every contract needs an address typed by hand.
