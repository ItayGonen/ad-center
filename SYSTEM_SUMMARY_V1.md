# Leads DOOH Booking Platform — System Summary v1.0.0

> **Document Purpose:** A complete overview of the Leads Digital Out-of-Home (DOOH) advertising booking platform — what it does, how it works, and what each part of the system is responsible for. Written to be understandable by both technical and non-technical readers.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [User Types & Permissions](#2-user-types--permissions)
3. [Registration & Login](#3-registration--login)
4. [Browsing Advertising Spaces](#4-browsing-advertising-spaces)
5. [Booking Flow (Step-by-Step)](#5-booking-flow-step-by-step)
6. [Campaigns — Multi-Space Bookings](#6-campaigns--multi-space-bookings)
7. [My Orders — User Order Management](#7-my-orders--user-order-management)
8. [Admin Panel](#8-admin-panel)
9. [Admin Calendar](#9-admin-calendar)
10. [Partner Dashboard](#10-partner-dashboard)
11. [Notifications System](#11-notifications-system)
12. [Automated Processes](#12-automated-processes)
13. [Payment Proof Handling](#13-payment-proof-handling)
14. [Email System](#14-email-system)
15. [Integrations](#15-integrations)
16. [Booking Lifecycle Diagram](#16-booking-lifecycle-diagram)
17. [Translation & Language Support](#17-translation--language-support)
18. [Settings & Preferences](#18-settings--preferences)
19. [Technical Architecture Summary](#19-technical-architecture-summary)

---

## 1. System Overview

### What Is Leads?

Leads is a **Digital Out-of-Home (DOOH) advertising booking platform**. It allows businesses and advertisers to browse physical advertising locations (digital screens in malls, bus stops, office buildings, etc.), select specific dates and time slots, upload their creative content (images/videos), and book those screens for advertising.

### Main Purpose

The platform connects **space owners** (partners who own advertising screens) with **advertisers** (users who want to display ads). An admin manages the entire ecosystem — approving bookings, managing spaces, sending notifications, and overseeing the calendar.

### General Workflow

```
Advertiser browses spaces → Selects dates & hours → Submits booking order
      → Admin reviews order → Admin approves/confirms with payment proof
           → Advertiser's content plays on the screen during booked times
```

### Key Capabilities

- Browse and search advertising spaces with filters (location, price, audience type)
- View spaces on an interactive map
- Book specific time slots on specific dates
- Create multi-space campaigns (book the same ad on many screens at once)
- Upload creative assets (images, videos) per booking
- Full admin panel for managing users, spaces, orders, and settings
- Partner dashboard for space owners to track their spaces and revenue
- Real-time notification system
- Bilingual support (English and Hebrew with RTL layout)

---

## 2. User Types & Permissions

The system has three user roles, each with different levels of access:

### Regular User (Advertiser)

| What They Can Do | Description |
|---|---|
| Browse spaces | View all available advertising locations, filter by type, price, audience |
| View space details | See photos, operating hours, screen specs, audience profiles, map location |
| Book spaces | Select dates, hours, and submit orders |
| Create campaigns | Book multiple spaces under one campaign |
| Upload creatives | Upload images/videos for their booked orders |
| Manage orders | View, edit, cancel their own orders |
| View order timeline | See the history of each order (created, approved, confirmed, etc.) |
| Receive notifications | Get notified about order status changes and admin broadcasts |
| Update profile | Change name, email, phone, company, password, language, avatar |
| Adjust notification preferences | Enable/disable specific notification types |

### Partner (Space Owner)

| What They Can Do | Description |
|---|---|
| Everything a regular user can do | Partners can also book spaces if they want |
| Partner Dashboard | View stats: total spaces, orders, revenue, monthly breakdown |
| View their spaces | See all spaces they own |
| View orders for their spaces | Track who is booking their screens |
| Revenue tracking | Monthly revenue reports and earnings overview |
| Public profile | Other users can view their partner profile and spaces |

### Admin (System Administrator)

| What They Can Do | Description |
|---|---|
| Manage users | Create, edit, delete users; change roles; upload avatars |
| Manage spaces | Create, edit, delete advertising spaces; add images, screens, operating hours |
| Manage orders | View all orders; change statuses; confirm with payment proof; delete orders |
| Manage campaigns | Approve or delete campaigns; batch-confirm campaign orders |
| Calendar view | See all bookings across all spaces on a weekly calendar |
| Send notifications | Broadcast notifications to all users (info, warning, promotion, system update) |
| Manage translations | Edit UI text translations for English and Hebrew |
| Manage space types | Add/remove space categories (e.g., "Mall Screen", "Bus Shelter") |
| Manage audience profiles | Add/remove audience demographics (e.g., "Young Adults", "Families") |
| System settings | Enable/disable email sending system-wide |

---

## 3. Registration & Login

### Registration Methods

1. **Email Registration**
   - User provides: Full name, email address, password (with confirmation)
   - After registration, the user is redirected to a **Complete Profile** page

2. **Google Sign-In**
   - One-click registration/login via Google account
   - If the user is new, they are redirected to the Complete Profile page

### Complete Profile (Required Step)

After registering (via email or Google), every new user must complete their profile before using the platform:

- **Full Name** (pre-filled from registration)
- **Phone Number** — Split into Israeli prefix (050, 052, 053, etc.) + local number
- **Company Name** (required)
- **Preferred Language** — English or Hebrew

The system will not let users access the main features until this step is completed.

### Login

- Email + password, or Google sign-in
- Session is managed via a secure httpOnly cookie (not stored in the browser's visible storage)
- Sessions last 24 hours

---

## 4. Browsing Advertising Spaces

### Spaces Grid (Home Page)

The home page displays all available advertising spaces in a card grid. Each card shows:
- Space photo (cover image)
- Space name
- Space type (e.g., "Digital Billboard", "Mall Screen")
- City
- Price per day
- Estimated daily impressions (if available)

### Filters Available

| Filter | Options |
|---|---|
| Space Type | Dropdown of all space categories (e.g., Mall, Billboard, Bus Stop) |
| Price Range | 0–20 ₪/day, 20–40 ₪/day, 40+ ₪/day |
| Audience Profiles | Multi-select grouped by category: Demographic, Lifestyle, Behavior/Context |
| Search | Text search in the top bar |

### Map View

An interactive Google Map shows all spaces plotted as location markers. Clicking a marker shows a preview card with the space's details. The same filters (type, price, audience) can be applied on the map.

### Space Detail Page

Clicking on a space opens a detailed page with:
- **Image carousel** (swipeable on mobile) with multiple photos
- **Description** of the advertising space
- **Operating hours** — which days and hours the space is available
- **Screen specifications** — size, resolution, position description
- **Audience profiles** — which demographics the space reaches
- **Daily impressions** — estimated number of people who see the screen
- **Location on Google Map** with exact coordinates
- **Partner info** — who owns the space, with a link to their public profile
- **"Book Now" button** — starts the booking flow

---

## 5. Booking Flow (Step-by-Step)

The booking flow is a multi-step guided process for creating an order on a specific advertising space.

### Step 1: Select Dates & Booking Type

- The user sees a **calendar** showing the available dates
- They pick a **start date** and **end date** for their booking
- The system shows an **availability visualization** — for each hour of each day, the user can see how many slots are already booked out of the maximum 6 per hour
- The booking type is set (currently "long term" by default)

### Step 2: Select Schedule (Days & Hours)

- Within the selected date range, the user picks **which specific days** they want
- For each day, they choose **time ranges** (e.g., 09:00–12:00, 14:00–18:00)
- Time slots are aligned to **10-minute intervals**
- The system checks availability in real-time — each hour can hold a maximum of **6 concurrent bookings** (6 different ads can play in rotation during the same hour)
- If slots are full, the time range will show as unavailable

### Step 3: Review & Confirm

- The user sees a **summary** of their order:
  - Space name and location
  - Selected dates and hours
  - **Total cost** (automatically calculated based on hours booked × daily rate)
  - A unique **reference number** (e.g., `ORD-A1B2C3D4`)
- They can:
  - Add **notes** for the admin
  - **Upload creative assets** — images or videos that will be displayed on the screen
  - Optionally assign the order to a **campaign** or create a new one
- They click **"Submit Order"** to finalize

### Step 4: Order Submitted

- The order is created with status **"Pending"**
- The user receives a **notification** confirming their order was placed
- An **email** is sent to the user with the order details (if email sending is enabled)
- An email is also sent to the **admin** notifying them of the new order
- The user can now see this order on their **"My Orders"** page

### How Price Is Calculated

The total cost is based on the number of hours booked multiplied by the space's daily rate, distributed across the actual hours selected. The exact calculation happens server-side to prevent manipulation.

---

## 6. Campaigns — Multi-Space Bookings

A **campaign** is a way to group multiple bookings across different spaces under one umbrella. This is useful when an advertiser wants the same ad displayed on screens in multiple locations.

### How Campaigns Work

1. **Create a Campaign:**
   - The user goes to the "Create Campaign" page
   - They see a grid of all available spaces with filters
   - They select multiple spaces they want to advertise on
   - A map view shows the selected locations

2. **Book Each Space:**
   - For the first selected space, the user goes through the normal booking flow
   - A campaign is automatically created with a name like "Campaign #1"
   - The first order becomes the campaign's primary order

3. **Add More Spaces:**
   - From within the booking flow or the My Orders page, the user can **duplicate** an order to another compatible space
   - The system checks **schedule compatibility** — whether the same time slots are available on the target space
   - Compatible spaces show as "Full" (all slots available), "Partial" (some slots conflict), or "None" (no availability)
   - Creative assets can be automatically copied to new orders in the same campaign

4. **Campaign Management:**
   - All orders in a campaign are grouped together in the My Orders page
   - The admin can **approve an entire campaign** at once (instead of order by order)
   - Cancelling a campaign cancels all its pending/approved orders

---

## 7. My Orders — User Order Management

The **My Orders** page is where users track all their bookings.

### Order Phases (Tabs)

Orders are organized into tabs based on their current state:

| Tab | What It Shows |
|---|---|
| **Completed** | Orders that have finished (the booking dates have passed and it was confirmed) |
| **Active** | Orders currently running — the ad is live right now. Shows a progress bar |
| **Approved** | Orders approved by admin, awaiting payment confirmation |
| **Upcoming** | Confirmed orders that haven't started yet. Shows a countdown timer |
| **Cancelled** | Orders that were cancelled by the user, admin, or the system |

### For Each Order, the User Sees:

- **Reference number** (e.g., `ORD-A1B2C3D4`)
- **Space name** and location
- **Date range** (start – end)
- **Total cost**
- **Status badge** (color-coded: green for confirmed, amber for approved, red for cancelled, etc.)
- **Countdown timer** (for upcoming orders) or **progress bar** (for active orders)

### Actions Available:

| Action | When Available |
|---|---|
| **View Timeline** | Always — see the full history of the order (created → approved → confirmed → ...) |
| **Edit Order** | Only when status is "Pending" — can change dates and schedule |
| **Cancel Order** | When status is "Pending" or "Approved" — frees up the time slots |
| **Upload Creatives** | Any time — add/remove images and videos |
| **Duplicate to Space** | Create a copy of this order on a different space (for campaigns) |

### Campaign Orders

Orders that belong to a campaign are grouped together visually, showing the campaign name and all related orders underneath.

---

## 8. Admin Panel

The admin panel is a comprehensive management interface accessible only to users with the Admin role.

### 8.1 User Management (`/admin/users`)

- **Table view** of all registered users with columns: ID, Avatar, Name, Email, Phone, Company, Created Date, Role
- **Create User** button opens a form: Name, Email, Password, Role (User/Admin/Partner), Company (optional), Avatar (optional)
- **Change Role** — dropdown on each user row to switch between User, Admin, Partner
- **Delete User** — with confirmation dialog

### 8.2 Space Management (`/admin/spaces`)

- **Table view** of all spaces with search
- **Create/Edit Space** — a comprehensive form with sections:

| Section | Fields |
|---|---|
| **Basic Info** | Space name, description (English + Hebrew tabs) |
| **Location** | City, full address, latitude, longitude |
| **Details** | Price per day, space type, environment (indoor/outdoor), daily impressions, dwell time |
| **Audience** | Multi-select audience profiles (demographics, lifestyle, behavior) |
| **Images** | Upload multiple images via drag-drop; first image = cover; reorder/delete |
| **Operating Hours** | Day-by-day schedule (Sunday–Saturday), start/end times per day |
| **Screens** | Add individual screens with name, size (inches), resolution (width × height), position description, active toggle |

- **Partner Assignment** — optionally assign a space to a partner (space owner)
- **Translation Support** — each space's name, description, city, address can be translated to Hebrew

### 8.3 Order Management (`/admin/orders`)

- All orders displayed, grouped by campaign where applicable
- **Campaign groups** show: campaign name, number of orders, total cost, payment proof (if uploaded)
- **Per-order actions:**
  - Change status via dropdown: Pending → Approved → Confirmed → Completed (or Cancelled)
  - Upload **payment proof** when confirming
  - View uploaded **creative assets**
  - View **order timeline**
  - Delete order
- **Campaign-level actions:**
  - **Approve Campaign** — batch-approve all pending orders with payment proof
  - **Delete Campaign** — removes the campaign and all its orders

### 8.4 Notification Broadcasting (`/admin/notifications`)

- Send a notification to **all registered users**
- Choose notification type: Info, Warning, Promotion, System Update
- Each type has a distinct color:
  - Info = Blue
  - Warning = Amber
  - Promotion = Purple
  - System Update = Gray
- Write a title and message (max 500 characters)
- Preview how the notification will look
- Confirmation dialog before sending
- Shows count of users who received the notification

### 8.5 Translation Management (`/admin/translations`)

Three tabs:

1. **UI Strings** — Edit the text labels used throughout the app (buttons, headers, messages) for both English and Hebrew. Organized by namespace (common, auth, spaces, orders, settings, admin).
2. **Location Types** — Manage the categories of advertising spaces (e.g., "Mall Screen", "Billboard"). Add/delete types with English and Hebrew names.
3. **Audience Types** — Manage audience demographics (e.g., "Young Adults 18–25", "Families with Children"). Add/delete with category assignment and translations.

### 8.6 System Settings (`/admin/settings`)

- **Email Sending Toggle** — Enable or disable all system emails globally. When disabled, a warning banner appears: "No emails will be sent for orders or campaigns."

---

## 9. Admin Calendar

The Admin Calendar (`/admin/calendar`) provides a **weekly view** of all bookings across all spaces.

### Layout

- **Rows:** Hours of the day (based on operating hours)
- **Columns:** Days of the week (7 days displayed)
- **Cells:** Show the number of bookings per hour slot (e.g., "3/6" means 3 out of 6 maximum slots are booked)

### Features

| Feature | Description |
|---|---|
| **Week navigation** | Previous/Next week buttons, "Today" button to jump to current week |
| **Filter by space** | Dropdown to show only a specific space's bookings |
| **Filter by type** | Show only "Spotlight" or "Long Term" bookings |
| **Slot details** | Click on a time slot to expand and see: order reference, user name, space name, status, cost |
| **Visual indicators** | Cells are color-coded based on how full they are |

### What the Admin Can See Per Slot

When clicking on a booked slot, the admin sees:
- Order reference number
- User who made the booking
- Space name
- Order status (pending, approved, confirmed, etc.)
- Total cost
- Booking type

---

## 10. Partner Dashboard

Partners (space owners) have their own dashboard at `/partner/dashboard`.

### Dashboard Stats

| Metric | Description |
|---|---|
| Total Spaces | Number of spaces the partner owns |
| Total Orders | Number of bookings across all their spaces |
| Total Revenue | Sum of all confirmed order costs for their spaces |
| Partner Revenue Share | Calculated earnings for the partner |
| Pending Orders | Orders awaiting approval |
| Confirmed Orders | Active/upcoming confirmed orders |

### Dashboard Content

- **Recent orders table** — latest bookings on partner's spaces
- **Tabbed order view** — Pending, Upcoming, Active, Completed, Cancelled
- **Monthly revenue chart** — Revenue breakdown by month
- **Spaces list** — All spaces owned by this partner with links to details

### Public Partner Profile

Each partner has a public profile page (`/partner/:id`) visible to all users, showing:
- Partner name and company
- Profile picture
- "Verified Partner" badge
- Grid of all their advertising spaces

---

## 11. Notifications System

### How Notifications Work

- A **bell icon** in the top navigation bar shows the notification count
- Clicking it opens a **dropdown panel** with recent notifications
- Notifications are **polled every 10 seconds** (the app checks for new ones automatically)

### Notification Types

| Type | Trigger | Color |
|---|---|---|
| **Order Created** | User places a new booking | Blue |
| **Order Approved** | Admin approves a pending order | Amber |
| **Order Confirmed** | Admin confirms order with payment proof | Green |
| **Order Cancelled** | User, admin, or system cancels an order | Red |
| **Order Completed** | Order booking period ends | Green |
| **Admin Broadcast — Info** | Admin sends an informational notification | Blue |
| **Admin Broadcast — Warning** | Admin sends a warning | Amber |
| **Admin Broadcast — Promotion** | Admin sends a promotional message | Purple |
| **Admin Broadcast — System Update** | Admin sends a system update notification | Gray |

### Notification Features

- Each notification shows a **color bar** on the left matching its type
- Unread notifications have a **colored dot** and slightly different background
- Admin broadcast notifications show a **type badge** (e.g., "WARNING", "PROMOTION")
- Users can:
  - Click a notification to navigate to the related order
  - **Mark all as read**
  - **Clear all notifications**
- Users can control which notification types they receive (in Settings → Notifications)

---

## 12. Automated Processes

### Auto-Cancel Pending Orders

The system runs a **background process** that automatically cancels orders that remain in "Pending" status for too long (specifically, orders whose start date has passed without being confirmed).

**How it works:**
1. A background loop runs continuously on the server
2. It checks for orders where: status = "Pending" AND start date < today
3. Those orders are automatically cancelled
4. Time slots are freed up for other bookings
5. A notification is sent to the user: "Your order was automatically cancelled — it was not confirmed before the start date"

### Automatic Notifications

The system automatically creates notifications at key moments:
- When a user creates an order
- When an admin approves an order
- When an admin confirms an order
- When an order is cancelled (by user, admin, or auto-cancel)
- When an order is completed

Each notification respects the user's **notification preferences** — if a user has disabled a specific type, they won't receive it.

---

## 13. Payment Proof Handling

Payment proof is how the admin verifies that payment has been received for a booking.

### Workflow

1. A user submits an order → status becomes **"Pending"**
2. The admin reviews the order in the Admin Orders page
3. To confirm the order, the admin must **upload payment proof** (a receipt, screenshot of payment, etc.)
4. A modal opens with a file upload area (drag-drop or click to browse)
5. Accepted formats: **JPEG, PNG, WebP** — maximum **10MB**
6. After uploading, the order status changes to **"Confirmed"**
7. The payment proof image is stored on the server
8. The proof is visible as a **thumbnail** in the admin orders list

### Campaign Payment Proof

For campaigns (multiple orders grouped together), the admin can upload proof once at the campaign level, and it applies to all orders in that campaign.

### Where Payment Proof Is Visible

- In the **Admin Orders page**: as a small thumbnail next to the campaign header or individual order
- Clicking the thumbnail opens the full image in a new tab
- The proof URL is stored in the database as `payment_proof_url` on the order record

---

## 14. Email System

The platform sends automated emails using **Amazon SES** (Simple Email Service).

### Emails Sent

| Email | When | To Whom |
|---|---|---|
| **Booking Created** | A new order is submitted | User (order confirmation) + Admin (notification) |
| **Campaign Created** | A campaign with orders is finalized | User (campaign summary) + Admin (notification) |
| **Booking Confirmed** | Admin confirms an order with payment proof | User (confirmation with details) |

### Email Controls

- The admin can **enable or disable** all emails from the Admin Settings page
- When emails are disabled, a warning banner shows across the admin panel
- Even when emails are disabled, **in-app notifications** still work — only the email channel is affected

### Email Content

Emails include:
- Order reference number
- Space name and location
- Booking dates and time slots
- Total cost
- Order status

---

## 15. Integrations

### Google OAuth 2.0

- **Purpose:** Allow users to sign up and log in with their Google account
- **How it works:** The user clicks "Sign in with Google" → Google provides a credential token → the backend verifies it → creates or finds the user → returns a session
- **Library used:** `@react-oauth/google` (frontend), `google-auth` (backend)

### Google Maps API

- **Purpose:** Display advertising spaces on an interactive map; show location on space detail pages
- **Where used:**
  - Map View page — all spaces plotted as markers
  - Space Detail page — single space location with marker
  - Create Campaign page — selected spaces on map
- **Library used:** `@react-google-maps/api`

### Amazon SES (Simple Email Service)

- **Purpose:** Send transactional emails (order confirmations, campaign notifications)
- **Region:** `eu-north-1`
- **Sender:** `no-reply@leadsadv.com`
- **Features:** Rate-limited; admin can toggle on/off; sandbox mode support

### Database: MySQL

- **Purpose:** Store all application data (users, spaces, orders, notifications, etc.)
- **Connection:** Via SQLAlchemy ORM with PyMySQL driver
- **Migrations:** Managed by Alembic (version-controlled database schema changes)

---

## 16. Booking Lifecycle Diagram

Below is the complete journey of a booking from start to finish:

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOOKING LIFECYCLE                             │
└─────────────────────────────────────────────────────────────────┘

  USER                          SYSTEM                        ADMIN
  ────                          ──────                        ─────

  1. Browse Spaces
     │
  2. Select a Space
     │
  3. Choose Dates & Hours
     │
  4. Review & Submit Order
     │
     ├──────────────────► Order Created (status: PENDING)
     │                         │
     │                    Notification sent to user
     │                    Email sent to user + admin
     │                         │
     │                         │ ◄─────────── 5. Admin Reviews Order
     │                         │
     │              ┌──────────┴──────────┐
     │              │                     │
     │        6a. Admin Approves    6b. Admin Cancels
     │         (status: APPROVED)    (status: CANCELLED)
     │              │                     │
     │         Notification          Notification
     │         sent to user          sent to user
     │              │                     │
     │              │                     └──── END (Cancelled)
     │              │
     │         7. Admin Confirms
     │            + Uploads Payment Proof
     │            (status: CONFIRMED)
     │              │
     │         Notification + Email
     │         sent to user
     │              │
     │         ┌────┴────┐
     │         │         │
     │    8a. Booking   8b. User/Admin
     │    Period Starts  Cancels Before Start
     │    (status:       (status: CANCELLED)
     │     CONFIRMED)         │
     │         │              └──── END (Cancelled)
     │         │
     │    9. Booking Period Ends
     │       (status: COMPLETED)
     │         │
     │    Notification sent to user
     │         │
     │         └──── END (Completed Successfully)
     │
     │
     │  ── AUTO-CANCEL PATH ──
     │
     │  If order stays PENDING past its start date:
     │    → System auto-cancels the order
     │    → Time slots are freed
     │    → Notification sent to user
     │    → END (Auto-Cancelled)

```

### Status Flow Summary

```
PENDING ──► APPROVED ──► CONFIRMED ──► COMPLETED
   │            │             │
   │            │             └──► CANCELLED
   │            └──────────────► CANCELLED
   └───────────────────────────► CANCELLED (manual or auto)
```

### Time Slot System Explained

Each advertising space can show **up to 6 different ads per hour** (rotating in 10-minute slots). This means:

- **Hour 09:00–10:00** can have up to **6 different bookings**
- If only 2 are booked, there are **4 remaining slots**
- The system tracks this with a unique position number (1–6) per hour
- When an order is cancelled, its positions are released and become available again

### What Happens at Each Step

| Step | What Happens Behind the Scenes |
|---|---|
| **Order Created** | Time slots are reserved (positions claimed); reference number generated; notification + email sent |
| **Order Approved** | Status updated; notification sent to user |
| **Order Confirmed** | Payment proof saved; status updated; confirmation email sent to user |
| **Order Cancelled** | Time slots released (positions freed); notification sent; if campaign order, campaign updated |
| **Order Completed** | Triggered after the booking end date passes; notification sent |
| **Auto-Cancelled** | Background process finds expired pending orders; same as manual cancel |

---

## 17. Translation & Language Support

The platform is fully bilingual:

| Language | Code | Direction |
|---|---|---|
| English | `en` | Left-to-Right (LTR) |
| Hebrew | `he` | Right-to-Left (RTL) |

### How Translations Work

- Every text label in the interface is stored as a **translation key**
- Translation keys are organized into **namespaces**: common, auth, spaces, orders, settings, admin
- Each key has an English value and a Hebrew value
- The app loads the appropriate language based on the user's preference
- When Hebrew is selected, the **entire layout flips** to RTL (right-to-left)

### What Can Be Translated

| Content Type | Managed By |
|---|---|
| UI strings (buttons, labels, messages) | Admin → Translations page + local JSON files |
| Space names and descriptions | Admin → Space Edit form (Hebrew tab) |
| Space types (e.g., "Mall Screen") | Admin → Translations → Location Types tab |
| Audience profiles (e.g., "Young Adults") | Admin → Translations → Audience Types tab |

---

## 18. Settings & Preferences

The Settings page (`/settings`) allows users to customize their experience:

### Account Section
- Edit full name, email, phone number, company name
- Change password (requires current password)
- Upload or remove profile picture

### Notification Preferences
- **Master toggle:** Enable/disable email notifications entirely
- **Per-event toggles:**
  - Order created notifications
  - Order confirmed notifications
  - Order cancelled notifications
  - Order completed notifications

### Language & Display
- Switch between English and Hebrew
- Layout automatically adjusts for RTL when Hebrew is selected

---

## 19. Technical Architecture Summary

> This section is for technical readers who want to understand how the system is built.

### Frontend

| Technology | Purpose |
|---|---|
| React 19 + TypeScript | User interface framework |
| React Router 7 | Page navigation and routing |
| Axios | API communication |
| MUI (Material UI) 7 | UI component library |
| i18next | Internationalization (translations) |
| Google Maps API | Map rendering and geolocation |
| date-fns | Date formatting and calculations |
| Lucide React | Icon library |

### Backend

| Technology | Purpose |
|---|---|
| FastAPI (Python) | REST API framework |
| SQLAlchemy 2.0 | Database ORM (Object-Relational Mapping) |
| MySQL | Relational database |
| Alembic | Database migration management |
| Pydantic 2 | Request/response validation |
| python-jose | JWT token creation and verification |
| passlib + bcrypt | Password hashing |
| boto3 | AWS SDK for SES email sending |
| slowapi | API rate limiting |

### Infrastructure

| Service | Purpose |
|---|---|
| Amazon SES | Transactional email delivery |
| Google OAuth 2.0 | Social login authentication |
| Google Maps Platform | Map rendering and geocoding |
| MySQL Database | Primary data storage |
| Local file storage | Uploaded images, creatives, and avatars stored in `/uploads` directory |

### Security Features

- **JWT Authentication** — Tokens stored in httpOnly cookies (not accessible by JavaScript)
- **Password Hashing** — bcrypt with salting
- **Rate Limiting** — Registration: 5 requests/min; Login: 10 requests/min
- **CORS Protection** — Only whitelisted origins can access the API
- **Role-Based Access** — Middleware guards prevent unauthorized access to admin/partner endpoints
- **Input Validation** — Pydantic schemas validate all incoming data
- **File Type Validation** — Only allowed MIME types (JPEG, PNG, WebP, MP4) accepted for uploads

### Database Schema Overview

```
Users ─────────── Orders ─────────── Spaces
  │                  │                  │
  │                  ├── TimeSlots      ├── Images
  │                  ├── Creatives      ├── OperatingHours
  │                  ├── OrderEvents    ├── Screens
  │                  └── Campaign       ├── AudienceProfiles
  │                                    └── SpaceType
  ├── Notifications
  └── NotificationPreferences

Translations
  ├── UITranslation
  ├── SpaceTranslation
  ├── SpaceTypeTranslation
  └── AudienceProfileTranslation

AppSettings (key-value store for system config)
```

---

*Document generated for Leads DOOH Platform v1.0.0*
*Last updated: February 2026*
