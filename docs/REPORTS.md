# Reports

The **Reports** module (left rail → Reports) produces print-ready reports from the
data already in the cockpit. Every report is shown on screen as an A4 page and can
be saved as a PDF with **Print / Save as PDF** (choose *Save as PDF* as the printer).

| Report | Period | What it covers |
|---|---|---|
| Monthly service report | month or custom range | Executive summary, incident & SLA performance, KPIs, issues opened/closed, objectives, projects, workforce, stand-up delivery, management commentary (latest Executive Update in the period), sign-off |
| Customer SLA report | month or range, per customer | MTTD, MTTA, MTTR (average and median) by priority, SLA compliance, agreed targets, daily volume, categories, every breach, full incident log, customer sign-off |
| Workforce & attendance | month or range | Shifts worked per analyst (weekday/weekend), days off, leave, sick/absence, roster calendar, daily coverage, staffing-gap dates |
| Stand-up & tasks | month or range | Completion rate, effort, by lead and Eisenhower quadrant, daily trend, carried-over tasks, open tasks |
| Shift handover | one day | Who is on duty today and tomorrow, absences, open incidents with SLA state, new incidents, open issues, follow-ups, outstanding tasks, notes, remarks box, outgoing/incoming sign-off |

## Feeding the SLA reports: Excel import

The SLA figures come from the **incident register** (Reports → Incident register).
The quickest way to fill it is to upload your SLA sheet:

1. Click **Download Excel template** (or use your own sheet: the column names below are recognised).
2. Fill one row per ticket: **ticket number, priority, detected date/time** and the ticket's
   **MTTD, MTTA and MTTR**. Customer, title, category, analyst, status and notes are optional.
3. Click **Choose Excel or CSV file** and upload it. Every report updates immediately.

Durations can be minutes (`45`), hours and minutes (`1h 30m`, `2d 4h`) or `h:mm` (`1:30`, or an
Excel time-formatted cell). Leave MTTR empty for tickets that are still open — they are shown as
*in progress* and counted as breached once they pass their target. Re-importing a ticket with the
same number and customer updates it instead of creating a duplicate, so you can upload the same
monthly sheet again after correcting it. Rows with problems are skipped and listed with their row
number.

Exports from Splunk, ServiceNow, Jira or TheHive that contain **timestamps** instead of durations
work too (CSV or Excel). Recognised column names (case-insensitive):

| Field | Accepted headers |
|---|---|
| Ticket number | ticket number, ticket no, ticket, ref, incident id, number, case id, id, key |
| Customer | customer, client, tenant, company, account |
| Title (optional) | title, summary, short description, name, subject, description, alert |
| Priority | priority, severity, urgency — P1–P4, 1–4, Sev1–4, Critical/High/Medium/Low |
| Detected (required) | detected, date, incident date, created, opened, reported, \_time (+ optional separate time column) |
| MTTD / MTTA / MTTR | mttd, mtta, mttr, time to detect / acknowledge / resolve, response time, resolution time |
| Occurred / Acknowledged / Resolved | occurred, event time · acknowledged, ack, first response · resolved, closed |
| Status, Analyst, Category, Notes | status/state · analyst/owner/assignee · category/type · notes/comments |

Dates may be `2026-11-05 14:30`, ISO 8601, `05/11/2026 14:30` (day first) or real Excel dates.
Free-form dates such as "Nov 5 2026" are rejected rather than guessed. Status must be Open,
Acknowledged, Resolved or Closed (common synonyms such as *In Progress* or *Done* are mapped).

A ready-made file with ~300 fictional tickets (August–October 2026, Sample Customer 1–3) is in
[`docs/samples/sample-incidents.csv`](samples/sample-incidents.csv) for trying the upload.

## SLA & KPI policies (Settings, Admin only)

**Settings → SLA & KPI policies** controls how every report measures performance:

- **Compliance thresholds** – the contracted compliance target (green at or above) and the amber
  threshold below it. Used for every SLA percentage and the "met / not met" line.
- **Standard SLA targets** – detect / acknowledge / resolve per priority, for every customer without
  its own contract.
- **Customer-specific SLAs** – per-customer targets that override the standard ones. The customer name
  must match the incident register. The customer's SLA report then shows *customer-specific SLA*.
- **Report header & calendar** – organisation name on every report and the weekend days.
- **KPI health rules** – per KPI, *higher is better* or *lower is better* plus an amber band (% of the
  target). The KPI's health is then calculated from actual vs target whenever it is saved, instead of
  being picked by hand (the same rule can be set in the KPI form in Service). Actual and target must use
  the same unit: both percentages, both durations (`3h 40m`) or both plain numbers.

## How the metrics are calculated

- **MTTD** – occurred → detected (only incidents with an occurred time)
- **MTTA** – detected → acknowledged
- **MTTR** – detected → resolved
- **SLA compliance** – share of measured acknowledge and resolve results within the
  target for the incident's priority. An *open* incident that is already past its
  target counts as a breach; one still within target shows as *In progress*.
- **SLA targets** are the customer's own SLA when one is set, otherwise the standard targets
  (see *SLA & KPI policies* above). The default weekend is Sat + Sun; choose Fri + Sat for Saudi
  Arabia and most GCC countries.

Issues now record when they were opened and closed, so the monthly report can count
them per period. Issues created before this change show in the "open now" list but are
not counted as opened/closed in a period.

## Security controls

| Control | What it does |
|---|---|
| Roles | Viewers can read reports only. Operators and Admins can add, edit and import incidents. **Deleting an incident is Admin only**, because it removes the ticket from SLA results. SLA & KPI policies are Admin only. |
| Change history | Every incident create / edit / delete, every import (file name, SHA-256 of the file, counts) and every SLA policy change is recorded with the user and time. Edits keep the before and after values of the SLA-relevant fields (priority, customer, status, timestamps). Admins see it in Reports → Incident register → Change history (`GET /api/incidents/audit`). |
| Upload checks | `.xlsx` must be a real zip workbook; the archive is inspected before unpacking and files that would expand to an unsafe size (decompression bombs) are rejected. `.csv` must be text. Upload size limit 10 MB; there is no limit on the number of rows. |
| Import rate limit | At most 20 imports per user in 10 minutes (HTTP 429 after that). |
| Input validation | Unknown statuses and ambiguous dates are rejected, timestamps must be in order, ticket numbers / customer names longer than 120 characters are rejected and long text is shortened with a warning. Customer names such as `__proto__` are ignored in SLA settings. Error messages quote input only in a short, sanitised form. |
| Data handling | All queries are parameterised; imported text is displayed as text (never as HTML). |

## Demo data for testing

To try every module and report with realistic, fictional data:

- From the source folder: `npm run seed:demo` (stop nothing; press **Reload** afterwards)
- From a portable package: double-click **Load demo data.cmd** (Windows) or run `./load-demo-data.sh` (Linux)

It adds 8 analysts, a 24/7 shift roster (with leave and sick days) for the last three
months, this month and the next 14 days, ~500 incidents across Sample Customer 1–3,
stand-up tasks, KPIs, objectives, projects, processes, issues, follow-ups, notes and an
executive update for each month. Phone numbers are all zeros. Running it again is refused unless you add `--force`.
Use it on a test copy — the demo records are mixed in with any real data.
