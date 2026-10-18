import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { VenueSettings } from '../../services/venue-settings';
import { timeout } from 'rxjs';
@Component({
  selector: 'app-venue-settings', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './venue-settings.component.html', styleUrl: './venue-settings.component.css'
})
export class VenueSettingsComponent implements OnInit {
  api = inject(ApiService);
  draft: VenueSettings | null = null;
  facilities = '';
  busy = false;
  error = '';
  message = '';
  ngOnInit(): void { this.load(); }
  load(): void {
    this.busy = true; this.error = '';
    this.api.getSettings().pipe(timeout(15000)).subscribe({ next: value => { this.draft = value; this.facilities = value.turf_facilities.join('\n'); this.busy = false; }, error: () => { this.error = 'Settings could not be loaded. Retry before editing.'; this.busy = false; } });
  }
  upload(event: Event, kind: 'logo' | 'photo' | 'share'): void {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (!file || !this.draft) return;
    this.error = ''; this.message = '';
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5*1024*1024) { this.error = 'Choose a JPEG, PNG or WebP image up to 5 MB.'; return; }
    if (kind === 'photo' && this.draft.turf_photos.length >= 8) { this.error = 'You can publish up to 8 field photos.'; return; }
    this.busy = true;
    this.api.uploadMedia(file, kind).pipe(timeout(60000)).subscribe({
      next: media => {
        if (kind === 'logo') { this.draft!.turf_logo = media; this.draft!.turf_logo_id = media.id; }
        else if (kind === 'share') { this.draft!.turf_share_image = media; this.draft!.turf_share_image_id = media.id; }
        else this.draft!.turf_photos.push({ ...media, caption: '' });
        this.busy = false; this.message = 'Image uploaded. Save settings to publish your changes.';
      }, error: e => { this.busy = false; this.error = e.error?.message || 'Upload failed. Please retry.'; }
    });
  }
  move(index: number, delta: number): void {
    const photos = this.draft!.turf_photos;
    [photos[index], photos[index + delta]] = [photos[index + delta], photos[index]];
    this.message = 'Order changed. Save settings to publish.';
  }
  remove(index?: number): void {
    if (index === undefined) { this.draft!.turf_logo = null; this.draft!.turf_logo_id = null; }
    else this.draft!.turf_photos.splice(index,1);
    this.message = 'Image removed from this draft. Save settings to publish.';
  }
  removeShareImage(): void { this.draft!.turf_share_image = null; this.draft!.turf_share_image_id = null; this.message = 'Social share image removed from this draft. Save settings to publish.'; }
  save(): void {
    if (!this.draft || this.busy) return;
    this.busy = true; this.error = ''; this.message = '';
    const { turf_name, turf_address, turf_phone, turf_email, turf_whatsapp, turf_maps_url, turf_description, turf_logo_id, turf_share_image_id, turf_photos } = this.draft;
    this.api.updateSettings({ turf_name, turf_address, turf_phone, turf_email, turf_whatsapp, turf_maps_url, turf_description, turf_logo_id, turf_share_image_id, turf_facilities: this.facilities.split('\n').map(x => x.trim()).filter(Boolean), turf_photos: turf_photos.map(({id,caption}) => ({id,caption})) }).pipe(timeout(15000)).subscribe({
      next: () => { this.busy = false; this.message = 'Settings saved. Your venue details are now published.'; },
      error: e => { this.busy = false; this.error = e.error?.message || 'Save could not be confirmed. Reload settings to check before retrying.'; }
    });
  }
}
