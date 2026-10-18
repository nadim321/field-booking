import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { timeout } from 'rxjs';

interface SlotConfig {
  id: number;
  start_time: string;
  end_time: string;
  price: number;
  is_active: number;
  category: number | null;
}

// Canonical category mapping, kept in sync with backend/constants/slot-categories.js.
// Category is always assigned manually by the admin -- never auto-derived
// from start_time. These hour ranges are only the business's general
// intent for each label, shown here as a guide in the dropdown.
const SLOT_CATEGORIES: { id: number; label: string; hint: string }[] = [
  { id: 1, label: 'Morning', hint: '6:00 AM - 12:00 PM' },
  { id: 2, label: 'Afternoon', hint: '12:00 PM - 4:00 PM' },
  { id: 3, label: 'Evening', hint: '4:00 PM - 7:00 PM' },
  { id: 4, label: 'Night', hint: '7:00 PM - 12:00 AM' },
  { id: 5, label: 'Midnight', hint: '12:00 AM - 6:00 AM' }
];
const CATEGORY_LABEL_BY_ID: Record<number, string> = SLOT_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: c.label }),
  {} as Record<number, string>
);

@Component({
  selector: 'app-slot-setup', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './slot-setup.component.html',
  styleUrls: ['../admin-dashboard/admin-dashboard.component.css', './slot-setup.component.css']
})
export class SlotSetupComponent implements OnInit {
  private apiService = inject(ApiService);
  private router = inject(Router);
  loading = false;
  errorMsg = '';
  toastMsg = '';
  toastType: 'success' | 'error' | '' = '';
  advancePercentage: number | null = null;
  advanceBusy = false;
  advanceError = '';
  advanceMessage = '';
  ngOnInit(): void { this.loadSlots(); this.loadAdvance(); }
  loadAdvance(): void {
    this.advanceBusy = true; this.advanceError = ''; this.advanceMessage = '';
    this.apiService.getSettings().pipe(timeout(15000)).subscribe({
      next: settings => { this.advancePercentage = settings.advance_payment_percentage; this.advanceBusy = false; },
      error: () => { this.advanceBusy = false; this.advanceError = 'Could not load advance payment settings. Retry before saving.'; }
    });
  }
  saveAdvance(): void {
    if (this.advanceBusy || this.advancePercentage === null) return;
    if (!Number.isFinite(this.advancePercentage) || this.advancePercentage <= 0 || this.advancePercentage > 100) { this.advanceError = 'Enter a percentage greater than 0 and up to 100.'; return; }
    this.advanceBusy = true; this.advanceError = ''; this.advanceMessage = '';
    this.apiService.updateSettings({ advance_payment_percentage: this.advancePercentage }).pipe(timeout(15000)).subscribe({
      next: () => { this.advanceBusy = false; this.advanceMessage = 'Advance payment setting saved.'; },
      error: err => { this.advanceBusy = false; this.advanceError = err.error?.message || 'Save could not be confirmed. Reload settings before retrying.'; }
    });
  }
  // Slots Configuration Data
  slots: SlotConfig[] = [];
  readonly slotCategories = SLOT_CATEGORIES; // exposed for the template dropdown

  // Create/Edit Slot Modal state
  showSlotModal = false;
  editingSlotId: number | null = null; // null if creating
  slotStartTime = '';
  slotEndTime = '';
  slotPrice = 1000;
  slotIsActive = 1;
  slotCategory: number | null = null; // null = "Uncategorized", admin always picks manually

  loadSlots(): void {
    this.apiService.getAdminSlots().subscribe({
      next: (res) => {
        this.slots = res;
      },
      error: (err) => {
        this.handleError(err);
      }
    });
  }

  // --- Slot Template Operations ---
  openAddSlotModal(): void {
    this.editingSlotId = null;
    this.slotStartTime = '';
    this.slotEndTime = '';
    this.slotPrice = 1000;
    this.slotIsActive = 1;
    this.slotCategory = null; // blank by default -- admin always picks manually
    this.showSlotModal = true;
  }

  openEditSlotModal(slot: SlotConfig): void {
    this.editingSlotId = slot.id;
    this.slotStartTime = slot.start_time;
    this.slotEndTime = slot.end_time;
    this.slotPrice = slot.price;
    this.slotIsActive = slot.is_active;
    this.slotCategory = slot.category;
    this.showSlotModal = true;
  }

  closeSlotModal(): void {
    this.showSlotModal = false;
  }

  categoryLabel(category: number | null | undefined): string {
    if (category === null || category === undefined) return 'Uncategorized';
    return CATEGORY_LABEL_BY_ID[category] || 'Uncategorized';
  }

  saveSlotConfig(): void {
    if (!this.slotStartTime || !this.slotEndTime || this.slotPrice === undefined) {
      this.showToast('All fields are required', 'error');
      return;
    }

    const slotData: any = {
      start_time: this.slotStartTime,
      end_time: this.slotEndTime,
      price: this.slotPrice,
      is_active: this.slotIsActive
    };

    // category is only sent when explicitly set; if the admin cleared it
    // back to "Uncategorized" on an edit, tell the backend to actually
    // clear it (plain `category: null` would be ignored by the backend's
    // COALESCE-based update -- see server.js for why).
    if (this.slotCategory !== null) {
      slotData.category = this.slotCategory;
    } else if (this.editingSlotId !== null) {
      slotData.category_clear = true;
    }

    this.loading = true;
    if (this.editingSlotId !== null) {
      this.apiService.updateSlot(this.editingSlotId, slotData).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Slot configuration updated', 'success');
          this.closeSlotModal();
          this.loadSlots();
        },
        error: (err) => {
          this.loading = false;
          this.showToast(err.error?.message || 'Failed to update slot', 'error');
        }
      });
    } else {
      this.apiService.createSlot(slotData).subscribe({
        next: () => {
          this.loading = false;
          this.showToast('Slot configuration added', 'success');
          this.closeSlotModal();
          this.loadSlots();
        },
        error: (err) => {
          this.loading = false;
          this.showToast(err.error?.message || 'Failed to create slot', 'error');
        }
      });
    }
  }

  toggleSlotActive(slot: SlotConfig): void {
    const updatedStatus = slot.is_active === 1 ? 0 : 1;
    this.apiService.updateSlot(slot.id, { is_active: updatedStatus }).subscribe({
      next: () => {
        this.showToast(`Slot is now ${updatedStatus === 1 ? 'Active' : 'Blocked'}`, 'success');
        this.loadSlots();
      },
      error: (err) => {
        this.showToast('Failed to update status', 'error');
      }
    });
  }

  deleteSlotConfig(id: number): void {
    if (!confirm('Are you sure you want to delete this slot template? Existing slot bookings for this hour might be orphaned.')) return;
    this.loading = true;
    this.apiService.deleteSlot(id).subscribe({
      next: () => {
        this.loading = false;
        this.showToast('Slot template deleted', 'success');
        this.loadSlots();
      },
      error: (err) => {
        this.loading = false;
        this.showToast(err.error?.message || 'Failed to delete slot configuration', 'error');
      }
    });
  }

  // --- Helpers ---
  handleError(err: any): void {
    console.error(err);
    if (err.status === 401 || err.status === 403) {
      this.showToast('Session expired. Please log in again.', 'error');
      this.apiService.logout();
      this.router.navigate(['/admin/login']);
    } else {
      this.errorMsg = err.error?.message || 'A network error occurred. Please check backend connection.';
      this.showToast(this.errorMsg, 'error');
    }
  }

  showToast(message: string, type: 'success' | 'error'): void {
    this.toastMsg = message;
    this.toastType = type;
    setTimeout(() => {
      this.toastMsg = '';
      this.toastType = '';
    }, 4000);
  }

}
