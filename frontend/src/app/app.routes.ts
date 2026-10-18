import { adminGuard } from './guards/admin.guard';
import { Routes } from '@angular/router';
import { BookingPortalComponent } from './components/booking-portal/booking-portal.component';
import { AdminLoginComponent } from './components/admin-login/admin-login.component';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { SeasonBookingComponent } from './components/season-booking/season-booking.component';

export const routes: Routes = [
  { path: '', component: BookingPortalComponent },
  { path: 'admin/login', component: AdminLoginComponent },
  { path: 'admin/dashboard', component: AdminDashboardComponent, canActivate: [adminGuard], children: [
    { path: 'collections', canActivate: [adminGuard], loadComponent: () => import('./components/collections/collections.component').then(m => m.CollectionsComponent) },
    { path: 'notifications', canActivate: [adminGuard], loadComponent: () => import('./components/notifications/notifications.component').then(m => m.NotificationsComponent) },
    { path: 'field-configuration', canActivate: [adminGuard], loadComponent: () => import('./components/venue/venue-settings.component').then(m => m.VenueSettingsComponent) },
    { path: 'slot-setup', canActivate: [adminGuard], loadComponent: () => import('./components/slot-setup/slot-setup.component').then(m => m.SlotSetupComponent) }
  ] },
  { path: 'season-booking', component: SeasonBookingComponent },
  { path: '**', redirectTo: '' }   // wildcard must always be LAST
];