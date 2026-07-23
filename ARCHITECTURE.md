# KICKOFF ARENA - Turf Booking System Architecture

This document provides a comprehensive overview of the Turf Booking project's architecture, database schema, and component interactions.

## 1. System Architecture

The system follows a standard client-server architecture with an Angular frontend, a Node.js/Express backend, and a MySQL database. It integrates with external services for payments and notifications.

```mermaid
graph TD
    %% Entities
    Client[Customer / Admin Browser]
    
    subgraph "Frontend (Angular)"
        Portal[Booking Portal UI]
        AdminUI[Admin Dashboard UI]
        AuthGuard[Auth Guards]
        APIService[API Service]
    end
    
    subgraph "Backend (Node.js + Express)"
        Router[API Routes]
        AuthService[Auth Service]
        PaymentController[Payment Controller]
        NotificationService[Notification Service]
        PDFService[PDF Service]
        DBWrapper[MySQL DB Wrapper]
    end
    
    subgraph "Database (MySQL)"
        DB[(Turf Booking DB)]
    end
    
    subgraph "External Services"
        SSLCommerz[SSLCommerz Gateway]
        SMTP[Gmail SMTP / Email]
        SMS[SMS Gateway]
    end

    %% Flow
    Client -->|Interacts| Portal
    Client -->|Interacts| AdminUI
    
    Portal --> APIService
    AdminUI --> AuthGuard
    AuthGuard --> APIService
    
    APIService -->|HTTP Requests| Router
    
    Router --> AuthService
    Router --> PaymentController
    Router --> DBWrapper
    
    PaymentController -->|Initiate/Verify| SSLCommerz
    SSLCommerz -->|IPN Webhook| PaymentController
    
    Router --> NotificationService
    NotificationService --> PDFService
    NotificationService --> SMTP
    NotificationService --> SMS
    
    DBWrapper <--> DB
```

## 2. Database Entity-Relationship (ER) Diagram

The database uses MySQL. Below is the ER diagram showing all tables, their primary keys, and relationships.

```mermaid
erDiagram
    USERS {
        int id PK
        varchar username "UNIQUE"
        varchar password
        varchar role "admin"
        timestamp created_at
    }

    SLOTS {
        int id PK
        varchar start_time "HH:MM"
        varchar end_time "HH:MM"
        decimal price
        boolean is_active
        int category
        timestamp created_at
    }

    SLOT_HOLDS {
        int id PK
        int slot_id FK
        varchar booking_date
        varchar session_token
        timestamp expires_at
    }

    SLOT_BLOCKS {
        int id PK
        int slot_id FK
        varchar block_date
        varchar reason
        timestamp created_at
    }

    RECURRING_BOOKINGS {
        int id PK
        varchar customer_name
        varchar customer_phone
        varchar customer_email
        varchar team_name
        date start_date
        date end_date
        int day_of_week
        int slot_id FK
        varchar status "pending, approved, rejected, cancelled"
        timestamp created_at
    }

    BOOKINGS {
        int id PK
        int slot_id FK
        varchar booking_date
        varchar customer_name
        varchar customer_phone
        varchar customer_email
        varchar team_name
        varchar status "pending, approved, cancelled"
        varchar payment_status "paid, unpaid, partially_paid"
        varchar payment_method
        varchar transaction_id
        decimal amount_paid
        int recurring_booking_id FK
        timestamp created_at
    }

    PAYMENT_TRANSACTIONS {
        int id PK
        int booking_id FK
        varchar tran_id "UNIQUE"
        decimal amount
        varchar currency
        varchar status "initiated, valid, failed"
        varchar val_id
        varchar card_type
        varchar bank_tran_id
        text raw_ipn_payload
        timestamp created_at
    }

    APP_SETTINGS {
        varchar setting_key PK
        varchar setting_value
    }

    %% Relationships
    SLOTS ||--o{ SLOT_HOLDS : "has"
    SLOTS ||--o{ SLOT_BLOCKS : "has"
    SLOTS ||--o{ RECURRING_BOOKINGS : "requested in"
    SLOTS ||--o{ BOOKINGS : "booked in"
    
    RECURRING_BOOKINGS ||--o{ BOOKINGS : "generates"
    
    BOOKINGS ||--o{ PAYMENT_TRANSACTIONS : "tracks payments for"
```

## 3. Core Features & Business Logic

1. **Slot Management**:
   - `slots`: Defines the time blocks (e.g., 6:00 PM - 7:00 PM).
   - `slot_holds`: Temporary locking (default 5-10 mins) of a slot when a user clicks it, preventing others from booking it simultaneously.
   - `slot_blocks`: Admin-defined blocks for maintenance, holidays, or tournaments.

2. **Booking Flow**:
   - A user selects a slot, holding it temporarily.
   - They fill out their details and choose "Pay Now" or "Pay Later".
   - A `booking` is created. If "Pay Now" is selected, they are redirected to SSLCommerz.
   - Upon successful payment (`payment_transactions` updated via IPN webhook), the booking is auto-approved.

3. **Season / Recurring Bookings**:
   - Customers request a slot for a specific day of the week over a date range.
   - Admin approves it, generating individual `bookings` for each occurrence.

4. **Notifications & PDFs**:
   - The system triggers SMS and Email notifications on booking creation, approval, and payment success.
   - For confirmed bookings, a PDF slip is generated dynamically and attached to the confirmation email, and is also downloadable from the frontend.
