import { Routes } from '@angular/router';
import { BookingPortalComponent } from './components/booking-portal/booking-portal.component';
import { AdminLoginComponent } from './components/admin-login/admin-login.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';

export const routes: Routes = [
  { path: '', component: BookingPortalComponent },
  { path: 'admin/login', component: AdminLoginComponent },
  { path: 'admin/dashboard', component: AdminDashboardComponent },
  { path: '**', redirectTo: '' }
];
