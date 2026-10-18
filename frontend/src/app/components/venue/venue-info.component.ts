import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingService } from '../../services/branding.service';
@Component({
  selector: 'app-venue-info', standalone: true, imports: [CommonModule],
  template: `<ng-container *ngIf="brand.settings() as s"><section aria-labelledby="venue-heading" *ngIf="s.turf_description || s.turf_photos.length || s.turf_facilities.length || s.turf_address || s.turf_phone || s.turf_whatsapp || s.turf_maps_url">
    <div class="intro"><div><span class="eyebrow">THE VENUE</span><h2 id="venue-heading">{{ brand.name }}</h2><p *ngIf="s.turf_description" class="description">{{ s.turf_description }}</p><p *ngIf="s.turf_address">{{ s.turf_address }}</p></div>
    <nav aria-label="Visit or contact the venue"><a *ngIf="s.turf_phone" [href]="'tel:' + s.turf_phone">Call the turf</a><a *ngIf="s.turf_whatsapp" [href]="'https://wa.me/' + s.turf_whatsapp.replace('+','')" target="_blank" rel="noopener noreferrer">WhatsApp</a><a *ngIf="s.turf_maps_url" [href]="s.turf_maps_url" target="_blank" rel="noopener noreferrer">View on Google Maps ↗</a></nav></div>
    <ul *ngIf="s.turf_facilities.length" aria-label="Facilities"><li *ngFor="let facility of s.turf_facilities">{{ facility }}</li></ul>
    <div class="gallery" *ngIf="s.turf_photos.length"><figure *ngFor="let photo of s.turf_photos; let i = index" [class.cover]="i === 0"><img [src]="brand.mediaUrl(photo.url)" [alt]="photo.caption || brand.name + ' — field photo ' + (i+1)" [width]="photo.width" [height]="photo.height" loading="lazy" (error)="imageError($event)"><figcaption *ngIf="photo.caption">{{ photo.caption }}</figcaption></figure></div>
    </section></ng-container>`,
  styles: [`section{max-width:1200px;margin:0 auto 2.5rem;padding:1.5rem 2rem;color:#dce7f5}.intro{display:flex;justify-content:space-between;gap:2rem}.eyebrow{color:#6ee7b7;font-size:.75rem;letter-spacing:.15em}h2{color:#f8fafc;margin:.5rem 0}p{line-height:1.7;overflow-wrap:anywhere}.description{white-space:pre-line}nav{display:flex;flex-wrap:wrap;align-content:flex-start;gap:.6rem;min-width:180px}a{border:1px solid #3b556c;border-radius:8px;padding:.7rem 1rem;color:#a7f3d0;text-decoration:none;background:#17283b}a:focus-visible{outline:3px solid #6ee7b7}ul{display:flex;flex-wrap:wrap;list-style:none;padding:0;gap:.6rem}li{border:1px solid #334155;background:#162437;border-radius:20px;padding:.5rem .85rem;font-size:.85rem}.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-top:1.5rem}figure{margin:0;background:#162437;border:1px solid #334155;border-radius:14px;overflow:hidden}.cover{grid-column:span 2}img{width:100%;height:230px;object-fit:cover;display:block}figcaption{padding:.8rem;color:#b8c6d9;overflow-wrap:anywhere}@media(max-width:700px){section{padding:1rem}.intro{display:block}nav{margin:1rem 0}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}img{height:150px}.cover img{height:220px}}`]
})
export class VenueInfoComponent {
  brand = inject(BrandingService);
  imageError(event: Event): void { const img = event.target as HTMLImageElement; img.style.display = 'none'; img.parentElement?.setAttribute('aria-label','Venue image unavailable'); }
}
