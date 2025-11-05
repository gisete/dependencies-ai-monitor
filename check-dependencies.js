const https = require("https");
const nodemailer = require("nodemailer");
const config = require("./config.json");

// GitHub API helper
async function githubRequest(path, token) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: "api.github.com",
			path: path,
			method: "GET",
			headers: {
				"User-Agent": "Dependency-Monitor",
				Authorization: `token ${token}`,
				Accept: "application/vnd.github.v3+json",
			},
		};

		https
			.get(options, (res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					if (res.statusCode === 200) {
						resolve(JSON.parse(data));
					} else {
						reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
					}
				});
			})
			.on("error", reject);
	});
}

// NPM Registry helper
async function getNpmPackageInfo(packageName) {
	return new Promise((resolve, reject) => {
		https
			.get(`https://registry.npmjs.org/${packageName}`, (res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					if (res.statusCode === 200) {
						const pkg = JSON.parse(data);
						resolve({
							latest: pkg["dist-tags"].latest,
							description: pkg.description,
							homepage: pkg.homepage,
						});
					} else {
						resolve(null);
					}
				});
			})
			.on("error", () => resolve(null));
	});
}

// Get package.json from repo
async function getPackageJson(repo, token) {
	try {
		const content = await githubRequest(`/repos/${repo}/contents/package.json`, token);
		const packageJson = JSON.parse(Buffer.from(content.content, "base64").toString());
		return packageJson;
	} catch (error) {
		console.log(`Could not fetch package.json for ${repo}: ${error.message}`);
		return null;
	}
}

// Check outdated packages
async function checkOutdatedPackages(packageJson, repoName) {
	const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
	const outdated = [];

	for (const [name, currentVersion] of Object.entries(dependencies)) {
		const cleanVersion = currentVersion.replace(/^[\^~]/, "");
		const info = await getNpmPackageInfo(name);

		if (info && info.latest !== cleanVersion) {
			outdated.push({
				package: name,
				current: currentVersion,
				latest: info.latest,
				description: info.description,
			});
		}
	}

	return {
		repo: repoName,
		outdated: outdated,
		totalDependencies: Object.keys(dependencies).length,
	};
}

// Call Claude API for analysis
async function analyzeWithClaude(results, apiKey) {
	const prompt = `You are a dependency management assistant. Analyze these npm package updates and categorize them by priority.

Here are the outdated packages across multiple projects:

${JSON.stringify(results, null, 2)}

Please provide:
1. CRITICAL updates (security vulnerabilities, major bugs that need immediate attention)
2. IMPORTANT updates (breaking changes, deprecated features, significant improvements)
3. LOW PRIORITY updates (minor patches, can wait)

For CRITICAL and IMPORTANT items, explain WHY they matter and what action should be taken.
Keep your response clear, actionable, and concise. Use a friendly but professional tone.`;

	return new Promise((resolve, reject) => {
		const data = JSON.stringify({
			model: "claude-sonnet-4-20250514",
			max_tokens: 2048,
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
		});

		const options = {
			hostname: "api.anthropic.com",
			path: "/v1/messages",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Length": data.length,
			},
		};

		const req = https.request(options, (res) => {
			let responseData = "";
			res.on("data", (chunk) => (responseData += chunk));
			res.on("end", () => {
				if (res.statusCode === 200) {
					const response = JSON.parse(responseData);
					resolve(response.content[0].text);
				} else {
					reject(new Error(`Claude API error: ${res.statusCode} - ${responseData}`));
				}
			});
		});

		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

// Send email via Gmail
async function sendEmail(analysis, results, gmailUser, gmailPassword, recipient) {
	const transporter = nodemailer.createTransport({
		service: "gmail",
		auth: {
			user: gmailUser,
			pass: gmailPassword,
		},
	});

	const totalOutdated = results.reduce((sum, r) => sum + r.outdated.length, 0);

	const mailOptions = {
		from: gmailUser,
		to: recipient,
		subject: `🔔 Dependency Update Report - ${totalOutdated} packages need attention`,
		html: `
      <h2>Monthly Dependency Update Report</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <p><strong>Total outdated packages:</strong> ${totalOutdated}</p>
      
      <hr>
      
      <h3>📊 AI Analysis</h3>
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; font-family: monospace;">
${analysis}
      </div>
      
      <hr>
      
      <h3>📦 Detailed Package List</h3>
      ${results
				.map(
					(r) => `
        <h4>${r.repo}</h4>
        <ul>
          ${r.outdated
						.map(
							(pkg) => `
            <li>
              <strong>${pkg.package}</strong>: ${pkg.current} → ${pkg.latest}
              ${pkg.description ? `<br><small>${pkg.description}</small>` : ""}
            </li>
          `
						)
						.join("")}
        </ul>
      `
				)
				.join("")}
      
      <hr>
      <p><small>This is an automated report from your AI Dependency Monitor</small></p>
    `,
	};

	await transporter.sendMail(mailOptions);
}

// Main execution
async function main() {
	const githubToken = process.env.GH_TOKEN;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	const gmailUser = process.env.GMAIL_USER;
	const gmailPassword = process.env.GMAIL_APP_PASSWORD;
	const recipient = process.env.RECIPIENT_EMAIL;

	// Debug: Check if credentials are loaded
	console.log("🔍 Checking environment variables...");
	console.log("GH_TOKEN present:", !!githubToken, githubToken ? `(${githubToken.substring(0, 7)}...)` : "(missing)");
	console.log("ANTHROPIC_API_KEY present:", !!anthropicKey);
	console.log("GMAIL_USER present:", !!gmailUser, gmailUser || "(missing)");
	console.log("GMAIL_APP_PASSWORD present:", !!gmailPassword);
	console.log("RECIPIENT_EMAIL present:", !!recipient, recipient || "(missing)");

	if (!githubToken) {
		console.error("❌ GH_TOKEN is not set! Check your GitHub secrets.");
		process.exit(1);
	}

	console.log("🚀 Starting dependency check...");

	const results = [];

	for (const repo of config.repos) {
		console.log(`📦 Checking ${repo}...`);
		const packageJson = await getPackageJson(repo, githubToken);

		if (packageJson) {
			const outdated = await checkOutdatedPackages(packageJson, repo);
			results.push(outdated);
			console.log(`   Found ${outdated.outdated.length} outdated packages`);
		}
	}

	const totalOutdated = results.reduce((sum, r) => sum + r.outdated.length, 0);

	if (totalOutdated === 0) {
		console.log("✅ All dependencies are up to date!");

		// Send a brief "all good" email
		const transporter = nodemailer.createTransport({
			service: "gmail",
			auth: { user: gmailUser, pass: gmailPassword },
		});

		await transporter.sendMail({
			from: gmailUser,
			to: recipient,
			subject: "✅ Dependency Check: All Up To Date",
			text: `Good news! All your projects have up-to-date dependencies.\n\nChecked on: ${new Date().toLocaleDateString()}`,
		});

		return;
	}

	console.log(`🤖 Analyzing ${totalOutdated} outdated packages with Claude...`);
	const analysis = await analyzeWithClaude(results, anthropicKey);

	console.log("📧 Sending email report...");
	await sendEmail(analysis, results, gmailUser, gmailPassword, recipient);

	console.log("✅ Done! Email sent successfully.");
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
