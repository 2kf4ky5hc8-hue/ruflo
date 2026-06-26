# Atlas QA Agent Playbook

Exploratory checks for a **browser agent** (Claude in Chrome, Playwright MCP, or a
human) to run **after** the automated Playwright suite (`npm run test:e2e`) passes.
Playwright proves the happy paths and permissions; this playbook hunts for the
weird, confusing, and silently-broken.

## Golden rules
- **Staging only.** Use `https://atlas-staging-19w.pages.dev` and the staging
  test users (`james+stg-admin/manager/staff/viewer@cubittwren.co.uk`).
- **Never** sign into or write to production (`ruflo-35k.pages.dev`).
- Don't hard-delete anything (the app shouldn't let you — verify that).

## Pre-req
Automated suite is green:
```bash
cd atlas
cp .env.e2e.example .env.e2e   # fill in staging URL + test-user passwords
npm run test:e2e               # guard + auth + clients + permissions + contributions
npm run test:e2e:report        # open the HTML report
```
If any test fails, fix that before exploratory QA.

## Exploratory checklist (do these as a browser agent)

### 1. Team members vs contributions confusion
- On a job, open **Team members** and **Contributions** in turn.
- Confirm they're clearly different: Team members = who's on the job; Contributions
  = a "who did what" log.
- Confirm you can **log a contribution without first adding that person as a team
  member** (the person dropdown lists everyone).
- Flag anything that implies you must add a team member before logging work.

### 2. Hunt for blank pages
- Click every nav item and every back button: Board ⇄ Clients, into a client, into
  a property, and back.
- Open and close each modal (New job, New client, Add property, job detail).
- Hard-refresh on each view (the app is a SPA — confirm no white screen).
- Flag any blank/white screen or spinner that never resolves.

### 3. Broken client/property/job combinations
- Create a property with **no client** (should be impossible — properties belong to
  a client).
- Create a job, pick a client, then check the **Property** dropdown only shows that
  client's properties.
- Change a job's client and confirm the property selection behaves sensibly.
- Create a client/job with empty/whitespace names, very long names, emoji, quotes —
  confirm graceful validation, no crash.

### 4. Use the app as each role
- **Admin:** can see/create/edit/archive everything.
- **Staff:** can create their own client/property/job; **cannot** see unrelated
  admin-only records; can see records linked to a job they can see.
- **Viewer:** no create/edit/archive/contribution actions anywhere; fields are
  read-only.
- Flag any control a role shouldn't have.

### 5. Silent failures
- Watch for actions that "succeed" in the UI but don't persist after refresh
  (create/edit/archive a client, property, job, contribution, then reload).
- Watch the browser console/network for failed requests (4xx/5xx) that the UI
  swallows without telling the user.
- Try to archive then confirm the record moves to the Archived view (not gone).
- Confirm there is **no** hard-delete control anywhere, and that "points/weight"
  appears nowhere on contributions.

### 6. Confirm production is untouched (read-only)
- Open `https://ruflo-35k.pages.dev` **without logging in changes** — just confirm
  it loads the v1 app and behaves normally.
- Confirm staging test data (e.g. "QA Client …") does **not** appear there.
- Do **not** create, edit, or delete anything on production.

## Reporting
For each issue: role, page, exact steps, what you expected, what happened, and a
screenshot. Group by severity (blocker / confusing / cosmetic). Anything touching
permissions or data persistence is a blocker.
