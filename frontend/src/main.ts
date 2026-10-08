import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initializeMonitoring, reportBootstrapError } from './app/observability';

initializeMonitoring();
bootstrapApplication(AppComponent, appConfig).catch(reportBootstrapError);
