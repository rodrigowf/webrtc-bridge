import { test, expect } from '@playwright/test';
import type { Page, ConsoleMessage } from '@playwright/test';

/**
 * Interactive E2E Test for WebRTC Bridge
 *
 * This test runs in headed mode with extended timeout, allowing manual interaction
 * while capturing both frontend console logs and backend behavior.
 *
 * Run with: npx playwright test tests/interactive.e2e.test.ts --headed
 */

test.describe('WebRTC Bridge - Interactive Debug Session', () => {
  test('Interactive testing with full logging', async ({ page }) => {
    // Configure extended timeout for manual testing (10 minutes)
    test.setTimeout(600_000);

    const frontendLogs: ConsoleMessage[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    // Capture all console messages from the browser
    page.on('console', (msg: ConsoleMessage) => {
      frontendLogs.push(msg);
      const type = msg.type();
      const text = msg.text();
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

      // Color-coded output for different log types
      if (type === 'error') {
        errors.push(text);
        console.log(`\x1b[31m[${timestamp}] [BROWSER ERROR]\x1b[0m ${text}`);
      } else if (type === 'warning') {
        warnings.push(text);
        console.log(`\x1b[33m[${timestamp}] [BROWSER WARN]\x1b[0m ${text}`);
      } else if (type === 'log' || type === 'info') {
        console.log(`\x1b[36m[${timestamp}] [BROWSER]\x1b[0m ${text}`);
      } else if (type === 'debug') {
        console.log(`\x1b[90m[${timestamp}] [BROWSER DEBUG]\x1b[0m ${text}`);
      }
    });

    // Capture page errors
    page.on('pageerror', (error: Error) => {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`\x1b[31m[${timestamp}] [PAGE ERROR]\x1b[0m ${error.message}`);
      console.log(`\x1b[31m[STACK]\x1b[0m ${error.stack}`);
      errors.push(error.message);
    });

    // Capture network requests (for debugging signaling)
    page.on('request', (request) => {
      if (request.url().includes('/signal') || request.url().includes('/healthz')) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`\x1b[35m[${timestamp}] [NETWORK →]\x1b[0m ${request.method()} ${request.url()}`);
      }
    });

    page.on('response', async (response) => {
      if (response.url().includes('/signal') || response.url().includes('/healthz')) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const status = response.status();
        const statusColor = status >= 200 && status < 300 ? '\x1b[32m' : '\x1b[31m';
        console.log(`${statusColor}[${timestamp}] [NETWORK ←]\x1b[0m ${status} ${response.url()}`);

        // Log response body for signal endpoint
        if (response.url().includes('/signal')) {
          try {
            const body = await response.text();
            console.log(`\x1b[35m[RESPONSE BODY]\x1b[0m ${body.substring(0, 200)}...`);
          } catch (e) {
            // Ignore if body already consumed
          }
        }
      }
    });

    console.log('\n\x1b[1m\x1b[46m════════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m\x1b[46m  WebRTC Bridge - Interactive Debug Session Started            \x1b[0m');
    console.log('\x1b[1m\x1b[46m════════════════════════════════════════════════════════════════\x1b[0m\n');
    console.log('\x1b[1mInstructions:\x1b[0m');
    console.log('  1. Browser will open automatically');
    console.log('  2. Click "Start Call" to begin WebRTC connection');
    console.log('  3. Grant microphone permission when prompted');
    console.log('  4. Watch logs below for frontend/backend activity');
    console.log('  5. Press Ctrl+C when done testing\n');
    console.log('\x1b[90m─────────────────────────────────────────────────────────────────\x1b[0m\n');

    // Navigate to the application
    console.log('\x1b[1m[ACTION]\x1b[0m Navigating to http://localhost:8080...\n');
    await page.goto('http://localhost:8080');

    // Verify page loaded
    await expect(page.locator('h1')).toContainText('WebRTC ↔ OpenAI Voice Bridge');
    console.log('\x1b[32m[SUCCESS]\x1b[0m Page loaded successfully\n');

    // Check that the start button exists
    const startButton = page.locator('#start');
    await expect(startButton).toBeVisible();
    console.log('\x1b[32m[SUCCESS]\x1b[0m Start button is visible\n');

    // Check status element
    const statusEl = page.locator('#status');
    await expect(statusEl).toBeVisible();

    console.log('\x1b[1m\x1b[43m READY FOR MANUAL TESTING \x1b[0m\n');
    console.log('\x1b[1mWaiting for your interaction...\x1b[0m');
    console.log('\x1b[90m(Click "Start Call" in the browser to begin)\x1b[0m\n');

    // Monitor for button click and status changes
    let callStarted = false;
    const checkInterval = setInterval(async () => {
      const isDisabled = await startButton.isDisabled();
      const statusText = await statusEl.textContent();

      if (isDisabled && !callStarted) {
        callStarted = true;
        console.log('\n\x1b[1m\x1b[42m CALL STARTED \x1b[0m\n');
        console.log('\x1b[1m[USER ACTION]\x1b[0m Start button clicked, monitoring connection...\n');
      }

      if (statusText && statusText.trim()) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`\x1b[34m[${timestamp}] [STATUS]\x1b[0m ${statusText}`);
      }
    }, 500);

    // Keep the test alive for manual interaction
    // You can adjust this timeout or press Ctrl+C to stop
    await page.waitForTimeout(590_000); // 9 minutes 50 seconds (before test timeout)

    clearInterval(checkInterval);

    console.log('\n\x1b[90m─────────────────────────────────────────────────────────────────\x1b[0m');
    console.log('\x1b[1m[TEST SUMMARY]\x1b[0m');
    console.log(`  Total console logs: ${frontendLogs.length}`);
    console.log(`  Errors: ${errors.length}`);
    console.log(`  Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log('\n\x1b[31m[ERRORS DETECTED]\x1b[0m');
      errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }

    if (warnings.length > 0) {
      console.log('\n\x1b[33m[WARNINGS DETECTED]\x1b[0m');
      warnings.forEach((warn, i) => {
        console.log(`  ${i + 1}. ${warn}`);
      });
    }

    console.log('\n\x1b[1m\x1b[46m════════════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m\x1b[46m  Interactive Debug Session Ended                               \x1b[0m');
    console.log('\x1b[1m\x1b[46m════════════════════════════════════════════════════════════════\x1b[0m\n');
  });
});
