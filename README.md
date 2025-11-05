# 🤖 AI Dependency Monitor

Automatically checks your npm projects for outdated packages, analyzes them with Claude AI, and emails you a prioritized report of what needs attention.

## 🎯 What It Does

- Runs **monthly** (1st of each month at 9 AM UTC)
- Checks all configured repos for outdated npm packages
- Uses **Claude AI** to categorize updates as CRITICAL, IMPORTANT, or LOW PRIORITY
- Emails you a digestible summary with actionable recommendations
- Can be triggered manually from GitHub UI

## 📋 Setup Instructions

### 1. Create the GitHub Repository

1. Go to GitHub and create a new repository called `dependencies-ai-monitor`
2. Clone it to your local machine
3. Copy all files from this folder into your new repo

### 2. Update Configuration

Edit `config.json` and replace `your-github-username` with your actual GitHub username:

```json
{
	"repos": [
		"yourusername/sope-website",
		"yourusername/laara-app",
		"yourusername/horta-edge-functions",
		"yourusername/farm-store"
	],
	"checkSchedule": "monthly",
	"notificationEmail": "gisete@gmail.com"
}
```

### 3. Set Up GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these 5 secrets:

#### `GITHUB_PAT` (GitHub Personal Access Token)

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Give it a name like "Dependency Monitor"
4. Check the `repo` scope (this gives full access to your repositories)
5. Click **Generate token**
6. Copy the token and add it as the secret value

#### `ANTHROPIC_API_KEY`

1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key
3. Copy it and add as the secret value

#### `GMAIL_USER`

Your Gmail address: `gisete@gmail.com`

#### `GMAIL_APP_PASSWORD`

1. Go to your Google Account settings
2. Enable 2-Factor Authentication (required)
3. Go to **Security** → **2-Step Verification** → **App passwords**
4. Generate an app password for "Mail"
5. Copy the 16-character password (ignore spaces)
6. Add it as the secret value

#### `RECIPIENT_EMAIL`

The email where you want to receive reports: `gisete@gmail.com`

(You can use a different email here if you want reports sent elsewhere)

### 4. Push to GitHub

```bash
git add .
git commit -m "Initial setup of AI dependency monitor"
git push origin main
```

### 5. Test It!

Don't wait for the monthly schedule - test it now:

1. Go to your repo on GitHub
2. Click **Actions** tab
3. Click **AI Dependency Monitor** workflow
4. Click **Run workflow** button
5. Watch it run!

You should receive an email within a few minutes.

## 📧 Email Notifications

### If packages need updating:

You'll get an email with:

- AI analysis categorizing updates by priority
- Explanation of WHY critical/important updates matter
- Full list of all outdated packages

### If everything is up to date:

You'll get a short "all good" email confirmation.

## 🔧 Customization

### Change the schedule

Edit `.github/workflows/dependency-check.yml`:

```yaml
schedule:
  - cron: "0 9 1 * *" # Monthly on the 1st
  # - cron: '0 9 * * 1'  # Weekly on Mondays
  # - cron: '0 9 1 */3 *'  # Every 3 months
```

### Add/remove repos

Edit `config.json` and add or remove repos from the list.

### Change Claude model

Edit `check-dependencies.js`, find this line:

```javascript
model: 'claude-sonnet-4-20250514',
```

Change to:

- `claude-sonnet-4-20250514` (balanced - recommended)
- `claude-opus-4-20250514` (more detailed but costs more)

## 💰 Cost Estimate

With 4 repos checked monthly:

- **~$0.07/month** (~7 cents)
- **~$0.84/year**

Even checking weekly: **~$3-4/year**

## 🔒 Security Notes

- Never commit API keys or passwords to the repo
- All sensitive data is stored in GitHub Secrets (encrypted)
- The workflow only has access to repos you specified
- Emails are sent via Gmail's secure SMTP

## 🐛 Troubleshooting

### Workflow fails with "401 Unauthorized"

- Check that your `GITHUB_PAT` has the `repo` scope
- Make sure the token hasn't expired

### No email received

- Check spam folder
- Verify `GMAIL_APP_PASSWORD` is correct (16 characters, no spaces)
- Make sure 2FA is enabled on your Google account

### "Could not fetch package.json"

- Verify repo names in `config.json` are correct
- Make sure repos actually have a `package.json` file
- Check that your GitHub token has access to those repos

## 📝 Notes

- Proton email was requested but requires paid Proton Bridge for SMTP. Gmail is used instead.
- The script only checks npm packages (package.json). For other package managers, modifications would be needed.
- Workflow logs are available in the Actions tab for debugging.

## 🚀 Future Improvements

Ideas for enhancements:

- Support for multiple package managers (pip, composer, etc.)
- Slack/Discord notifications instead of email
- Auto-create PRs for safe updates
- Integration with security vulnerability databases
- Web dashboard to view history

---

**Questions?** Check the GitHub Actions logs or review the troubleshooting section above.
