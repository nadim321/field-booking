import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingService } from '../../services/branding.service';

type Language = 'en' | 'bn';
interface FaqItem { question: string; answers: string[]; }

@Component({
  selector: 'app-customer-faq', standalone: true, imports: [CommonModule],
  template: `<section class="faq" aria-labelledby="faq-title">
    <span class="eyebrow">{{ language === 'bn' ? 'সাহায্য' : 'HELP' }}</span>
    <h2 id="faq-title">{{ language === 'bn' ? 'সাধারণ জিজ্ঞাসা' : 'Frequently asked questions' }}</h2>
    <details *ngFor="let item of items; let i = index" [open]="i === 0">
      <summary>{{ item.question }}</summary>
      <div class="answer"><p *ngFor="let answer of item.answers">{{ answer }}</p>
        <nav *ngIf="i === 4 && (brand.settings()?.turf_phone || brand.settings()?.turf_whatsapp)" aria-label="Venue contact">
          <a *ngIf="brand.settings()?.turf_phone as phone" [href]="'tel:' + phone">{{ language === 'bn' ? 'ফোন করুন' : 'Call the venue' }}</a>
          <a *ngIf="brand.settings()?.turf_whatsapp as whatsapp" [href]="'https://wa.me/' + whatsapp.replace('+','')" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </nav>
      </div>
    </details>
  </section>`,
  styles: [`:host{display:block}.faq{max-width:1000px;margin:0 auto 3rem;padding:1rem 2rem;color:#e2e8f0}.eyebrow{color:#6ee7b7;font-size:.75rem;letter-spacing:.15em}h2{margin:.45rem 0 1.25rem;color:#f8fafc;font-size:1.65rem}details{border-bottom:1px solid #334155;padding:.95rem 0}summary{cursor:pointer;font-weight:700;line-height:1.5}summary:focus-visible,a:focus-visible{outline:3px solid #6ee7b7;outline-offset:3px}.answer{color:#bfccdc;line-height:1.65;padding:.25rem 0}.answer p{white-space:pre-line;margin:.5rem 0}nav{display:flex;gap:1rem;flex-wrap:wrap}a{color:#6ee7b7}@media(max-width:640px){.faq{padding:1rem}}`]
})
export class CustomerFaqComponent {
  @Input({ required: true }) language: Language = 'en';
  readonly brand = inject(BrandingService);

  get items(): FaqItem[] {
    const bn = this.language === 'bn';
    const settings = this.brand.settings();
    const payment = bn
      ? `এখন পরিশোধ না করেও অনুরোধ পাঠানো যায়। অনলাইনে এখন পরিশোধ বেছে নিলে বুকিংয়ের সময়কার মোট মূল্যের ${settings?.advance_payment_percentage ?? 25}% অগ্রিম দিতে হবে; বাকি টাকা মাঠের নিয়ম অনুযায়ী পরিশোধ করুন।`
      : `You can submit a request and pay later. If you choose online payment, the advance is ${settings?.advance_payment_percentage ?? 25}% of the price shown when you book; pay the remaining balance according to the venue's instructions.`;
    const policy = settings?.cancellation_policy;
    const cancellationLines = (bn ? policy?.bn : policy?.en) as string[] | undefined;
    return [
      { question: bn ? 'কীভাবে একটি স্লট বুক করব?' : 'How do I book a slot?', answers: [bn ? 'তারিখ বেছে সবুজ খালি স্লটে চাপ দিন, যোগাযোগের তথ্য দিন এবং পেমেন্ট পদ্ধতি বেছে অনুরোধ পাঠান। বুকিং অনুমোদিত হলে আপনাকে জানানো হবে।' : 'Choose a date, select an available slot, enter your contact details, then choose a payment option and send the request. We will let you know when the booking is approved.'] },
      { question: bn ? 'এখনই কি টাকা দিতে হবে?' : 'Do I have to pay now?', answers: [payment] },
      { question: bn ? 'বুকিং কখন নিশ্চিত হবে?' : 'When is my booking confirmed?', answers: [bn ? 'অনুরোধ পাঠানো মানেই বুকিং অনুমোদন নয়। মাঠ কর্তৃপক্ষ অনুমোদন দিলে বুকিং নিশ্চিত হবে; পেমেন্টের অবস্থা আলাদাভাবে দেখানো হবে।' : 'Submitting a request does not mean it is approved. Your booking is confirmed after venue staff approve it; payment status is shown separately.'] },
      { question: bn ? 'বাতিল ও রিফান্ডের নিয়ম কী?' : 'What is the cancellation and refund policy?', answers: cancellationLines?.length ? cancellationLines : [bn ? 'বাতিলের নিয়ম জানতে মাঠে যোগাযোগ করুন।' : 'Contact the venue for cancellation terms.'] },
      { question: bn ? 'সিজন বুকিং কীভাবে কাজ করে?' : 'How does a season booking work?', answers: [bn ? 'একই বার ও সময়ে প্রতি সপ্তাহে খেলার জন্য অনুরোধ পাঠান। এটি মাঠ কর্তৃপক্ষের অনুমোদন সাপেক্ষে; সর্বোচ্চ সময়সীমা ৩ মাস।' : 'Request the same slot each week on the weekday you choose. Season requests need venue approval and can cover up to three months.'] }
    ];
  }
}
