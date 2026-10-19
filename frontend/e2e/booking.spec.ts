import { test, expect, Page } from '@playwright/test';

test.beforeEach(async ({ request }) => { expect((await request.post('/__test/reset')).ok()).toBeTruthy(); });

async function details(page: Page, online = false) {
  await page.goto('/');
  await page.locator('#booking-date').fill('2099-10-10');
  await page.locator('.slot-card.status-available').first().click();
  await page.locator('#custName').fill('Browser Test');
  await page.locator('#custPhone').fill('01700000000');
  await page.getByRole('button', { name: 'Verify phone & continue', exact: true }).click();
  await page.getByRole('button', { name: 'Verify phone', exact: true }).click();
  if (online) await page.locator('label.pay-option').filter({ hasText: 'Bkash' }).click();
  await page.locator('input[name="policyAccepted"]').check();
}

test('pay later, refresh recovery and PDF download', async ({ page }) => {
  await details(page);
  await page.getByRole('button', { name: 'Request booking', exact: true }).click();
  await expect(page.locator('#result-title')).toHaveText('Booking requested');
  await page.reload();
  await expect(page.locator('#result-title')).toHaveText('Booking requested');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download booking slip' }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/booking_slip_\d+\.pdf/);
});

test('verified failure followed by retry and successful payment', async ({ page }) => {
  await details(page, true);
  await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await page.getByRole('button', { name: 'Pay Now', exact: true }).click();
  await page.getByRole('button', { name: 'Fail payment', exact: true }).click();
  await expect(page.locator('#result-title')).toHaveText('Payment failed');
  await page.getByRole('button', { name: 'Try payment', exact: true }).click();
  await page.getByRole('button', { name: 'Pay Now', exact: true }).click();
  await page.getByRole('button', { name: 'Pay successfully', exact: true }).click();
  await expect(page.locator('#result-title')).toHaveText('Booking confirmed');
  await expect(page.getByText('Your payment is verified and your booking is confirmed.')).toBeVisible();
});

test('two browsers cannot hold the same slot', async ({ browser, page }) => {
  await details(page);
  const secondContext = await browser.newContext();
  try {
    const other = await secondContext.newPage();
    await other.goto('http://127.0.0.1:5055');
    await other.locator('#booking-date').fill('2099-10-10');
    await expect(other.locator('.slot-card.status-held')).toHaveCount(1);
    await expect(other.locator('.slot-card.status-held')).toHaveAttribute('aria-disabled', 'true');
    const conflict = await secondContext.request.post('http://127.0.0.1:5055/api/slots/hold', { data: { slot_id: 1, booking_date: '2099-10-10' } });
    expect(conflict.status()).toBe(409);
    await expect(other.getByRole('dialog')).toHaveCount(0);
  } finally { await secondContext.close(); }
});

test('forged success and slow/offline status never show payment received', async ({ page }) => {
  await page.route('**/api/bookings/999/result', route => route.abort());
  await page.goto('/?payment=success&booking_id=999');
  await expect(page.locator('#result-title')).toHaveText('Checking payment status…');
  await expect(page.getByText('Your payment is verified and your booking is confirmed.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue browsing' }).click();
  await expect(page.locator('.payment-result-overlay')).toHaveCount(0);
});

test('hold expiry retains entered details', async ({ page }) => {
  await page.route('**/api/slots/hold', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), expires_at: new Date(Date.now() + 3000).toISOString() } });
  });
  await page.goto('/');
  await page.locator('#booking-date').fill('2099-10-10');
  await page.locator('.slot-card.status-available').first().click();
  await page.locator('#custName').fill('Kept details');
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 8000 });
  await page.unroute('**/api/slots/hold');
  await page.locator('.slot-card.status-available').first().click();
  await expect(page.locator('#custName')).toHaveValue('Kept details');
});

test('mobile summary, Bengali result and keyboard dialog navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await details(page);
  await expect(page.getByText('Total price', { exact: true })).toBeVisible();
  await expect(page.getByText('Due at turf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close booking', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Request booking', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Change booking language' }).click();
  await page.goto('/?payment=success&booking_id=999');
  await expect(page.locator('#result-title')).toHaveText('পেমেন্টের অবস্থা যাচাই হচ্ছে…');
});
