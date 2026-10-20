import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-admin-password-change',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-password-change.component.html',
  styleUrl: './admin-password-change.component.css'
})
export class AdminPasswordChangeComponent {
  private api = inject(ApiService);
  private router = inject(Router);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  loading = false;
  error = '';

  get passwordsMatch(): boolean {
    return this.newPassword === this.confirmPassword;
  }

  submit(): void {
    if (this.loading || !this.currentPassword || this.newPassword.length < 8 || !this.passwordsMatch) return;
    this.loading = true;
    this.error = '';
    this.api.changeAdminPassword({ currentPassword: this.currentPassword, newPassword: this.newPassword }).subscribe({
      next: () => {
        this.api.logout();
        this.router.navigate(['/admin/login'], { state: { passwordChanged: true } });
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || 'Password could not be changed. Please try again.';
      }
    });
  }
}
