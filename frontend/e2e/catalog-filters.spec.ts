import { expect, test, type Locator, type Page } from "@playwright/test";

async function optionOrder(group: Locator) {
  return group.locator("[data-filter-option]").evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-filter-option")),
  );
}

async function isDetailsOpen(group: Locator) {
  return group.evaluate((element) => (element as HTMLDetailsElement).open);
}

async function productTypeGroup(scope: Locator | Page) {
  const group = scope.locator("details").filter({ hasText: "Product type" });
  await expect(group).toHaveCount(1);
  if (!(await isDetailsOpen(group))) await group.locator("summary").click();
  await expect.poll(() => isDetailsOpen(group)).toBe(true);
  await expect(group.locator("[data-filter-option]").first()).toBeVisible();
  return group;
}

test.describe("catalog filter state", () => {
  test("desktop selections keep source order and rehydrate in clicked order", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only interaction");
    await page.goto("/products");

    const sidebar = page.getByRole("complementary", { name: "Catalog filter panel" });
    const group = await productTypeGroup(sidebar);
    const options = group.locator("[data-filter-option]");
    const count = await options.count();
    expect(count).toBeGreaterThan(3);

    const before = await optionOrder(group);
    const later = options.nth(3);
    const earlier = options.nth(1);
    const clicked = [
      await later.getAttribute("data-filter-option"),
      await earlier.getAttribute("data-filter-option"),
    ] as string[];

    await later.click();
    await expect(later).toHaveClass(/bg-pink-50/);
    expect(await optionOrder(group)).toEqual(before);

    await earlier.click();
    await expect(earlier).toHaveClass(/bg-pink-50/);
    expect(await optionOrder(group)).toEqual(before);

    await group.locator("summary").click();
    await expect.poll(() => isDetailsOpen(group)).toBe(false);
    await group.locator("summary").click();
    await expect.poll(() => isDetailsOpen(group)).toBe(true);
    await expect(group.locator("[data-filter-option]").first()).toBeVisible();
    expect(await optionOrder(group)).toEqual(before);
    await expect(group.locator(`[data-filter-option="${clicked[0]}"]`)).toHaveClass(/bg-pink-50/);

    await sidebar.getByRole("button", { name: "Apply filters" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.getAll("productType")).toEqual(clicked);

    const rehydrated = await productTypeGroup(sidebar);
    expect(await optionOrder(rehydrated)).toEqual(before);
    for (const value of clicked) {
      await expect(rehydrated.locator(`[data-filter-option="${value}"]`)).toHaveClass(/bg-pink-50/);
    }
  });

  test("desktop filter panel stays populated while filtered results are pending", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only interaction");
    await page.goto("/products");

    const sidebar = page.getByRole("complementary", { name: "Catalog filter panel" });
    const group = await productTypeGroup(sidebar);
    const target = group.locator("[data-filter-option]").nth(2);
    const value = await target.getAttribute("data-filter-option");
    expect(value).toBeTruthy();
    await target.click();

    await page.route(/\/api\/v1\/products\?.*/, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("productType")) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
      await route.continue();
    });

    await sidebar.getByRole("button", { name: "Apply filters" }).evaluate((button) => (button as HTMLButtonElement).click());

    await expect(sidebar).toBeVisible();
    const form = sidebar.getByRole("form", { name: "Product filters" });
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(sidebar.getByRole("button", { name: "Applying filters" })).toBeVisible();
    await expect(sidebar.getByText("Sort by", { exact: true })).toBeVisible();
    await expect(group.locator(`[data-filter-option="${value}"]`)).toHaveClass(/bg-pink-50/);
    await expect.poll(() => sidebar.locator("details").count()).toBeGreaterThan(5);

    await expect.poll(() => new URL(page.url()).searchParams.getAll("productType")).toEqual([value]);
    await expect(sidebar.getByRole("button", { name: "Apply filters" })).toBeVisible();
  });

  test("mobile drawer preserves draft choices and search when closed", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only interaction");
    await page.goto("/products");
    await page.getByRole("button", { name: /Filter & sort/ }).click();

    let dialog = page.getByRole("dialog", { name: "Filter & sort" });
    let group = await productTypeGroup(dialog);
    const before = await optionOrder(group);
    const target = group.locator("[data-filter-option]").nth(2);
    const value = await target.getAttribute("data-filter-option");
    expect(value).toBeTruthy();

    await target.click();
    expect(await optionOrder(group)).toEqual(before);
    await expect(target).toHaveClass(/bg-pink-50/);

    const search = group.getByPlaceholder("Search product type");
    await search.fill("shirt");
    await dialog.getByRole("button", { name: "Close filters" }).last().click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /Filter & sort/ }).click();
    dialog = page.getByRole("dialog", { name: "Filter & sort" });
    group = await productTypeGroup(dialog);
    await expect(group.getByPlaceholder("Search product type")).toHaveValue("shirt");
    await group.getByPlaceholder("Search product type").fill("");
    await expect.poll(() => optionOrder(group)).toEqual(before);
    await expect(group.locator(`[data-filter-option="${value}"]`)).toHaveClass(/bg-pink-50/);

    await dialog.getByRole("button", { name: "Apply filters" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.getAll("productType")).toEqual([value]);
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /Filter & sort/ }).click();
    dialog = page.getByRole("dialog", { name: "Filter & sort" });
    group = await productTypeGroup(dialog);
    await expect(group.locator(`[data-filter-option="${value}"]`)).toHaveClass(/bg-pink-50/);
  });
});
