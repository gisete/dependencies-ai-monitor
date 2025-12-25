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
					} else if (res.statusCode === 404) {
						resolve(null); // Not found is ok for some endpoints
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

// Get security vulnerabilities from GitHub Dependabot
async function getSecurityAlerts(repo, token) {
	try {
		// Use Dependabot alerts API
		const alerts = await githubRequest(
			`/repos/${repo}/dependabot/alerts?state=open&per_page=100`,
			token
		);
		
		if (!alerts) return [];
		
		return alerts.map(alert => ({
			package: alert.security_vulnerability.package.name,
			severity: alert.security_advisory.severity, // critical, high, medium, low
			summary: alert.security_advisory.summary,
			description: alert.security_advisory.description,
			cve: alert.security_advisory.cve_id,
			vulnerableVersionRange: alert.security_vulnerability.vulnerable_version_range,
			firstPatchedVersion: alert.security_vulnerability.first_patched_version?.identifier,
			ghsaId: alert.security_advisory.ghsa_id,
			url: alert.html_url
		}));
	} catch (error) {
		console.log(`Could not fetch security alerts for ${repo}: ${error.message}`);
		return [];
	}
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
	// Build a detailed prompt that includes both outdated packages and security vulnerabilities
	let prompt = `You are a security-focused dependency management assistant. Analyze these npm package updates and security vulnerabilities, then categorize them by priority.

SECURITY VULNERABILITIES:
${results.map(r => {
	if (r.securityAlerts.length === 0) {
		return `\n${r.repo}: No open security alerts`;
	}
	return `\n${r.repo}:\n${r.securityAlerts.map(alert => 
		`  - ${alert.package} (${alert.severity.toUpperCase()}): ${alert.summary}
    CVE: ${alert.cve || 'N/A'}
    Vulnerable: ${alert.vulnerableVersionRange}
    Fix available: ${alert.firstPatchedVersion || 'See details'}
    URL: ${alert.url}`
	).join('\n')}`;
}).join('\n')}

OUTDATED PACKAGES:
${results.map(r => `\n${r.repo}: ${r.outdated.length} outdated packages
${r.outdated.slice(0, 10).map(pkg => `  - ${pkg.package}: ${pkg.current} → ${pkg.latest}`).join('\n')}${r.outdated.length > 10 ? `\n  ... and ${r.outdated.length - 10} more` : ''}`).join('\n')}

Please organize your response like this:

🚨 CRITICAL SECURITY ISSUES (if any)
List all critical and high severity vulnerabilities first. For each:
- Package name and severity
- What the vulnerability is
- Immediate action needed (update to version X, apply patch, etc.)

⚠️ IMPORTANT UPDATES
- Breaking changes or significant updates needed
- Medium/low security issues
- Deprecated features

✅ LOW PRIORITY
- Minor patches and updates that can wait

Keep explanations clear and actionable. Focus on security first, then functionality.`;

	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({
			model: "claude-sonnet-4-20250514",
			max_tokens: 4096,
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
			},
		};

		const req = https.request(options, (res) => {
			let data = "";
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => {
				if (res.statusCode === 200) {
					const response = JSON.parse(data);
					resolve(response.content[0].text);
				} else {
					reject(new Error(`Claude API error: ${res.statusCode} - ${data}`));
				}
			});
		});

		req.on("error", reject);
		req.write(payload);
		req.end();
	});
}

// Send email with results
async function sendEmail(analysis, results, gmailUser, gmailPassword, recipient) {
	const transporter = nodemailer.createTransport({
		service: "gmail",
		auth: {
			user: gmailUser,
			pass: gmailPassword,
		},
	});

	// Check if there are any critical/high security issues
	const criticalSecurityIssues = results.flatMap(r => 
		r.securityAlerts.filter(a => a.severity === 'critical' || a.severity === 'high')
	);
	
	const totalVulnerabilities = results.reduce((sum, r) => sum + r.securityAlerts.length, 0);
	const totalOutdated = results.reduce((sum, r) => sum + r.outdated.length, 0);

	// Set subject based on security issues
	let subject = "📦 Monthly Dependency Report";
	if (criticalSecurityIssues.length > 0) {
		subject = `🚨 SECURITY ALERT: ${criticalSecurityIssues.length} Critical Vulnerabilities`;
	} else if (totalVulnerabilities > 0) {
		subject = `⚠️ Security Update: ${totalVulnerabilities} Vulnerabilities Found`;
	} else if (totalOutdated > 0) {
		subject = `📦 ${totalOutdated} Package Updates Available`;
	}

	const mailOptions = {
		from: gmailUser,
		to: recipient,
		subject: subject,
		html: `
      <h2>🤖 AI Dependency Analysis Report</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      
      <h3>📊 Summary</h3>
      <ul>
        <li>🔒 Security Vulnerabilities: ${totalVulnerabilities} (${criticalSecurityIssues.length} critical/high)</li>
        <li>📦 Outdated Packages: ${totalOutdated}</li>
        <li>📁 Repositories Checked: ${results.length}</li>
      </ul>

      ${criticalSecurityIssues.length > 0 ? `
      <div style="background-color: #fff3cd; border-left: 4px solid #ff0000; padding: 15px; margin: 20px 0;">
        <h3 style="color: #dc3545; margin-top: 0;">⚠️ CRITICAL SECURITY ISSUES REQUIRE IMMEDIATE ATTENTION</h3>
        <ul>
          ${criticalSecurityIssues.map(alert => `
            <li>
              <strong>${alert.package}</strong> (${alert.severity.toUpperCase()})
              <br>${alert.summary}
              <br><a href="${alert.url}">View details on GitHub</a>
            </li>
          `).join('')}
        </ul>
      </div>
      ` : ''}

      <h3>🤖 Claude's Analysis</h3>
      <div style="white-space: pre-wrap; font-family: system-ui, -apple-system, sans-serif; line-height: 1.6;">
        ${analysis.replace(/\n/g, '<br>')}
      </div>

      <hr>
      
      <h3>📋 Detailed Breakdown</h3>
      ${results
				.map(
					(result) => `
        <h4>📁 ${result.repo}</h4>
        
        ${result.securityAlerts.length > 0 ? `
        <strong>🔒 Security Alerts (${result.securityAlerts.length}):</strong>
        <ul>
          ${result.securityAlerts.map(alert => `
            <li>
              <span style="background: ${
								alert.severity === 'critical' ? '#dc3545' : 
								alert.severity === 'high' ? '#fd7e14' :
								alert.severity === 'medium' ? '#ffc107' : '#6c757d'
							}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 0.85em;">
                ${alert.severity.toUpperCase()}
              </span>
              <strong>${alert.package}</strong>
              <br>${alert.summary}
              ${alert.firstPatchedVersion ? `<br>Update to: ${alert.firstPatchedVersion}` : ''}
              <br><a href="${alert.url}">View on GitHub</a>
            </li>
          `).join('')}
        </ul>
        ` : '<p style="color: #28a745;">✅ No security vulnerabilities detected</p>'}
        
        ${result.outdated.length > 0 ? `
        <strong>📦 Outdated Packages (${result.outdated.length}):</strong>
        <ul>
          ${result.outdated
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
        ` : ''}
      `
				)
				.join("")}
      
      <hr>
      <p><small>This is an automated report from your AI Dependency Monitor • Generated with Claude API</small></p>
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

	console.log('🔍 Checking environment variables...');
	console.log('GH_TOKEN present:', !!githubToken, githubToken ? `(${githubToken.substring(0, 7)}...)` : '(missing)');
	console.log('ANTHROPIC_API_KEY present:', !!anthropicKey);
	console.log('GMAIL_USER present:', !!gmailUser, gmailUser || '(missing)');
	console.log('GMAIL_APP_PASSWORD present:', !!gmailPassword);
	console.log('RECIPIENT_EMAIL present:', !!recipient, recipient || '(missing)');

	if (!githubToken) {
		console.error('❌ GH_TOKEN is not set! Check your GitHub secrets.');
		process.exit(1);
	}

	console.log('🚀 Starting dependency and security check...');

	const results = [];

	for (const repo of config.repos) {
		console.log(`📦 Checking ${repo}...`);
		
		// Get package.json
		const packageJson = await getPackageJson(repo, githubToken);
		
		// Get security alerts
		console.log(`🔒 Checking security alerts for ${repo}...`);
		const securityAlerts = await getSecurityAlerts(repo, githubToken);
		console.log(`   Found ${securityAlerts.length} security alerts`);

		if (packageJson) {
			const outdated = await checkOutdatedPackages(packageJson, repo);
			console.log(`   Found ${outdated.outdated.length} outdated packages`);
			
			results.push({
				...outdated,
				securityAlerts: securityAlerts
			});
		} else {
			// Still add security alerts even if we couldn't get package.json
			results.push({
				repo: repo,
				outdated: [],
				totalDependencies: 0,
				securityAlerts: securityAlerts
			});
		}
	}

	const totalVulnerabilities = results.reduce((sum, r) => sum + r.securityAlerts.length, 0);
	const totalOutdated = results.reduce((sum, r) => sum + r.outdated.length, 0);
	const criticalCount = results.flatMap(r => r.securityAlerts).filter(a => 
		a.severity === 'critical' || a.severity === 'high'
	).length;

	console.log(`\n📊 Summary:`);
	console.log(`   🔒 Security vulnerabilities: ${totalVulnerabilities} (${criticalCount} critical/high)`);
	console.log(`   📦 Outdated packages: ${totalOutdated}`);

	if (totalVulnerabilities === 0 && totalOutdated === 0) {
		console.log("✅ All dependencies are up to date and secure!");

		const transporter = nodemailer.createTransport({
			service: "gmail",
			auth: { user: gmailUser, pass: gmailPassword },
		});

		await transporter.sendMail({
			from: gmailUser,
			to: recipient,
			subject: "✅ Dependency Check: All Secure & Up To Date",
			text: `Good news! All your projects have up-to-date dependencies with no security vulnerabilities.\n\nChecked on: ${new Date().toLocaleDateString()}`,
		});

		return;
	}

	console.log(`🤖 Analyzing with Claude...`);
	const analysis = await analyzeWithClaude(results, anthropicKey);

	console.log("📧 Sending email report...");
	await sendEmail(analysis, results, gmailUser, gmailPassword, recipient);

	console.log("✅ Done! Email sent successfully.");
}

main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});
