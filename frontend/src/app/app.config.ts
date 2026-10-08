import { ApplicationConfig, ErrorHandler, provideZoneChangeDetection } from '@angular/core';
import { createErrorHandler } from '@sentry/angular';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    provideHttpClient(),
    { provide: ErrorHandler, useValue: createErrorHandler({ logErrors: true }) }
  ]
};
