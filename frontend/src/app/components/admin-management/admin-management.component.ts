import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface AdminAccount { id: number; username: string; }

@Component({
  selector: 'app-admin-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-management.component.html',
  styleUrl: './admin-management.component.css'
})
export class AdminManagementComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  admins: AdminAccount[] = [];
  loading = false;
  saving = false;
  error = '';
  notice = '';
  formOpen = false;
  editingId: number | null = null;
  username = '';
  password = '';
  confirmPassword = '';

  ngOnInit(): void { this.load(); }

  get currentAdminId(): number | null {
    try {
      const token = this.api.token;
      if (!token) return null;
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      return Number(JSON.parse(atob(payload)).id);
    } catch { return null; }
  }

  get passwordValid(): boolean {
    return this.editingId === null ? this.password.length >= 8 : !this.password || this.password.length >= 8;
  }

  get passwordsMatch(): boolean { return !this.password || this.password === this.confirmPassword; }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getAdmins().subscribe({
      next: admins => { this.admins = admins; this.loading = false; },
      error: err => { this.error = err.error?.message || 'Admin accounts could not be loaded.'; this.loading = false; }
    });
  }

  openCreate(): void {
    this.resetForm();
    this.formOpen = true;
  }

  openEdit(admin: AdminAccount): void {
    this.resetForm();
    this.editingId = admin.id;
    this.username = admin.username;
    this.formOpen = true;
  }

  closeForm(): void { if (!this.saving) this.resetForm(); }

  submit(): void {
    if (this.saving || !this.username.trim() || !this.passwordValid || !this.passwordsMatch) return;
    this.saving = true;
    this.error = '';
    this.notice = '';
    if (this.editingId === null) {
      this.api.createAdmin({ username: this.username.trim(), password: this.password }).subscribe({
        next: () => { this.saving = false; this.notice = 'Admin account created.'; this.resetForm(); this.load(); },
        error: err => { this.saving = false; this.error = err.error?.message || 'Admin account could not be created.'; }
      });
      return;
    }

    const id = this.editingId;
    const update = { username: this.username.trim(), ...(this.password ? { password: this.password } : {}) };
    this.api.updateAdmin(id, update).subscribe({
      next: result => {
        this.saving = false;
        if (result.reauthentication_required) {
          this.api.logout();
          void this.router.navigate(['/admin/login'], { state: { passwordChanged: true } });
          return;
        }
        this.notice = 'Admin account updated.';
        this.resetForm();
        this.load();
      },
      error: err => { this.saving = false; this.error = err.error?.message || 'Admin account could not be updated.'; }
    });
  }

  remove(admin: AdminAccount): void {
    if (!window.confirm(`Delete admin "${admin.username}"? This cannot be undone.`)) return;
    this.error = '';
    this.notice = '';
    this.api.deleteAdmin(admin.id).subscribe({
      next: result => {
        if (result.deleted_id === this.currentAdminId) {
          this.api.logout();
          void this.router.navigate(['/admin/login']);
          return;
        }
        this.notice = 'Admin account deleted.';
        this.load();
      },
      error: err => { this.error = err.error?.message || 'Admin account could not be deleted.'; }
    });
  }

  private resetForm(): void {
    this.formOpen = false;
    this.editingId = null;
    this.username = '';
    this.password = '';
    this.confirmPassword = '';
  }
}
