import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { ApiService } from '../services/api.service';
import { adminGuard } from './admin.guard';

describe('adminGuard', () => {
  for (const loggedIn of [true, false]) {
    it(loggedIn ? 'allows authenticated admins' : 'redirects unauthenticated visitors to login', () => {
      TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ApiService, useValue: { isLoggedIn: () => loggedIn, isDemoAdmin: () => false } }] });
      const result = TestBed.runInInjectionContext(() => adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
      if (loggedIn) expect(result).toBeTrue();
      else expect(TestBed.inject(Router).serializeUrl(result as ReturnType<Router['createUrlTree']>)).toBe('/admin/login');
    });
  }
});
