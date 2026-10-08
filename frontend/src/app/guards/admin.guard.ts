import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from '../services/api.service';

export const adminGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  return api.isLoggedIn() || inject(Router).createUrlTree(['/admin/login']);
};
