/**
 * C2 Remote Login Helper
 * Runs locally on your machine to authenticate a TikTok account and upload session cookies to a remote C2 server.
 * 
 * Usage:
 *   1. Install Playwright:
 *      npm install playwright
 *   2. Run the script:
 *      node remote-login.js <C2_REMOTE_URL> <ACCOUNT_ID>
 * 
 * Example:
 *      node remote-login.js http://123.45.67.89:4000 81181010-7ed7-46f3-a86a-c266c8c0d6f8
 */

import { chromium } from 'playwright';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('\n❌ Error: Missing arguments.');
    console.log('Usage: node remote-login.js <C2_REMOTE_URL> <ACCOUNT_ID>');
    console.log('Example: node remote-login.js http://my-c2-server.com:4000 81181010-7ed7-46f3-a86a-c266c8c0d6f8\n');
    process.exit(1);
  }

  const remoteUrl = args[0].replace(/\/$/, ''); // strip trailing slash
  const accountId = args[1];

  console.log(`\n🚀 Launching local browser for login...`);
  console.log(`🔗 Remote C2 Server: ${remoteUrl}`);
  console.log(`👤 Target Account ID: ${accountId}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('👉 Navigating to TikTok Login. Please scan the QR code or enter credentials.');
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  console.log('⏳ Waiting for you to complete login...');

  // Poll page state until we detect the user has logged in
  let loggedIn = false;
  while (!loggedIn) {
    try {
      loggedIn = await page.evaluate(() => {
        // Look for sessionid cookie or profile icon to signify a successful login
        return document.cookie.includes('sessionid') || 
               document.querySelector('[data-e2e="profile-icon"]') !== null;
      });
    } catch (err) {
      // Ignore evaluation errors if the page is navigating
    }

    if (!loggedIn) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  console.log('\n✅ Login detected! Capturing session cookies...');
  
  // Get storage state (cookies + localStorage)
  const storageState = await context.storageState();
  
  console.log('🔌 Closing local browser...');
  await browser.close();

  console.log(`📤 Uploading session to remote C2 server...`);

  try {
    const response = await fetch(`${remoteUrl}/api/accounts/${accountId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_data: storageState,
        status: 'connected',
        last_health_check: new Date().toISOString()
      })
    });

    if (response.ok) {
      console.log('\n🎉 Success! Stored cookies uploaded and account status set to "connected".');
      console.log('Your remote C2 server can now sync messages and run campaigns for this account!\n');
    } else {
      const errorText = await response.text();
      console.error(`\n❌ Failed to upload to C2: HTTP ${response.status} - ${errorText}\n`);
    }
  } catch (err) {
    console.error(`\n❌ Network error uploading to remote server: ${err.message}\n`);
  }
}

main().catch(console.error);
