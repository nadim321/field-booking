import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingService } from '../../services/branding.service';
@Component({
  selector: 'app-venue-footer', standalone: true, imports: [CommonModule],
  template: `<footer><p>© {{ year }} {{ brand.name }}. {{ language === 'bn' ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.' }}</p>
    <ng-container *ngIf="brand.settings() as s"><p *ngIf="s.turf_address">{{ s.turf_address }}</p>
      <nav aria-label="Venue contact"><a *ngIf="s.turf_phone" [href]="'tel:' + s.turf_phone">{{ s.turf_phone }}</a>
      <a *ngIf="s.turf_email" [href]="'mailto:' + s.turf_email">{{ s.turf_email }}</a>
      <a *ngIf="s.turf_whatsapp" [href]="'https://wa.me/' + s.turf_whatsapp.replace('+','')" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a *ngIf="s.turf_maps_url" [href]="s.turf_maps_url" target="_blank" rel="noopener noreferrer">{{ language === 'bn' ? 'গুগল ম্যাপ' : 'Google Maps' }}</a></nav></ng-container>
    <p *ngIf="brand.loading()" role="status">{{ language === 'bn' ? 'মাঠের তথ্য লোড হচ্ছে…' : 'Loading venue details…' }}</p>
    <p *ngIf="brand.error()" role="status">{{ language === 'bn' ? 'মাঠের তথ্য লোড হয়নি।' : 'Venue details could not be loaded.' }} <button (click)="brand.refresh()">{{ language === 'bn' ? 'আবার চেষ্টা করুন' : 'Retry' }}</button></p>
    </footer>`,
  styles: [`footer{padding:2rem 1rem;text-align:center;background:#0b1220;border-top:1px solid #26364c;color:#b8c6d9;font-size:.85rem}p{margin:.5rem 0;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem}a,button{color:#6ee7b7}button{background:none;border:1px solid #64748b;border-radius:5px;padding:.3rem;cursor:pointer}`]
})
export class VenueFooterComponent { @Input() language: 'en' | 'bn' = 'en'; brand = inject(BrandingService); readonly year = new Date().getFullYear(); }
