import { PlaywrightTestConfig, Frame, devices, expect } from "@playwright/test";
import * as path from "path";

require("dotenv").config({ path: "../../../../../.env" });

const outputDir = path.join("../results");
const testDir = path.join("../tests");
const quickMode = process.env.QUICK === "true";
const CI = process.env.CI;
const config: PlaywrightTestConfig = {
  forbidOnly: !!CI,
  retries: quickMode && !CI ? 0 : 1,
  workers: 1,
  timeout: 60_000,
  reporter: [
    [CI ? "github" : "list"],
    [
      "html",
      { outputFolder: path.join(__dirname, "..", "reports", "playwright-html-report"), open: "never" },
    ],
    ["junit", { outputFile: path.join(__dirname, "..", "reports", "results.xml") }],
  ],
  globalSetup: require.resolve("./globalSetup"),
  outputDir,
  expect: {
    toMatchSnapshot: {
      // Opacity transitions can cause small differences
      // Every month the rendered month changes failing the snapshot tests. So, increase the threshold to catch major bugs only.
      maxDiffPixelRatio: 0.1,
    },
  },
  webServer: {
    // Run servers in parallel as Playwright doesn't support two different webserver commands at the moment See https://github.com/microsoft/playwright/issues/8206
    command: "yarn run-p 'embed-dev' 'embed-web-start'",
    port: 3100,
    timeout: 60_000,
    reuseExistingServer: !CI,
  },
  use: {
    baseURL: "http://localhost:3100",
    locale: "en-US",
    trace: "retain-on-failure",
    headless: !!CI || !!process.env.PLAYWRIGHT_HEADLESS,
  },
  projects: [
    {
      name: "chromium",
      testDir,
      use: { ...devices["Desktop Chrome"] },
    },
    quickMode
      ? {}
      : {
          name: "firefox",
          testDir,
          use: { ...devices["Desktop Firefox"] },
        },
    quickMode
      ? {}
      : {
          name: "webkit",
          testDir,
          use: { ...devices["Desktop Safari"] },
        },
  ],
};
export type ExpectedUrlDetails = {
  searchParams?: Record<string, string | string[]>;
  pathname?: string;
  origin?: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PlaywrightTest {
    //FIXME: how to restrict it to Frame only
    interface Matchers<R> {
      toBeEmbedCalLink(
        calNamespace: string,
        getActionFiredDetails: Function,
        expectedUrlDetails?: ExpectedUrlDetails
      ): Promise<R>;
    }
  }
}

expect.extend({
  async toBeEmbedCalLink(
    iframe: Frame,
    calNamespace: string,
    //TODO: Move it to testUtil, so that it doesn't need to be passed
    getActionFiredDetails: Function,
    expectedUrlDetails: ExpectedUrlDetails = {}
  ) {
    if (!iframe || !iframe.url) {
      return {
        pass: false,
        message: () => `Expected to provide an iframe, got ${iframe}`,
      };
    }

    const u = new URL(iframe.url());
    const frameElement = await iframe.frameElement();
    const { display: displayBefore, background: backgroundBefore } = await iframe.evaluate(() => {
      return {
        display: document.body.style.display,
        background: document.body.style.background,
      };
    });

    expect(displayBefore).toBe("none");
    expect(backgroundBefore).toBe("transparent");
    if (!(await frameElement.isVisible())) {
      return {
        pass: false,
        message: () => `Expected iframe to be visible`,
      };
    }
    const pathname = u.pathname;
    const expectedPathname = expectedUrlDetails.pathname;
    if (expectedPathname && expectedPathname !== pathname) {
      return {
        pass: false,
        message: () => `Expected pathname to be ${expectedPathname} but got ${pathname}`,
      };
    }

    const origin = u.origin;
    const expectedOrigin = expectedUrlDetails.origin;
    if (expectedOrigin && expectedOrigin !== origin) {
      return {
        pass: false,
        message: () => `Expected origin to be ${expectedOrigin} but got ${origin}`,
      };
    }

    const searchParams = u.searchParams;
    const expectedSearchParams = expectedUrlDetails.searchParams || {};
    for (const [expectedKey, expectedValue] of Object.entries(expectedSearchParams)) {
      const value = searchParams.get(expectedKey);
      if (value !== expectedValue) {
        return {
          message: () => `${expectedKey} should have value ${expectedValue} but got value ${value}`,
          pass: false,
        };
      }
    }

    const iframeReadyEventDetail = await new Promise(async (resolve) => {
      setInterval(async () => {
        const iframeReadyEventDetail = await getActionFiredDetails({
          calNamespace,
          actionType: "linkReady",
        });
        if (iframeReadyEventDetail) {
          resolve(iframeReadyEventDetail);
        }
      }, 500);
    });

    const { display: displayAfter, background: backgroundAfter } = await iframe.evaluate(() => {
      return {
        display: document.body.style.display,
        background: document.body.style.background,
      };
    });

    expect(displayAfter).not.toBe("none");
    expect(backgroundAfter).toBe("transparent");
    if (!iframeReadyEventDetail) {
      return {
        pass: false,
        message: () => `Iframe not ready to communicate with parent`,
      };
    }

    return {
      pass: true,
      message: () => `passed`,
    };
  },
});
export default config;
