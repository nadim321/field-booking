import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingService } from '../../services/branding.service';
@Component({
  selector: 'app-brand', standalone: true, imports: [CommonModule],
  template: `<span class="brand"><img *ngIf="brand.settings()?.turf_logo as logo" [src]="brand.mediaUrl(logo.url)" alt="" (error)="hideImage($event)"><span>{{ brand.name }}</span></span>`,
  styles: [`.brand{display:flex;align-items:center;gap:.65rem;color:#f8fafc;font-weight:800;font-size:1.1rem;overflow-wrap:anywhere}.brand img{width:42px;height:42px;object-fit:contain;flex-shrink:0}`]
})
export class BrandComponent {
  brand = inject(BrandingService);
  hideImage(event: Event): void { (event.target as HTMLImageElement).style.display = 'none'; }
}
