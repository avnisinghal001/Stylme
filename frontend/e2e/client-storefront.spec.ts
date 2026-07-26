import { expect, test } from "@playwright/test";

const apiPath = "/api/v1";

test.describe("browser-driven storefront", () => {
  test("renders a direct product URL without waiting for recommendations", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One browser proves the client data boundary");
    let releaseRelated: (() => void) | undefined;
    const relatedGate = new Promise<void>((resolve) => { releaseRelated = resolve; });
    await page.route(/\/products\/[^/?]+\/related(?:\?|$)/, async (route) => {
      await relatedGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    });

    await page.goto("/products/ethnic-motifs-embroidered-kurti-21669434");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to cart" })).toBeEnabled();
    releaseRelated?.();
  });

  test("opens a product and loads its purchasable details from the browser", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One browser proves the client data boundary");

    await page.goto("/products");
    await expect(page.getByRole("region", { name: "Product results" })).toBeVisible();
    await expect(page.getByText("Preview styles", { exact: true })).toHaveCount(0);

    const firstCard = page.locator("article").first();
    const productLink = firstCard.locator('a[href^="/products/"]').first();
    const href = await productLink.getAttribute("href");
    expect(href).toMatch(/^\/products\/[^/?#]+$/);
    const slug = decodeURIComponent(href!.split("/").at(-1)!);

    const detailRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET" && url.pathname === `${apiPath}/products/${encodeURIComponent(slug)}`;
    });
    await productLink.click();
    await detailRequest;

    await expect(page).toHaveURL(new RegExp(`/products/${encodeURIComponent(slug)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add to cart" })).toBeEnabled();
  });

  test("runs intelligent search from the browser", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One browser proves the client data boundary");
    const phrase = "minimal birthday wear under Rs 5600";
    const advancedResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === `${apiPath}/search/advanced`;
    });

    await page.goto(`/search?q=${encodeURIComponent(phrase)}`);
    const response = await advancedResponse;
    expect(response.status()).toBe(200);
    const posted = response.request().postDataJSON() as { query?: string };
    expect(posted.query).toBe(phrase);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(phrase);
    await expect(page.getByRole("region", { name: "Product results" })).toBeVisible();
    await expect(page.getByText("Preview styles", { exact: true })).toHaveCount(0);
  });

  test("keeps advanced-search products and totals on page two", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "One browser proves pagination");
    const phrase = "kal bhai ki shaadi hai";

    await page.goto(`/search?q=${encodeURIComponent(phrase)}`);
    const pagination = page.getByRole("navigation", { name: "Catalog pagination" });
    await expect(pagination).toBeVisible();

    const pageTwoResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (response.request().method() !== "POST" || url.pathname !== `${apiPath}/search/advanced`) return false;
      const posted = response.request().postDataJSON() as { page?: number };
      return posted.page === 2;
    });
    await pagination.getByRole("link", { name: /Next/ }).click();

    const response = await pageTwoResponse;
    expect(response.status()).toBe(200);
    const body = await response.json() as { items?: unknown[]; page?: number; total?: number; totalPages?: number };
    expect(body.page).toBe(2);
    expect(body.total).toBeGreaterThan(12);
    expect(body.totalPages).toBeGreaterThan(1);
    expect(body.items?.length ?? 0).toBeGreaterThan(0);

    await expect(page).toHaveURL(/(?:\\?|&)page=2(?:&|$)/);
    await expect(page.getByRole("region", { name: "Product results" }).getByRole("link")).not.toHaveCount(0);
    await expect(pagination).toContainText("2 /");
  });
});
