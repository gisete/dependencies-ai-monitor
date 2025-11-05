# Setup Checklist

Use this to track your setup progress:

## ✅ Local Setup
- [ ] Create new GitHub repo called `dependencies-ai-monitor`
- [ ] Clone the repo locally
- [ ] Copy all files into the repo
- [ ] Edit `config.json` and replace `your-github-username` with your actual username
- [ ] Commit and push to GitHub

## ✅ Get API Keys & Credentials

### GitHub Personal Access Token
- [ ] Go to https://github.com/settings/tokens
- [ ] Click "Generate new token (classic)"
- [ ] Name it "Dependency Monitor"
- [ ] Check the `repo` scope
- [ ] Generate and copy the token

### Claude API Key
- [ ] Go to https://console.anthropic.com/settings/keys
- [ ] Create new API key
- [ ] Set spending limit to $2/month (Settings → Billing)
- [ ] Copy the key

### Gmail App Password
- [ ] Enable 2FA on Google Account (if not already)
- [ ] Go to Google Account → Security → 2-Step Verification → App passwords
- [ ] Generate app password for Mail
- [ ] Copy the 16-character password

## ✅ Add GitHub Secrets
Go to your repo → Settings → Secrets and variables → Actions

- [ ] Add `GITHUB_PAT` (your GitHub token)
- [ ] Add `ANTHROPIC_API_KEY` (your Claude API key)
- [ ] Add `GMAIL_USER` (gisete@gmail.com)
- [ ] Add `GMAIL_APP_PASSWORD` (16-char password from Google)
- [ ] Add `RECIPIENT_EMAIL` (gisete@gmail.com)

## ✅ Test It
- [ ] Go to Actions tab in your GitHub repo
- [ ] Click "AI Dependency Monitor" workflow
- [ ] Click "Run workflow"
- [ ] Wait for email (check spam folder too!)

## 🎉 Done!
Your monitor will now run automatically on the 1st of every month.

---

## Quick Reference

**Schedule:** Monthly on the 1st at 9 AM UTC
**Repos monitored:** 4 (sope-website, laara-app, horta-edge-functions, farm-store)
**Email:** gisete@gmail.com
**Estimated cost:** ~$0.07/month (~7 cents)

**Manual trigger:** Go to Actions → AI Dependency Monitor → Run workflow
