# Loan System MVP

This repository contains a **minimal loan application system** built with Node.js.  It provides two front‑end experiences: one for loan **applicants** to submit their personal details and choose a loan promotion, and another for **admins** to create, edit and manage loan promotions and review incoming applications.

## Prerequisites

- **Node.js v18** or newer with npm installed.  No additional global dependencies are required; everything is installed via `npm`.
- This project has no external database dependencies.  All state is persisted in local JSON files under `storage/data/` so it runs anywhere.

## Quick start

1. **Install and seed data**

   Run the setup script from the project root:

   ```bash
   cd loan-system-mvp
   bash scripts/setup.sh
   ```

   This will install npm dependencies, create the `storage/data/` folder if needed, seed five default promotions, a sample application, two users and a loan, and then start the server on port `3000`.

2. **Open the application**

   Once the server is running, visit one of the following pages in your browser:

   - `http://localhost:3000/` – Login page.  Admins enter `admin`/`testpass`; applicants enter their TRN.  Admins are redirected to the dashboard; applicants jump straight to their edit page if a record exists.
   - `http://localhost:3000/apply.html` – Applicant page.  Choose a promotion from the dropdown, upload a **photo ID** and any number of **payslips**, enter your details (name, email, TRN, Jamaican phone and parish) and select a term.  Submitting creates a new application and gives you a status link.
   - `http://localhost:3000/admin-dashboard.html` – Admin dashboard with two links: **Manage Promotions** and **Manage Applications**.  Admins land here after logging in.
   - `http://localhost:3000/admin.html` – Manage promotions.  A two‑pane layout: the left pane lists all saved promotions (click one to load it into the form), with a **New Promotion** button to reset the form.  The right pane contains the CRUD form and, beneath it, a table listing promotions with a delete button for each row.  When editing a promotion the form shows **Update** as well as **Save As New** to clone the current template; when creating a new promotion the form shows **Save** only.
   - `http://localhost:3000/admin-applications.html` – Manage applications.  At the top of the page you’ll see summary cards showing counts of **Approved**, **Pending**, **Rejected** and **Total** applications.  Below, a **three‑pane layout** separates the application queue (left), the editable application form (centre) and the conversation panel (right).  The queue is sorted by submission time and displays the applicant name, status and submission date; clicking a row loads the application into the form.  The form lets you update applicant details, set the status (Submitted, Pending Applicant, Approved, Rejected), record a reason, tick checkboxes next to fields that should be sent back to the applicant for correction and view uploaded attachments.  The conversation panel displays all messages exchanged with the applicant and provides a text box for the admin/loan officer to respond.  Fields flagged by the admin are highlighted with a soft pink background.  All edits are logged to `storage/data/app_edit_log.jsonl` for auditing.
   - `http://localhost:3000/applicant-edit.html?trn=TRN` – Applicant edit page.  Applicants use this page to review and update **all** of their submitted details.  A navigation bar shows a logout link.  The top of the page displays the current status and any reason provided by the admin.  Fields that the admin has flagged for correction are highlighted with a soft pink background.  Applicants can view previously uploaded attachments (photo ID and payslips), upload a new photo ID and additional payslips, and send messages to the admin/loan officer via the built‑in mailbox.  All messages are stored with the application.  The TRN parameter identifies which application to load.
   - `http://localhost:3000/status.html?id=APP_ID` – Applicant status page.  Replace `APP_ID` with an application ID (e.g. `1`) to see its current status, reason and flagged fields.

## Project structure

- **public/** – Static HTML pages and a single `styles.css` file for styling.  Modify these files to change the UI:
  - `index.html` – Login page for admin and applicants.  Admins enter a username and password (`admin` / `testpass`) and are redirected to the dashboard; applicants enter their TRN to edit their application if it exists.
  - `admin-dashboard.html` – The admin landing page after login.  Provides buttons to manage promotions or manage applications.
  - `apply.html` – Applicant form.  Contains a promotion dropdown and collects applicant information.  Phone numbers are entered as area code (876/658) plus a seven‑digit number.
  - `admin.html` – Promotions manager.  Implements a two‑pane layout: the left “well” lists all promotions for quick navigation along with a **New Promotion** button, and the right pane contains a CRUD form.  Beneath the form is a table listing promotions with delete buttons for removing entries.  When editing a promotion you’ll see **Update** and **Save As New** buttons; when creating a new promotion you see only **Save**.
  - `admin-applications.html` – Applications manager.  Loads applications from the API and presents a three‑pane layout: a sorted application queue on the left, an editable details form in the centre, and a conversation panel on the right for messaging the applicant.  This page also shows summary cards for application statuses.
  - `applicant-edit.html` – Applicant edit page.  Allows applicants to update only the fields flagged by the admin.  Accessible via `applicant-edit.html?trn=TRN`.
  - `status.html` – Applicant status page.
  - `styles.css` – Global stylesheet.  Defines the layout for the admin and applicant pages, form inputs, lists and buttons.  Adjust styles here for a different look and feel.

- **src/server.js** – Lightweight HTTP server using Node’s `http` module.  Serves static files from `public/` and exposes a JSON API under `/api/` for promotions, applications, users, loans and parishes.  Persists changes by reading and writing the JSON files in `storage/data/`.

- **scripts/setup.sh** – Installs npm dependencies (if necessary), seeds default data, and starts the server.  It also creates `storage/data/` on the first run.

- **scripts/reset.sh** – Utility script that deletes `applications.json` and `promotions.json` so you can reset the data to the default state.  Run this while the server is stopped, then restart with `setup.sh`.

- **storage/data/** – Local JSON “database”:
  - `promotions.json` – List of loan promotions (seeded with five entries by default).  Each has fields like `id`, `name`, `principal`, `monthlyInterestPct`, `termMode`, `allowedTerms` or `fixedTermMonths`.
  - `applications.json` – List of submitted applications.  Each contains the applicant’s details, the selected promotion snapshot, the chosen term, status, reason and any per‑field review flags.  Applications may also include an `attachments` object (with a `photoId` file and an array of `payslips`) and a `messages` array to hold conversations between the applicant and the reviewing admin/loan officer.
  - `users.json` – Demo users (admin and applicant) for possible future extensions.
  - `loans.json` – Demo loan record representing an active loan.  Not used by the current UI but illustrates how a loan could be recorded.
  - `parishes.json` – List of the 14 parishes of Jamaica.  This data populates the parish dropdown in forms.

## Customizing and extending

- **Add or edit promotions:** Use the Admin promotions page to add or modify promotions in the UI.  Alternatively, edit `storage/data/promotions.json` by hand (stop the server first, then restart).
- **Change the list of parishes:** Edit `storage/data/parishes.json` to add or remove parish names.  Both applicant and admin pages load this list dynamically.
- **Switch to a real database:** The current server reads/writes JSON files.  To use SQLite or Postgres, replace the file I/O functions in `src/server.js` with database queries and adjust the API accordingly.

## License

This MVP is provided as a learning sample and comes without any warranty.  Feel free to adapt and extend it for your own projects.