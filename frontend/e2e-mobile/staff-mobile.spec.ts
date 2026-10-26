import { test, expect, Page } from '@playwright/test';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'none' })}.${b64({ role: 'owner', id: 1, exp: 4102444800 })}.x`;
const slots = [{ id: 1, start_time: '18:00', end_time: '19:00', price: 2000 }, { id: 2, start_time: '19:00', end_time: '20:00', price: 2000 }];
const dates = ['2026-11-01', '2026-11-02', '2026-11-03'];
const booking = (id: number, status: string, payment: string) => ({
  id, booking_date: '2026-11-0' + (id - 100), start_time: '18:00', end_time: '19:00', customer_name: 'Rahim Uddin',
  customer_phone: '01712345678', customer_email: 'rahim@example.com', team_name: 'Dhaka Strikers', price: 2000,
  price_source: 'captured', status, payment_status: payment
});
const bookings = [booking(101, 'pending', 'unpaid'), booking(102, 'approved', 'unpaid'), booking(103, 'approved', 'paid')];
const bookingRequests: string[] = [];

async function staffPage(page: Page) {
  await page.addInitScript(t => localStorage.setItem('admin_token', t), token);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: unknown = {};
    if (p.endsWith('/admin/bookings')) {
      bookingRequests.push(url.search);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const items = bookings.filter(b => !q || b.customer_phone.includes(q) || String(b.id) === q);
      body = { items, page: 1, page_size: 25, total: items.length };
    } else if (p.endsWith('/admin/calendar')) {
      body = {
        start_date: dates[0], end_date: dates[2], timezone: 'Asia/Dhaka', server_time: new Date().toISOString(), dates,
        slots: slots.map(s => ({ slot_id: s.id, ...s, category: 3 })),
        cells: dates.flatMap(date => slots.map(s => ({ slot_id: s.id, date, status: 'available', is_past: false, conflict: false, booking: null, block_reason: null, hold_expires_at: null, seasons: [] }))),
        counts: { available: 6, booked: 0, pending: 0, held: 0, season_reserved: 0, blocked: 0, inactive: 0, past: 0 }
      };
    } else if (p.endsWith('/admin/stats')) body = { bookings: { pending: 1, approved: 2, cancelled: 0, total: 3 } };
    else if (p.endsWith('/collections') && route.request().method() === 'GET') {
      body = { booking_id: 101, status: 'pending', price: '2000.00', received: '0.00', outstanding: '2000.00', excess: '0.00', required_advance: '500.00', review_required: false, advance_review: false, entries: [], gateway_history: [] };
    } else if (p.endsWith('/admin/slots')) body = slots;
    else if (p.endsWith('/admin/recurring-bookings')) body = [];
    else if (p.includes('/daily-summary')) body = { date: '2026-10-26', collections: { cash_net: '0', online_net: '0', by_method: [] }, expenses: { cash: '0' }, completed_refunds: { count: 0, amount: '0' }, ledger_check: { ok: true, mismatches: [], bookings_checked: 0 }, closing: null };
    else if (p.includes('/daily-closings') || p.includes('/expenses') || p.includes('/audit-log')) body = p.includes('/expenses') ? { items: [] } : [];
    return route.fulfill({ json: body });
  });
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const width of [360, 390]) {
  test.describe(`staff phone ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
    test.beforeEach(async ({ page }) => { bookingRequests.length = 0; await staffPage(page); });

    test('calendar fits the screen', async ({ page }) => {
      await page.goto('/admin/dashboard?tab=calendar');
      await expect(page.locator('.calendar')).toBeVisible();
      expect(await noSideways(page)).toBe(true);
    });

    test('booking search works and payment entry is reachable without sideways scrolling', async ({ page }) => {
      await page.goto('/admin/dashboard?tab=bookings');
      await expect(page.locator('.bookings-table tbody tr')).toHaveCount(3);
      expect(await noSideways(page)).toBe(true);
      await page.getByPlaceholder('Phone, team or booking ID').fill('101');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.locator('.bookings-table tbody tr')).toHaveCount(1);
      expect(bookingRequests.some(r => r.includes('q=101'))).toBe(true);
      const pay = page.locator('.payment-action').first();
      await pay.scrollIntoViewIfNeeded();
      const box = (await pay.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await pay.click();
      const dialog = page.locator('.payment-dialog');
      await expect(dialog).toBeVisible();
      const d = (await dialog.boundingBox())!;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(width);
      expect(await noSideways(page)).toBe(true);
    });

    test('daily closing and expenses fit the screen', async ({ page }) => {
      for (const route of ['/admin/dashboard/daily-closing', '/admin/dashboard/operations']) {
        await page.goto(route);
        await page.waitForTimeout(400);
        expect(await noSideways(page), route).toBe(true);
      }
    });
  });
}
