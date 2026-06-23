# Frontend

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 18.2.21.

## Development server

Run `ng serve` for a dev server. Navigate to `https://sale.gazipurdrughouse.com/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## cPanel Deployment

আপনার টার্মিনালে নিচের তিনটি কমান্ড পর্যায়ক্রমে রান করুন:

### ১. Angular বিল্ড করুন

```bash
cd ~/Project/Booking/frontend && npm run build
```

### ২. নতুন বিল্ড ফাইল backend/public/ ফোল্ডারে কপি করুন

```bash
rm -rf ~/Project/Booking/backend/public/* && cp -r ~/Project/Booking/frontend/dist/frontend/browser/. ~/Project/Booking/backend/public/
```

### ৩. ZIP তৈরি করুন

```bash
cd ~/Project/Booking && rm -f backend_deploy.zip && zip -r backend_deploy.zip backend/ --exclude "backend/node_modules/*" --exclude "backend/.env" --exclude "backend/*.db" 
```

তৈরি হওয়া `backend_deploy.zip` ফাইলটি cPanel এ আপলোড করে extract করুন।

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.