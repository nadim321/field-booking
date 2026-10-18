import { Injectable, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ApiService } from './api.service';
import { VenueSettings } from './venue-settings';
import { Subscription, timeout } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BrandingService {
  private api = inject(ApiService);
  private title = inject(Title);
  private meta = inject(Meta);
  readonly settings = signal<VenueSettings | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  private request?: Subscription;
  private customerPage: 'booking' | 'season' | null = null;
  private language: 'en' | 'bn' = 'en';
  constructor() {
    this.api.settingsChanges.subscribe(() => this.refresh());
    this.refresh();
  }
  get name(): string { return this.settings()?.turf_name || 'Turf Booking'; }
  mediaUrl(url: string): string { return this.api.mediaUrl(url); }
  refresh(): void {
    this.request?.unsubscribe();
    this.loading.set(true); this.error.set(false);
    this.request = this.api.getPublicSettings().pipe(timeout(15000)).subscribe({
      next: value => {
        this.settings.set(value); this.loading.set(false);
        this.updateMetadata();
      },
      error: () => { this.settings.set(null); this.loading.set(false); this.error.set(true); this.updateMetadata(); }
    });
  }

  setCustomerPage(page: 'booking' | 'season', language: 'en' | 'bn'): void {
    this.customerPage = page; this.language = language; this.updateMetadata();
  }

  private updateMetadata(): void {
    const name = this.name;
    const bn = this.language === 'bn';
    document.documentElement.lang = this.language;
    const title = this.customerPage === 'season'
      ? (bn ? `${name} | সিজন বুকিং` : `${name} | Weekly Season Booking`)
      : this.customerPage === 'booking'
        ? (bn ? `${name} | টার্ফ বুকিং` : `${name} | Turf Slot Booking`)
        : `${name} | Turf Booking`;
    const description = this.customerPage === 'season'
      ? (bn ? `${name}-এ প্রতি সপ্তাহের একই সময়ের স্লটের জন্য সিজন বুকিংয়ের অনুরোধ পাঠান।` : `Request the same weekly playing slot at ${name}.`)
      : this.customerPage === 'booking'
        ? (bn ? `${name}-এ তারিখ বেছে খালি টার্ফ স্লট দেখুন ও বুকিংয়ের অনুরোধ পাঠান।` : `Choose a date, check available slots and request a turf booking at ${name}.`)
        : this.settings()?.turf_description || `View available slots and book at ${name}.`;
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: name });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    const image = this.settings()?.turf_share_image || this.settings()?.turf_photos?.[0];
    if (image) {
      const absoluteImage = new URL(this.mediaUrl(image.url), window.location.origin).href;
      this.meta.updateTag({ property: 'og:image', content: absoluteImage });
      this.meta.updateTag({ property: 'og:image:width', content: String(image.width) });
      this.meta.updateTag({ property: 'og:image:height', content: String(image.height) });
      this.meta.updateTag({ name: 'twitter:image', content: absoluteImage });
    } else {
      this.meta.removeTag('property="og:image"'); this.meta.removeTag('property="og:image:width"'); this.meta.removeTag('property="og:image:height"');
      this.meta.removeTag('name="twitter:image"');
    }
    const route = this.customerPage === 'season' ? '/season-booking' : '/';
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = new URL(route, window.location.origin).href;
    this.meta.updateTag({ property: 'og:url', content: new URL(route, window.location.origin).href });
  }
}
