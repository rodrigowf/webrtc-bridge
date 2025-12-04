import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for WebRTC Bridge Testing
 *
 * Configured for interactive debugging with:
 * - Headed mode (browser visible)
 * - Extended timeouts for manual testing
 * - Chromium browser with media permissions
 */
export default defineConfig({
  testDir: './tests',

  // Extended timeout for interactive testing
  timeout: 600_000, // 10 minutes per test

  // Global setup timeout
  globalTimeout: 600_000,

  // Expect timeout for assertions
  expect: {
    timeout: 10_000,
  },

  fullyParallel: false,

  // Don't fail fast - complete the test even if assertions fail
  forbidOnly: false,

  // Retry failed tests once
  retries: 0,

  // Run tests serially
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    // Base URL for the application
    baseURL: 'http://localhost:8080',

    // Headed mode - browser will be visible
    headless: false,

    // Slow down operations for visibility
    launchOptions: {
      slowMo: 0,
      args: [
        '--use-fake-ui-for-media-stream', // Auto-grant media permissions
        '--use-fake-device-for-media-stream', // Use fake camera/mic
        '--disable-web-security', // Allow localhost WebRTC
      ],
    },

    // Capture screenshots on failure
    screenshot: 'only-on-failure',

    // Capture video on failure
    video: 'retain-on-failure',

    // Trace on failure
    trace: 'retain-on-failure',

    // Viewport size
    viewport: { width: 1280, height: 720 },

    // Permissions
    permissions: ['microphone', 'camera'],
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone', 'camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-web-security',
            '--allow-file-access-from-files',
          ],
        },
      },
    },
  ],

  // Run local server before tests (optional - comment out if running manually)
  // webServer: {
  //   command: 'npm start',
  //   url: 'http://localhost:8080',
  //   timeout: 120_000,
  //   reuseExistingServer: true,
  // },
});
