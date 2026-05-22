# 3D Printer Scheduler
A simple web-application to schedule, log & book 3D printers. Designed for education environments.

Made using Claude AI.

---

## Table of Contents
1. [Overview](#overview)
2. [Features](#features)
3. [Requirements](#requirements)
4. [Installation & Deployment](#installation--deployment)
   - [Running from the pre-compiled release](#running-from-the-pre-compiled-release)
   - [Building from source](#building-from-source)
5. [First-Launch Setup](#first-launch-setup)
6. [Login Modes](#login-modes)
   - [Active Directory](#active-directory-ad)
   - [Manual Login](#manual-login)
   - [No Login](#no-login-shared-mode)
7. [Configuration Files](#configuration-files)
   - [users.csv](#userscsvmanual-login-only)
   - [loginmode.override.txt](#loginmodeoverridetxtemergency-recovery)
8. [Admin Features](#admin-features)
9. [Settings](#settings)
   - [Filaments](#filaments)
   - [Class List](#class-list)
   - [Printers](#printers)
   - [Admins](#admins)
   - [Kiosk Mode](#kiosk-mode)
   - [Admin PIN](#admin-pin)
10. [Login Configuration Page](#login-configuration-page)
11. [Kiosk Mode](#kiosk-mode-1)
12. [Emergency Recovery](#emergency-recovery)
13. [Database](#database)
14. [Project Structure](#project-structure)
15. [Technology Stack](#technology-stack)

---

## Overview

3D Printer Scheduler is a self-hosted ASP.NET Core web application that allows students or staff to book time on 3D printers, track filament usage, and calculate printing costs. Administrators can manage printers, filaments, classes, and user access. Live updates are pushed to all connected browsers via SignalR so the schedule is always current.

---

## Features

- **Visual scheduling grid** — day view with one column per printer, time slots from 7 am to 5 pm
- **Bookings** — name, class, filament type, weight, and automatic cost calculation
- **Printer blocking** — admins can mark printer time as Maintenance, Out of Order, or Block Printing
- **Statistics** — per-student filament usage and cost breakdown with class and date filters
- **Live updates** — all open browser tabs refresh instantly when bookings or settings change (SignalR)
- **Three login modes** — Active Directory, Manual CSV, or No Login (PIN-only shared access)
- **Kiosk mode** — allows a dedicated classroom computer to view and create bookings without a persistent login
- **Responsive top bar** — collapses to a hamburger menu on narrow screens
- **Dynamic grid scaling** — hour row height scales to fill the screen on large monitors
- **PWA support** — installable as a web app on desktop and mobile

---

## Requirements

| Requirement | Details |
|---|---|
| Runtime | .NET 10 |
| OS | Windows (required for Active Directory mode); Linux/macOS work for Manual and No Login modes |
| Database | SQLite (bundled — no separate installation needed) |
| Browser | Any modern browser (Chrome, Edge, Firefox, Safari) |

> **Active Directory mode only:** The server must be joined to the domain, or at minimum be able to reach a domain controller on the network.

---

## Installation & Deployment

### Running from the pre-compiled release

Pre-compiled releases are available on the [GitHub Releases](../../releases) page as a ZIP file. You do not need Visual Studio, the .NET SDK, or any build tools — only the **.NET 10 Runtime**.

**Steps:**

1. **Download the latest release ZIP** from the [Releases](../../releases) page and extract it to wherever you want to run the app from, e.g.:
   ```
   C:\PrintScheduler\
   ```

2. **Install the .NET 10 Runtime** (if not already installed)
   Download from: https://dotnet.microsoft.com/en-us/download/dotnet/10.0
   Choose **.NET Runtime** (not the SDK) → Windows x64.

3. **Open a Command Prompt** in the extracted folder:
   ```
   cd C:\PrintScheduler
   ```

4. **Start the app:**
   ```
   dotnet 3DPrinterSchedulerWeb.dll
   ```
   Leave this window open — closing it stops the server.

5. **Open a browser** and navigate to:
   ```
   http://localhost:5000
   ```
   The first-launch setup wizard will appear.

6. **To make it accessible to other computers on the network**, change the URL the app listens on. Create or edit `appsettings.json` in the extracted folder:
   ```json
   {
     "Urls": "http://0.0.0.0:8080"
   }
   ```
   Then restart the app. Other devices on the same network can reach it at `http://<your-pc-ip>:8080`.

> **Tip:** To find your PC's IP address, run `ipconfig` in Command Prompt and look for the IPv4 address under your active network adapter.

---

### Building from source

If you have the source code and want to compile it yourself:

#### Prerequisites
- [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)

#### 1. Publish the application

```
dotnet publish -c Release
```

The published output will be in:
```
3DPrinterSchedulerWeb\bin\Release\net10.0\publish\
```

#### 2. Run the application

```
cd bin\Release\net10.0\publish
dotnet 3DPrinterSchedulerWeb.dll
```

Or configure it as a Windows Service / IIS application as required.

#### 3. Open in a browser

By default the app listens on `http://localhost:5000`. Navigate there in a browser and the first-launch setup wizard will appear.

#### 4. (Optional) Configure the port

Add or edit `appsettings.json` in the publish folder:

```json
{
  "Urls": "http://0.0.0.0:8080"
}
```

---

## First-Launch Setup

The first time the application is opened, a setup modal will appear asking which login mode to use. This must be completed before anyone can use the scheduler.

| Mode | When to use |
|---|---|
| **Active Directory** | You have a Windows domain and want users to log in with their existing domain credentials |
| **Manual Login** | No domain is available; you manage accounts yourself via a CSV file on the server |
| **No Login** | Shared use — anyone can book without logging in; a PIN protects admin features |

Once a mode is chosen and the form is submitted, the setting is saved to the database and the scheduler becomes usable. The mode can be changed later at `/loginconfig`.

---

## Login Modes

### Active Directory (AD)

Users log in with their standard domain username and password. The server contacts the domain controller to validate credentials.

**Setup requires:**
- **AD Domain** — the domain name (e.g. `example.com`)
- **Admin Groups** — one or more comma-separated AD group names whose members are automatically granted admin access (e.g. `Staff, IT_Admins`)

Any user in a listed group is an admin. Additional individual accounts can also be granted admin access from the Admins tab in Settings.

> **Note:** CA1416 warnings for `System.DirectoryServices` are suppressed in the project — this is expected and intentional.

---

### Manual Login

User accounts are defined in a CSV file on the server. No domain or external service is required.

See [users.csv](#userscsvmanual-login-only) for the file format.

Users marked `TRUE` in the `isadmin` column have admin access. Additional users can be promoted via the Admins tab in Settings.

---

### No Login (Shared Mode)

There are no individual accounts. Anyone who opens the app can immediately create bookings. The booking form requires a name to be typed manually.

Admin features (settings, blocking printers, statistics) are protected by a 4-digit PIN. Entering the PIN grants admin access for 5 minutes before automatically expiring.

**Notes:**
- Kiosk mode is not available in No Login mode
- The Admin PIN tab appears in Settings so the PIN can be changed

---

## Configuration Files

All configuration files live in a `config/` folder placed alongside the application executable (i.e. next to `3DPrinterSchedulerWeb.dll` in the publish folder).

```
publish/
├── 3DPrinterSchedulerWeb.dll
├── scheduler.db
└── config/
    ├── users.csv               ← Manual Login mode only
    └── loginmode.override.txt  ← Emergency recovery
```

---

### `users.csv` — Manual Login only

Defines user accounts when using Manual Login mode. The file must have a header row.

**Format:**
```
username,firstname,lastname,password,isadmin
alice,Alice,Smith,s3cr3t,true
bob,Bob,Jones,p4ssw0rd,false
```

| Column | Description |
|---|---|
| `username` | Login username (case-insensitive) |
| `firstname` | Used to display the user's full name |
| `lastname` | Used to display the user's full name |
| `password` | Plain-text password |
| `isadmin` | `true` or `false` — grants admin access |

> Passwords are stored in plain text. Use this mode only on trusted internal networks.

The file is read on every login — changes take effect immediately without restarting the app.

---

### `loginmode.override.txt` — Emergency Recovery

If admins are locked out of the application, this file provides a way back in without touching the database.

**Usage:**
1. Create the file `config/loginmode.override.txt` next to the executable
2. Set its entire contents to a **4-digit PIN** (e.g. `1234`)
3. The app immediately switches to No Login mode using that PIN — no restart required
4. Navigate to `/loginconfig` and log in using the PIN to reconfigure
5. Delete the file once normal access is restored

While the override file is present with a valid PIN, the database login mode and admin PIN settings are completely ignored.

---

## Admin Features

Admins have access to the following features not available to regular users:

| Feature | Description |
|---|---|
| **⚙ Settings** | Manage filaments, classes, printers, admins, kiosk, and PIN |
| **🚫 Block Printer** | Mark a printer as Maintenance, Out of Order, or Block Printing for a time range |
| **📊 Statistics** | View per-student filament usage and costs, filterable by class and date range |
| **Edit any booking** | Admins can edit or delete bookings created by any user |
| **All Bookings list** | Shift-click the logo to open a searchable list of all bookings across all dates |

---

## Settings

Opened via the **⚙ Settings** button in the top bar (admins only).

### Filaments

Define the filament types available for selection when creating a booking. Each filament has a name and a price per kilogram, which is used to automatically calculate the cost of a booking based on the weight entered.

Filaments can be reordered by dragging. Select a filament in the list then use the Edit button to update its name or price.

---

### Class List

The list of classes available in the class dropdown when creating or editing a booking. Can be reordered by dragging.

---

### Printers

The list of printers shown as columns in the scheduling grid. Printers can be added, renamed, removed, and reordered by dragging. Changes take effect immediately for all connected browsers.

---

### Admins

Manage which individual usernames have admin access, in addition to any group-based or CSV-based admins.

- **AD mode** — lists users granted admin access individually (group-based admins are handled automatically and not shown here)
- **Manual mode** — lists users promoted to admin individually (CSV-based admins are handled automatically and not shown here)
- **No Login mode** — this tab is informational only; all access is PIN-based

Hardcoded admins (configured via `/loginconfig`) are always admin and are intentionally hidden from this list.

---

### Kiosk Mode

See [Kiosk Mode](#kiosk-mode-1) below.

> Not available in No Login mode.

---

### Admin PIN

Only visible in **No Login** mode. Allows changing the 4-digit PIN used to unlock admin features.

---

## Login Configuration Page

Navigate to `/loginconfig` to change the login mode or other authentication settings. This page is intentionally not linked from the main application — type the URL directly.

**Requires admin login** — the page presents a login form using whichever login mode is currently active.

### What can be configured

| Setting | Description |
|---|---|
| **Login Mode** | Switch between AD, Manual, and No Login |
| **AD Domain** | The domain used for Active Directory authentication |
| **Admin Groups** | Comma-separated AD group names that grant admin access |
| **Admin PIN** | Set or change the No Login admin PIN |
| **Hardcoded Admins** | Comma-separated usernames that are always admin, hidden from the admin list |

### Confirmation code

Before any changes can be saved, a 6-digit code is displayed on screen. The code must be typed into the confirmation field — this prevents accidental saves and makes it clear that a potentially breaking change is being made intentionally.

### Switching modes

- Switching **away from No Login** mode clears the stored admin PIN from the database
- Switching **to No Login** mode requires a new PIN to be set

### Locked out?

A blue notice on the login form explains the emergency override procedure. See [Emergency Recovery](#emergency-recovery).

---

## Kiosk Mode

Kiosk mode is designed for a **dedicated classroom or workshop computer** that should always display the booking schedule without requiring a login.

**How it works:**
- An admin enables kiosk mode for the current device from the Kiosk tab in Settings
- A long-lived cookie (`scheduler_kiosk`) is set on that browser/device
- When the page loads on a kiosk device, it shows the grid immediately without a login prompt
- If a user logs in on a kiosk device, their session expires after **5 minutes** and they are automatically signed out

**To enable:** open Settings → Kiosk tab → Enable Kiosk Mode (must be done on the device you want to be a kiosk)

**To disable:** open Settings → Kiosk tab → Disable Kiosk Mode (on the kiosk device), or clear browser cookies

> Kiosk mode is not available when using No Login mode, since No Login mode already allows unrestricted access without a login.

---

## Emergency Recovery

If you are locked out of the application entirely:

1. On the server, go to the publish folder where `3DPrinterSchedulerWeb.dll` is located
2. Create a folder called `config` if it does not exist
3. Inside it, create a file called `loginmode.override.txt`
4. Set the file's contents to any 4-digit number, e.g. `5678`
5. The application immediately switches to No Login mode with that PIN — **no restart required**
6. In your browser, navigate to `/loginconfig`
7. The login form will show PIN entry — enter the 4-digit PIN from the file
8. Reconfigure the login settings as needed
9. **Delete `loginmode.override.txt`** once you are done to restore normal operation

---

## Database

The application uses a **SQLite** database file called `scheduler.db`, located in the same directory as the executable.

| Table | Contents |
|---|---|
| `Bookings` | All printer bookings and blocks |
| `Filaments` | Filament types and prices |
| `Printers` | Printer names and display order |
| `ClassGroups` | Class names and display order |
| `AdminUsers` | Individually-granted admin usernames |
| `AppSettings` | Key-value configuration store |

### AppSettings keys

| Key | Description |
|---|---|
| `loginMode` | `ad`, `manual`, `nologin`, or empty (not yet configured) |
| `adDomain` | AD domain name |
| `adAdminGroups` | Comma-separated AD group names for admin access |
| `hardcodedAdmins` | Comma-separated usernames that are always admin |
| `adminPin` | 4-digit PIN for No Login mode |

The database is created automatically on first run. Schema migrations are applied at startup.

> **Backup:** copy `scheduler.db` to preserve all bookings, settings, and configuration.

---

## Project Structure

```
3DPrinterSchedulerWeb/
├── Pages/
│   ├── Index.cshtml            # Main scheduler page (HTML)
│   ├── Index.cshtml.cs         # All API handlers (bookings, auth, settings)
│   ├── LoginConfig.cshtml      # /loginconfig page (HTML)
│   ├── LoginConfig.cshtml.cs   # Login config handlers
│   ├── Error.cshtml
│   └── Privacy.cshtml
├── Models/
│   ├── Booking.cs
│   ├── Filament.cs
│   ├── Printer.cs
│   ├── ClassGroup.cs
│   ├── AdminUser.cs
│   └── AppSetting.cs
├── Data/
│   └── AppDbContext.cs         # EF Core DbContext
├── Hubs/
│   └── SchedulerHub.cs         # SignalR hub
├── wwwroot/
│   ├── css/
│   │   ├── scheduler.css       # Main stylesheet
│   │   └── loginconfig.css     # /loginconfig page styles
│   ├── js/
│   │   └── scheduler.js        # All client-side logic
│   └── lib/
│       ├── fonts/              # DM Sans & DM Mono (self-hosted)
│       ├── signalr/            # SignalR client
│       └── icon.ico
├── Program.cs                  # App startup & middleware
└── 3DPrinterSchedulerWeb.csproj
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | ASP.NET Core 10 — Razor Pages |
| Database | SQLite via Entity Framework Core 10 |
| Real-time | SignalR |
| Authentication | Session-based (ASP.NET Core sessions) |
| AD integration | `System.DirectoryServices.AccountManagement` |
| Frontend | Vanilla JavaScript (no frameworks) |
| Fonts | DM Sans & DM Mono (self-hosted) |
| Styling | Plain CSS with custom properties |
