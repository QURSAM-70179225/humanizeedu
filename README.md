# HumanizeEdu AI

A free, no-login AI text humanizer for students. Visitors paste text and get:

- an **AI-generated %** and a **plagiarism-risk %**, both before and after
- a natural rewrite from **Groq** (`llama-3.3-70b-versatile`), with quotes and citations locked in place
- a diagnostic report: AI buzzwords, sentences that look borrowed, citation fixes (APA/MLA/Chicago/IEEE), readability and tone metrics

There's no login and no database, and nothing users paste is stored. Each visitor is limited to 30 checks per hour so nobody can use up your Groq quota.

> **About the percentages:** both are estimates the site calculates from writing patterns. The AI score looks at buzzwords, repetitive rhythm and stock transitions. The plagiarism risk looks at uncited quotes, uncited facts and definitions, and generic phrasing. They are **not** Turnitin, GPTZero or Copyleaks results, and the plagiarism figure doesn't compare text against the web or other papers. The site says this clearly on the results.

## Project layout

```
server.js            static pages + /api/humanize + /api/config, rate limit, security headers
lib/analyzer.js      AI %, plagiarism-risk %, diagnostics, offline humanizer
lib/ai.js            Groq → Gemini → offline rewriting
public/              homepage (with the tool), privacy page, CSS, JS
test/smoke.js        end-to-end test (npm test)
render.yaml          one-click free deploy on Render
deploy/setup-vm.sh   one-command deploy on a Google Cloud VM
Dockerfile           container for Google Cloud Run
```

## Run it in VS Code

Needs **Node.js 22.9+** (https://nodejs.org).

```bash
copy .env.example .env      # Mac/Linux: cp .env.example .env
# open .env and paste your key after GROQ_API_KEY=
npm start                   # → http://localhost:8080
npm test                    # automatic tests
```

Get a free Groq key at https://console.groq.com/keys. Never commit `.env` or share the key.

## Deploy free on Render (recommended, no card needed)

1. **Put the code on GitHub.** Create a new repo, e.g. `humanizeedu`, then in VS Code's terminal:
   ```bash
   git init
   git add .
   git commit -m "HumanizeEdu AI"
   git branch -M main
   git remote add origin https://github.com/<your-username>/humanizeedu.git
   git push -u origin main
   ```
   `.env` is in `.gitignore`, so your key is **not** uploaded.
2. Go to https://render.com and sign up with GitHub.
3. Click **New → Blueprint** and pick the `humanizeedu` repo. Render reads `render.yaml` automatically.
4. When it asks for **GROQ_API_KEY**, paste your key, then click **Apply**.
5. After about 2 minutes your site is live at `https://humanizeedu.onrender.com` (or a similar address).

Things to know about Render's free plan:
- The site sleeps after 15 minutes with no visitors. The next visitor waits about a minute while it wakes up.
- Every `git push` redeploys the site automatically.
- To use your own domain, go to the service's **Settings → Custom Domains**.

## Other deploy options

- **Google Cloud VM** (always on, needs a billing card): create an e2-micro Ubuntu 24.04 VM with HTTP and HTTPS allowed. Upload the zip in the SSH window, then run `unzip -o humanizeedu.zip && cd humanizeedu && sudo bash deploy/setup-vm.sh`.
- **Google Cloud Run:**
  ```bash
  gcloud run deploy humanizeedu --source . --region us-central1 --allow-unauthenticated \
    --set-env-vars NODE_ENV=production,GROQ_API_KEY=YOUR_KEY
  ```
  With no database, Cloud Run now works fully.

## Show up on Google Search

1. Add your site at https://search.google.com/search-console and verify it. On Render, use the **HTML tag** method: put the `<meta>` tag it gives you into the `<head>` of `public/index.html`, then push.
2. Under **Sitemaps**, submit `https://your-site/sitemap.xml`.
3. Use **URL Inspection → Request indexing** on your homepage.

## Academic honesty

This tool is for polishing writing the student wrote themselves. It never changes facts, quotes or citations. It flags uncited material, and the UI is clear that its percentages are estimates.
