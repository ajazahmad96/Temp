# Ajaz Edits — portfolio website with a built-in admin panel

The original static website (plain HTML, CSS and vanilla JavaScript) with a **backendless CMS** added.
You edit content from your phone or laptop; the admin panel saves it to **JSON files in this GitHub repository**
through a secure Vercel serverless API; Vercel then redeploys the site automatically.

No database. No framework. The public site looks and behaves exactly as before.

```
index.html              page (content areas are filled from data/*.json)
css/styles.css          original styles (+ small additions for new sections)
css/admin.css           admin panel styles (loaded only when the admin opens)
js/main.js              original site behaviour, now data-driven
js/render.js            turns the JSON into the page markup
js/shared.js            YouTube URL parsing/validation (used by browser AND server)
js/admin.js             admin panel UI (loaded only when the footer gear is tapped)
data/*.json             ALL editable content (projects, about, experience, clients, services, testimonials)
assets/uploads/         images uploaded through the admin panel
api/login.js            POST  verify password, set signed session cookie
api/logout.js           POST  clear session
api/session.js          GET   is the current session valid?
api/content.js          GET/PUT read content from GitHub / validate + commit changes
api/upload.js           POST  validate + commit an uploaded image
api/_lib/               config, auth/sessions/rate-limit, GitHub client, validators (not public routes)
vercel.json             security headers + function config
tests/                  automated tests (not deployed, see "Testing")
```

---

## 1. How it works

1. Visitors load `index.html`; `js/main.js` fetches `data/*.json` and renders everything.
2. You tap the small **gear icon in the footer** and enter the admin password.
3. The password is checked **on the server** (`/api/login`). On success the server sets a signed, expiring,
   `HttpOnly` + `SameSite=Strict` (+ `Secure` on HTTPS) cookie. JavaScript can never read it.
4. You edit content in the dashboard. Edits stay in a **draft** in your browser. Nothing touches GitHub yet.
5. **Preview** shows your draft on the real website page (nothing is saved anywhere).
6. **Publish** sends the draft to `/api/content`. The server re-checks your session, validates every field again,
   compares the file's GitHub SHA (conflict protection) and commits the JSON file with a meaningful message such as
   `Admin: update projects - added "New Reel"; removed "Old Video"`.
7. The GitHub → Vercel integration sees the new commit and deploys the site automatically.

The panel is deliberately honest about status. It shows **"Changes committed to GitHub"** as soon as GitHub accepts
the commit, and only shows **"Deployment completed"** after it has seen the new content actually served from your live site.

---

## 2. Environment Variables guide

Set these in **Vercel → your project → Settings → Environment Variables**. Never put them in any file in the repository.
`.env.example` lists the names only, with placeholders.

| Variable | Required | What it does | Where to get it |
|---|---|---|---|
| `ADMIN_PASSWORD` | **Required** | The password you type to open the admin panel. Checked on the server only. | You choose it. Make it long and unique (a password-manager-generated one is ideal). |
| `SESSION_SECRET` | **Required** | Secret key used to sign admin session cookies. Must be **at least 32 characters**. Changing it logs everyone out. | Generate random text: `openssl rand -base64 48`, or `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, or your password manager's generator (32+ random characters). |
| `GITHUB_TOKEN` | **Required** | Fine-grained GitHub token the server uses to read/commit the JSON files. Never sent to the browser. | GitHub, see "Create the GitHub token" below. |
| `GITHUB_OWNER` | **Required** | GitHub username (or organisation) that owns the repository. For `github.com/ajaz/ajazedits` it is `ajaz`. | The first part of your repository URL. |
| `GITHUB_REPO` | **Required** | Repository name only (not the full URL). For `github.com/ajaz/ajazedits` it is `ajazedits`. | The second part of your repository URL. |
| `GITHUB_BRANCH` | Optional (default `main`) | Branch to read from and commit to. **Must be the branch Vercel deploys to production.** | GitHub → repository → branch dropdown. Set it only if your production branch is not `main`. |

**How to add them in Vercel:** Project → **Settings** → **Environment Variables** → enter *Key* and *Value* → tick **Production**
(tick Preview/Development only if you understand that preview deployments would then write to the same branch) → **Save**.
Repeat for each variable. Environment variable changes apply only to **new** deployments, so afterwards go to
**Deployments → ⋯ on the latest → Redeploy**.

No other variables are used.

### Create the GitHub token (minimum permissions)

1. GitHub → profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name:** `ajaz-edits-admin`. **Expiration:** choose a period (e.g. 90 days). Set a reminder: when it expires, publishing stops until you create a new token and update `GITHUB_TOKEN` in Vercel.
3. **Resource owner:** the account that owns the repository.
4. **Repository access:** **Only select repositories** → choose *only* this website's repository.
5. **Permissions → Repository permissions → Contents: Read and write.** Leave everything else at "No access"
   (GitHub adds *Metadata: Read-only* automatically; that is fine).
6. **Generate token**, copy it once (it starts with `github_pat_`) and paste it straight into Vercel as `GITHUB_TOKEN`.
   Do not paste it into chat, code or any file.

Create the token from the **same GitHub account that is connected to Vercel**. Vercel can refuse to deploy commits authored by
someone who isn't a member of your Vercel account/team (this mostly matters on the free Hobby plan).

---

## 3. Deploying to Vercel

**Connect GitHub to Vercel (one time)**

1. Push this project to your GitHub repository (replace the old files with these).
2. Vercel → **Add New… → Project** → **Import Git Repository** → authorise the Vercel GitHub app → select the repository.
   (If it is already imported, skip this: your existing project keeps working.)
3. **Framework Preset: Other.** Leave **Build Command** and **Output Directory** empty and **Root Directory** as `./`.
4. Add the environment variables from section 2, then **Deploy**.
5. Check **Settings → Git**: the **Production Branch** must equal `GITHUB_BRANCH` (default `main`).

**Make sure auto-deploy works.** Every push to the production branch should create a new deployment under
**Deployments**. To test: edit any file on GitHub (or publish from the admin panel) and watch a deployment appear.
If nothing appears, check Vercel → Settings → Git (repository connected? "Ignored Build Step" empty?) and that the Vercel GitHub app
has access to the repository (GitHub → Settings → Applications → Vercel → Configure).

**First login:** open your site, tap the gear in the footer, enter `ADMIN_PASSWORD`.
If you see *"The server is not fully configured"*, a required variable is missing/invalid
(or you forgot to redeploy after adding them). The exact reason is written to the function logs
(Vercel → Deployments → Logs) and never includes secret values.

---

## 4. Using the admin panel (also on Android)

* **Dashboard** shows counts and any unpublished changes.
* **Projects:** *Add project* → paste a YouTube link (watch, youtu.be, shorts or embed links work). The ID is extracted automatically,
  the embed URL is generated, and you see an embedded preview before saving. Choose **Short Form** or **Long Form**; the project
  appears in that tab on the public site. Optional custom thumbnail (https link, or upload from your phone; it is resized for you).
  Without one, the YouTube thumbnail is used. Use the arrows to reorder.
* **About & Info:** introduction, professional title, about text, contact details and links, stats bar, section headings, footer text.
* **Experience / Clients:** add, edit, delete. These sections are **hidden on the public site until you add at least one entry.**
* **Services:** title, description and an icon picked from a grid.
* **Testimonials:** name, role, text. The existing slider keeps working (it hides itself if there are none).
* Every change is a **draft** until you press **Publish**. **Preview** shows what visitors would see; **Discard** drops the draft.
* Deletions always ask for confirmation.
* If the same content was changed on GitHub meanwhile, you get a **conflict** message and choose *Load latest* or *Overwrite with my version*.
  Nothing is ever overwritten silently.
* If your session expires mid-edit you are asked to log in again and your draft is kept.

---

## 5. Security summary

* Password and secrets exist **only** as Vercel environment variables. They are not in the repository, HTML, CSS or frontend JS.
* Password compared in constant time; failed logins are delayed and **rate-limited** (5 failures / 15 min per IP, plus a global cap).
* Session = HMAC-SHA256-signed token, **8-hour absolute expiry**, bound to the current password (changing `ADMIN_PASSWORD` or `SESSION_SECRET` invalidates all sessions).
  Cookie is `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS.
* **Every** write endpoint (`content` PUT, `upload`) requires a valid session **on the server**, plus a same-origin check and custom header (CSRF defence).
* All incoming data is validated and rebuilt field by field on the server (unknown keys dropped, lengths limited, YouTube URLs re-parsed, image references restricted
  to https links or `assets/uploads/…`, icons restricted to Font Awesome class names). Only the six known data files can be written.
* Uploaded images are identified from their bytes (PNG/JPEG/WebP/GIF only; SVG rejected), size-limited, and stored under a server-generated file name.
* Content is rendered with `textContent` (never `innerHTML`), so edited text cannot inject HTML/JS into the site.
* Security headers in `vercel.json`: Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy. API responses are `no-store`.
* `GITHUB_TOKEN` is used only inside `api/_lib/github.js` and is never included in any response (covered by automated tests).

---

## 6. Testing

```bash
npm test            # 77 API / validation / YouTube tests (Node 18+, no dependencies)
npm run check       # static checks: JS syntax, JSON, HTML balance and references, CSS, secrets scan
npm run test:e2e    # real-browser end-to-end test (requires Playwright + Chromium)
```

The API tests and the browser test run the real `api/*.js` handlers against an **in-memory fake of the GitHub Contents API**
(it enforces SHA matching like GitHub does). They do not contact GitHub or Vercel. `tests/` is excluded from deployment by `.vercelignore`.

To try everything against your real repository before relying on it, use `npx vercel dev` with a `.env.local` copied from `.env.example`
(real values, never committed; `.gitignore` already excludes it).

---

## 7. Troubleshooting

| Message | Meaning / fix |
|---|---|
| *The server is not fully configured* | A required environment variable is missing/invalid, or you did not redeploy after adding them. |
| *GitHub rejected the access token* | `GITHUB_TOKEN` is wrong or expired. Create a new token, update it in Vercel, redeploy. |
| *The GitHub token does not have permission* | The token lacks **Contents: Read and write**, or is not scoped to this repository. |
| *GitHub repository not found* / *Branch … not found* | Check `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, and that the token can access that repository. |
| *Too many failed attempts* | Login rate limit; wait the stated minutes. |
| Committed, but "deployment not detected" | Vercel may still be building (check Deployments) or the build may have failed. |

---

## 8. Known limitations

* **Rate limiting is in-memory per serverless instance** (no database by design). It stops casual brute force but is not a global guarantee. Use a long password.
* **Sessions are stateless.** *Log out* clears the cookie, but a copied token stays valid until it expires (max 8 h). Changing `SESSION_SECRET` or `ADMIN_PASSWORD` revokes every session immediately.
* Publishing several sections makes one commit per section, so Vercel may start several deployments in a row (the last one wins).
* "Deployment completed" is inferred by comparing your live JSON with what was committed (checked for about 4 minutes). It is reliable for content changes but is not an official Vercel build status.
* Uploaded images are committed into the repository (max 2.5 MB each, auto-resized in the browser), so the repository grows with use.
* Content is rendered by JavaScript. Search engines run it, but the page `<title>`, meta description and JSON-LD in `index.html` stay static.
* Opening `index.html` directly from disk (`file://`) no longer works, because browsers block `fetch()` of the JSON files. Use `npx vercel dev` or any static server.
* The stats bar is fixed at 4 items and Services are limited to 24 (layout reasons).
* `a.png` (9 MB) is the favicon and profile photo and was left untouched. Compressing it would noticeably speed up the site.
