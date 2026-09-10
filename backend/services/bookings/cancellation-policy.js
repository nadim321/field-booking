const VERSION = '2026-09-10-v2';
const SUPPORTED_VERSIONS = ['2026-09-10-v1', VERSION];
const POLICY = Object.freeze({
  version: VERSION,
  timezone: 'Asia/Dhaka',
  tiers: [{ minimum_hours: 48, refund_percent: 100 }, { minimum_hours: 24, refund_percent: 50 }, { minimum_hours: 0, refund_percent: 25 }],
  venue_refund_percent: 100,
  refund_basis: 'amount_paid',
  processing_target_business_days: '7–10',
  scope: 'individual bookings; season plans are handled by the turf',
  en: [
    'Cancel at least 48 hours before kickoff: 100% of the amount paid is refundable.',
    'Cancel 24 to less than 48 hours before kickoff: 50% of the amount paid is refundable.',
    'Cancel less than 24 hours before kickoff: 25% of the amount paid is refundable. At or after kickoff, or if you do not attend: no refund.',
    'If the turf cancels because of closure, unsafe conditions or another venue issue: 100% of the amount paid is refundable.',
    'All deadlines use Bangladesh time. Contact the turf to cancel; staff record the cancellation and refund entitlement.',
    'Eligible refunds are processed by staff to the original payment method, with a target of 7–10 business days. Bank/provider delays may take longer.',
    'Rescheduling is subject to availability and staff approval; this policy does not guarantee a free date change. Season plans are handled separately.'
  ],
  bn: [
    'খেলা শুরুর অন্তত ৪৮ ঘণ্টা আগে বাতিল: পরিশোধিত টাকার ১০০% ফেরতযোগ্য।',
    'খেলা শুরুর ২৪ থেকে ৪৮ ঘণ্টার কম সময় আগে বাতিল: পরিশোধিত টাকার ৫০% ফেরতযোগ্য।',
    'খেলা শুরুর ২৪ ঘণ্টার কম সময় আগে বাতিল: পরিশোধিত টাকার ২৫% ফেরতযোগ্য। খেলা শুরু হলে বা অনুপস্থিতি: রিফান্ড নেই।',
    'মাঠ বন্ধ, অনিরাপদ পরিবেশ বা মাঠ কর্তৃপক্ষের সমস্যায় বাতিল: পরিশোধিত টাকার ১০০% ফেরতযোগ্য।',
    'সব সময় বাংলাদেশ সময় অনুযায়ী। বাতিল করতে মাঠে যোগাযোগ করুন; কর্মীরা বাতিল ও ফেরতযোগ্য টাকার হিসাব নথিভুক্ত করবেন।',
    'কর্মীরা মূল পেমেন্ট মাধ্যমে রিফান্ড প্রক্রিয়া করবেন; লক্ষ্য ৭–১০ কর্মদিবস। ব্যাংক/পেমেন্ট প্রদানকারীর কারণে আরও সময় লাগতে পারে।',
    'সময় পরিবর্তন স্লটের প্রাপ্যতা ও কর্তৃপক্ষের অনুমোদন সাপেক্ষে; বিনা খরচে পরিবর্তনের নিশ্চয়তা নেই। সিজন বুকিংয়ের শর্ত আলাদা।'
  ]
});

function quoteCancellation(booking, source = 'customer', now = new Date()) {
  if (!['customer', 'venue'].includes(source)) throw new Error('Invalid cancellation source');
  const paid = Number(booking.amount_paid || 0);
  if (!Number.isFinite(paid) || paid < 0) throw new Error('Invalid recorded payment');
  // Do not apply newly introduced penalties to bookings without recorded acceptance.
  const legacy = !booking.cancellation_policy_version;
  if (!legacy && !SUPPORTED_VERSIONS.includes(booking.cancellation_policy_version)) throw new Error('Unsupported policy version');
  const time = /^\d{2}:\d{2}$/.test(booking.start_time) ? `${booking.start_time}:00` : booking.start_time;
  const kickoff = new Date(`${booking.booking_date}T${time}+06:00`);
  if (!Number.isFinite(kickoff.getTime()) || !Number.isFinite(now.getTime())) throw new Error('Invalid booking time');
  const hours = (kickoff.getTime() - now.getTime()) / 3600000;
  // Apply the more generous v2 short-notice rate to uncancelled v1 bookings too.
  const percent = source === 'venue' || legacy ? 100 : hours >= 48 ? 100 : hours >= 24 ? 50 : hours > 0 ? 25 : 0;
  return {
    policy_version: legacy ? 'legacy-goodwill' : VERSION,
    source, refund_percent: percent,
    amount_paid: paid,
    refund_amount: Math.round(Math.round(paid * 100) * percent / 100) / 100,
    kickoff: kickoff.toISOString(),
    calculated_at: now.toISOString()
  };
}
module.exports = { POLICY, VERSION, quoteCancellation };
