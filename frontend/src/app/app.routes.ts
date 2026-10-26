import { adminGuard } from './guards/admin.guard';
import { Routes } from '@angular/router';
import { BookingPortalComponent } from './components/booking-portal/booking-portal.component';
import { AdminLoginComponent } from './components/admin-login/admin-login.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { SeasonBookingComponent } from './components/season-booking/season-booking.component';
import { CustomerLoginComponent } from './components/customer-login/customer-login.component';
import { MyBookingsComponent } from './components/my-bookings/my-bookings.component';
import { customerGuard } from './guards/customer.guard';

export const routes: Routes = [
  { path: '', component: BookingPortalComponent },
  { path: 'admin/login', component: AdminLoginComponent },
  { path: 'admin/dashboard', component: AdminDashboardComponent, canActivate: [adminGuard], children: [
    { path: 'collections', canActivate: [adminGuard], loadComponent: () => import('./components/collections/collections.component').then(m => m.CollectionsComponent) },
    { path: 'operations', canActivate: [adminGuard], loadComponent: () => import('./components/operations/operations.component').then(m => m.OperationsComponent) },
    { path: 'daily-closing', canActivate: [adminGuard], loadComponent: () => import('./components/daily-closing/daily-closing.component').then(m => m.DailyClosingComponent) },
    { path: 'notifications', canActivate: [adminGuard], loadComponent: () => import('./components/notifications/notifications.component').then(m => m.NotificationsComponent) },
    { path: 'change-password', canActivate: [adminGuard], loadComponent: () => import('./components/admin-password-change/admin-password-change.component').then(m => m.AdminPasswordChangeComponent) },
    { path: 'admins', canActivate: [adminGuard], loadComponent: () => import('./components/admin-management/admin-management.component').then(m => m.AdminManagementComponent) },
    { path: 'field-configuration', canActivate: [adminGuard], loadComponent: () => import('./components/venue/venue-settings.component').then(m => m.VenueSettingsComponent) },
    { path: 'slot-setup', canActivate: [adminGuard], loadComponent: () => import('./components/slot-setup/slot-setup.component').then(m => m.SlotSetupComponent) }
  ] },
  { path: 'season-booking', component: SeasonBookingComponent },
  { path: 'customer/login', component: CustomerLoginComponent },
  { path: 'my-bookings', component: MyBookingsComponent, canActivate: [customerGuard] },
  { path: '**', redirectTo: '' }   // wildcard must always be LAST
];
