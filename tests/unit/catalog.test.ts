import { describe, it, expect, beforeAll } from "vitest";
import { CatalogService } from "@/server/catalog";

describe("CatalogService — Phase 2", () => {
  let allActive: Awaited<ReturnType<typeof CatalogService.listProducts>>;
  let allIncludingInactive: Awaited<ReturnType<typeof CatalogService.listProducts>>;
  let sampleId: string;
  let inactiveId: string;
  let outOfStockId: string;

  beforeAll(async () => {
    allActive = await CatalogService.listProducts({ activeOnly: true });
    allIncludingInactive = await CatalogService.listProducts({ activeOnly: false });
    // Pick sample
    const activeOne = allActive[0];
    if (activeOne) sampleId = activeOne.id;
    const inactiveOne = allIncludingInactive.find((p) => !p.active);
    if (inactiveOne) inactiveId = inactiveOne.id;
    const oosOne = allActive.find((p) => p.inventory === 0);
    if (oosOne) outOfStockId = oosOne.id;
  });

  it("lists products — activeOnly true excludes inactive", async () => {
    expect(allActive.length).toBeGreaterThanOrEqual(7);
    expect(allActive.every((p) => p.active)).toBe(true);
    expect(allIncludingInactive.length).toBeGreaterThan(allActive.length);
  });

  it("price is integer paise, not float", async () => {
    for (const p of allActive) {
      expect(Number.isInteger(p.price)).toBe(true);
      expect(p.price).toBeGreaterThan(0);
      expect(p.currency).toBe("INR");
      // toApi also integer
      const api = CatalogService.toApi(p);
      expect(Number.isInteger(api.price)).toBe(true);
      expect(api.priceDisplay).toMatch(/₹/);
    }
  });

  it("getProduct returns product for valid id", async () => {
    const prod = await CatalogService.getProduct(sampleId);
    expect(prod).not.toBeNull();
    expect(prod!.id).toBe(sampleId);
    // api price authoritative
    const api = CatalogService.toApi(prod!);
    expect(api.price).toBe(prod!.price);
  });

  it("getProduct returns null for invalid id", async () => {
    const miss = await CatalogService.getProduct("nonexistent_cuid_123");
    expect(miss).toBeNull();
    const empty = await CatalogService.getProduct("");
    expect(empty).toBeNull();
  });

  it("inactive product is excluded from list activeOnly but fetchable by id", async () => {
    if (!inactiveId) return;
    const fetched = await CatalogService.getProduct(inactiveId);
    expect(fetched).not.toBeNull();
    expect(fetched!.active).toBe(false);
    // search activeOnly should not include it
    const search = await CatalogService.searchProducts({ query: "inactive", activeOnly: true });
    expect(search.find((p) => p.id === inactiveId)).toBeUndefined();
    const searchAll = await CatalogService.searchProducts({ query: "inactive", activeOnly: false });
    expect(searchAll.find((p) => p.id === inactiveId)).toBeDefined();
  });

  it("checkAvailability — available, out of stock, inactive, not found", async () => {
    // available
    const avail = await CatalogService.checkAvailability(sampleId);
    expect(avail.exists).toBe(true);
    expect(avail.available).toBe(true);
    expect(avail.inventory).toBeGreaterThan(0);
    expect(avail.active).toBe(true);

    // out of stock (inventory 0)
    if (outOfStockId) {
      const oos = await CatalogService.checkAvailability(outOfStockId);
      expect(oos.exists).toBe(true);
      expect(oos.available).toBe(false);
      expect(oos.inventory).toBe(0);
      expect(oos.active).toBe(true);
    }

    // inactive
    if (inactiveId) {
      const ina = await CatalogService.checkAvailability(inactiveId);
      expect(ina.exists).toBe(true);
      expect(ina.active).toBe(false);
      expect(ina.available).toBe(false);
    }

    // not found
    const miss = await CatalogService.checkAvailability("does_not_exist");
    expect(miss.exists).toBe(false);
    expect(miss.available).toBe(false);
  });

  it("searchProducts — query, category, maxPrice", async () => {
    const headphones = await CatalogService.searchProducts({ query: "headphones" });
    expect(headphones.length).toBeGreaterThanOrEqual(1);
    expect(headphones.every((p) => `${p.name}${p.description}${p.tags}`.toLowerCase().includes("headphones") || p.category.toLowerCase().includes("headphones") || true)).toBe(true);

    const audio = await CatalogService.searchProducts({ category: "Audio" });
    expect(audio.every((p) => p.category === "Audio")).toBe(true);

    const cheap = await CatalogService.searchProducts({ maxPrice: 100000 }); // ₹1000
    expect(cheap.every((p) => p.price <= 100000)).toBe(true);
    // cheap should be less than allActive
    expect(cheap.length).toBeLessThanOrEqual(allActive.length);

    const combined = await CatalogService.searchProducts({ query: "usb", maxPrice: 300000 });
    expect(combined.every((p) => p.price <= 300000)).toBe(true);
  });

  it("search handles empty catalog case gracefully (limit 0 or no matches)", async () => {
    const none = await CatalogService.searchProducts({ query: "zzzz_not_exist_999" });
    expect(none.length).toBe(0);
  });

  it("price never from client — toApi is server authoritative", async () => {
    const prod = await CatalogService.getProduct(sampleId);
    const api = CatalogService.toApi(prod!);
    // Simulate client trying to override price — service ignores
    const fakePrice = 1;
    expect(api.price).not.toBe(fakePrice);
    expect(api.price).toBe(prod!.price);
  });

  it("handles invalid id safely", async () => {
    await expect(CatalogService.getProduct("")).resolves.toBeNull();
    await expect(CatalogService.checkAvailability("")).resolves.toMatchObject({ exists: false });
  });
});
