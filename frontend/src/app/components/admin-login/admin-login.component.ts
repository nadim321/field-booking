import { BrandComponent } from '../venue/brand.component';
import { VenueFooterComponent } from '../venue/venue-footer.component';
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [BrandComponent, VenueFooterComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-login.component.html',
  styleUrl: './admin-login.component.css'
})
export class AdminLoginComponent implements OnInit {
  private apiService = inject(ApiService);
  private router = inject(Router);

  username = '';
  password = '';
  loading = false;
  errorMsg = '';
  demoLoginEnabled = false;
  configLoading = false;

  ngOnInit(): void {
    if (this.apiService.isLoggedIn()) {
      this.router.navigate(['/admin/dashboard']);
      return;
    }
    this.configLoading = true;
    this.apiService.getDemoAdminLoginConfig().subscribe({
      next: config => {
        this.demoLoginEnabled = config.enabled === true;
        if (config.enabled && config.credentials) {
          this.username = config.credentials.username;
          this.password = config.credentials.password;
        }
        this.configLoading = false;
      },
      error: () => { this.configLoading = false; }
    });
  }

  onSubmit(): void {
    if (!this.username || !this.password) {
      this.errorMsg = 'Please enter both username and password';
      return;
    }

    this.loading = true;
    this.errorMsg = '';

    this.apiService.login({ username: this.username, password: this.password }).subscribe({
      next: (res) => {
        this.loading = false;
        this.router.navigate(['/admin/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = err.error?.message || 'Login failed. Check server connection or credentials.';
      }
    });
  }
}
