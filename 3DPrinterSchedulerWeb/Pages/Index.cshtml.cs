using _3DPrinterSchedulerWeb.Data;
using _3DPrinterSchedulerWeb.Hubs;
using _3DPrinterSchedulerWeb.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.DirectoryServices.AccountManagement;

namespace _3DPrinterSchedulerWeb.Pages
{
    public class IndexModel : PageModel
    {
        private readonly AppDbContext _db;
        private readonly IHubContext<SchedulerHub> _hub;
        public IndexModel(AppDbContext db, IHubContext<SchedulerHub> hub) { _db = db; _hub = hub; }

        // ── SESSION HELPERS ──
        private string? SessionUsername   => HttpContext.Session.GetString("username");
        private string? SessionFullName   => HttpContext.Session.GetString("fullName");
        private bool    SessionIsAdmin    => HttpContext.Session.GetString("isAdmin") == "true";
        private bool    SessionIsPinAdmin => HttpContext.Session.GetString("isPinAdmin") == "true";
        private bool    EffectiveAdmin    => SessionIsAdmin || SessionIsPinAdmin;

        private IActionResult Forbidden(string msg = "Not authorised") =>
            new JsonResult(new { error = msg }) { StatusCode = 403 };
        private IActionResult Unauthorized401() =>
            new JsonResult(new { error = "Not logged in" }) { StatusCode = 401 };

        // ── SETTINGS DB HELPERS ──
        private async Task<string> GetSettingAsync(string key, string defaultValue = "") =>
            (await _db.AppSettings.FindAsync(key))?.Value ?? defaultValue;

        private async Task SetSettingAsync(string key, string value)
        {
            var s = await _db.AppSettings.FindAsync(key);
            if (s == null) _db.AppSettings.Add(new AppSetting { Key = key, Value = value });
            else s.Value = value;
            await _db.SaveChangesAsync();
        }

        // ── LOGIN MODE HELPERS ──

        /// <summary>
        /// Returns the current login mode: "ad" | "manual" | "nologin" | "" (not yet configured).
        /// If config/loginmode.override.txt contains a valid 4-digit PIN, the mode is forced to "nologin"
        /// and that PIN is used as the admin PIN regardless of what is stored in the database.
        /// </summary>
        private async Task<string> GetLoginModeAsync()
        {
            var overridePath = System.IO.Path.Combine(AppContext.BaseDirectory, "config", "loginmode.override.txt");
            if (System.IO.File.Exists(overridePath))
            {
                var content = (await System.IO.File.ReadAllTextAsync(overridePath)).Trim();
                if (content.Length == 4 && content.All(char.IsDigit))
                    return "nologin";
            }
            return await GetSettingAsync("loginMode", "");
        }

        /// <summary>
        /// Returns the effective admin PIN. If the override file contains a 4-digit PIN, that is used;
        /// otherwise the PIN stored in the database is returned.
        /// </summary>
        private async Task<string> GetEffectiveAdminPinAsync()
        {
            var overridePath = System.IO.Path.Combine(AppContext.BaseDirectory, "config", "loginmode.override.txt");
            if (System.IO.File.Exists(overridePath))
            {
                var content = (await System.IO.File.ReadAllTextAsync(overridePath)).Trim();
                if (content.Length == 4 && content.All(char.IsDigit))
                    return content;
            }
            return await GetSettingAsync("adminPin", "");
        }

        /// <summary>
        /// Returns the set of hardcoded admin usernames stored in the DB setting.
        /// These users are always admins and hidden from the admin list in Settings.
        /// </summary>
        private async Task<HashSet<string>> GetHardcodedAdminsAsync()
        {
            var csv = await GetSettingAsync("hardcodedAdmins", "");
            return new HashSet<string>(
                csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
                   .Select(s => s.Trim())
                   .Where(s => s.Length > 0),
                StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Reads users from config/users.csv.
        /// Format (with header): username,firstname,lastname,password,isadmin
        /// </summary>
        private static List<ManualUser> ReadManualUsers()
        {
            var result = new List<ManualUser>();
            var csvPath = System.IO.Path.Combine(AppContext.BaseDirectory, "config", "users.csv");
            if (!System.IO.File.Exists(csvPath)) return result;
            bool first = true;
            foreach (var line in System.IO.File.ReadAllLines(csvPath))
            {
                if (first) { first = false; continue; } // skip header
                if (string.IsNullOrWhiteSpace(line)) continue;
                var parts = line.Split(',');
                if (parts.Length < 5) continue;
                result.Add(new ManualUser(
                    parts[0].Trim(),
                    parts[1].Trim(),
                    parts[2].Trim(),
                    parts[3].Trim(),
                    parts[4].Trim().Equals("true", StringComparison.OrdinalIgnoreCase)));
            }
            return result;
        }

        private static readonly CookieOptions KioskCookieOptions = new()
        {
            HttpOnly = true,
            IsEssential = true,
            Expires = DateTimeOffset.UtcNow.AddYears(100),
            SameSite = SameSiteMode.Strict
        };

        public async Task<IActionResult> OnGetAsync()
        {
            var loginMode = await GetLoginModeAsync();

            // Kiosk: re-stamp the cookie to keep it alive.
            // Only clear individual login session in individual login modes.
            if (Request.Cookies.ContainsKey("scheduler_kiosk"))
            {
                Response.Cookies.Append("scheduler_kiosk", "1", KioskCookieOptions);
                if (loginMode is "ad" or "manual")
                {
                    HttpContext.Session.Remove("username");
                    HttpContext.Session.Remove("fullName");
                    HttpContext.Session.Remove("isAdmin");
                    HttpContext.Session.Remove("loginTime");
                    await HttpContext.Session.CommitAsync();
                }
            }

            return Page();
        }

        // ── AUTH ──

        public async Task<IActionResult> OnGetCurrentUserAsync()
        {
            var loginMode = await GetLoginModeAsync();
            bool isKiosk = Request.Cookies.ContainsKey("scheduler_kiosk");

            // Not yet configured — first launch
            if (loginMode == "")
                return new JsonResult(new { loggedIn = false, needsSetup = true, isKiosk = false });

            // No Login mode: everyone is always a "logged-in" anonymous user
            if (loginMode == "nologin")
            {
                bool isPinAdmin = SessionIsPinAdmin;
                int pinSecondsRemaining = 0;

                if (isPinAdmin)
                {
                    var loginTimeStr = HttpContext.Session.GetString("pinAdminLoginTime");
                    if (loginTimeStr == null || !DateTimeOffset.TryParse(loginTimeStr, out var loginTime))
                    {
                        HttpContext.Session.Remove("isPinAdmin");
                        HttpContext.Session.Remove("pinAdminLoginTime");
                        isPinAdmin = false;
                    }
                    else
                    {
                        var remaining = TimeSpan.FromMinutes(5) - (DateTimeOffset.UtcNow - loginTime);
                        if (remaining <= TimeSpan.Zero)
                        {
                            HttpContext.Session.Remove("isPinAdmin");
                            HttpContext.Session.Remove("pinAdminLoginTime");
                            isPinAdmin = false;
                        }
                        else
                        {
                            pinSecondsRemaining = (int)remaining.TotalSeconds;
                        }
                    }
                }

                return new JsonResult(new
                {
                    loggedIn = true,
                    loginMode,
                    isSharedMode = true,
                    isAdmin = isPinAdmin,
                    pinSecondsRemaining,
                    isKiosk = false
                });
            }

            // Individual login mode (ad or manual)
            if (SessionUsername == null)
                return new JsonResult(new { loggedIn = false, loginMode, isKiosk });

            if (isKiosk)
            {
                var loginTimeStr = HttpContext.Session.GetString("loginTime");
                if (loginTimeStr == null || !DateTimeOffset.TryParse(loginTimeStr, out var loginTime))
                {
                    HttpContext.Session.Clear();
                    return new JsonResult(new { loggedIn = false, loginMode, isKiosk = true });
                }
                var remaining = TimeSpan.FromMinutes(5) - (DateTimeOffset.UtcNow - loginTime);
                if (remaining <= TimeSpan.Zero)
                {
                    HttpContext.Session.Clear();
                    return new JsonResult(new { loggedIn = false, loginMode, isKiosk = true });
                }
                return new JsonResult(new
                {
                    loggedIn = true, loginMode, username = SessionUsername, fullName = SessionFullName,
                    isAdmin = SessionIsAdmin, isKiosk = true,
                    kioskSecondsRemaining = (int)remaining.TotalSeconds
                });
            }

            return new JsonResult(new
            {
                loggedIn = true,
                loginMode,
                username  = SessionUsername,
                fullName  = SessionFullName,
                isAdmin   = SessionIsAdmin,
                isKiosk   = false
            });
        }

        public async Task<IActionResult> OnGetEnableKiosk()
        {
            var loginMode = await GetLoginModeAsync();
            if (loginMode == "nologin")
                return new JsonResult(new { error = "Kiosk mode is not available in No Login mode." }) { StatusCode = 400 };
            if (!EffectiveAdmin) return Forbidden();
            Response.Cookies.Append("scheduler_kiosk", "1", KioskCookieOptions);
            return new JsonResult(new { success = true });
        }

        public IActionResult OnGetClearKiosk()
        {
            if (!EffectiveAdmin) return Forbidden();
            Response.Cookies.Delete("scheduler_kiosk");
            return new JsonResult(new { success = true });
        }

        // ── FIRST-LAUNCH SETUP ──

        public async Task<IActionResult> OnPostSetupAsync([FromBody] SetupRequest req)
        {
            // Only allowed when loginMode is not yet configured
            var loginMode = await GetLoginModeAsync();
            if (loginMode != "")
                return new JsonResult(new { success = false, error = "Application is already configured. Use /loginconfig to change settings." }) { StatusCode = 400 };

            if (req.LoginMode != "ad" && req.LoginMode != "manual" && req.LoginMode != "nologin")
                return new JsonResult(new { success = false, error = "Invalid login mode." });

            if (req.LoginMode == "nologin")
            {
                if (string.IsNullOrEmpty(req.AdminPin) || req.AdminPin.Length != 4 || !req.AdminPin.All(char.IsDigit))
                    return new JsonResult(new { success = false, error = "Admin PIN must be exactly 4 digits." });
                await SetSettingAsync("adminPin", req.AdminPin);
            }
            else if (req.LoginMode == "ad")
            {
                if (string.IsNullOrWhiteSpace(req.AdDomain))
                    return new JsonResult(new { success = false, error = "AD domain is required." });
                await SetSettingAsync("adDomain", req.AdDomain.Trim());
                await SetSettingAsync("adAdminGroups", req.AdAdminGroups?.Trim() ?? "");
            }

            await SetSettingAsync("loginMode", req.LoginMode);
            return new JsonResult(new { success = true });
        }

        // ── LOGIN ──

        public async Task<IActionResult> OnPostLoginAsync([FromBody] LoginRequest req)
        {
            var loginMode = await GetLoginModeAsync();

            if (loginMode == "")
                return new JsonResult(new { success = false, error = "Application is not yet configured." });

            if (loginMode == "nologin")
                return new JsonResult(new { success = false, error = "Individual logins are not enabled in this mode." });

            if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                return new JsonResult(new { success = false, error = "Invalid username or password." });

            var username = req.Username.Trim();
            string? fullName = null;
            bool isStaff = false;
            var hardcodedAdmins = await GetHardcodedAdminsAsync();

            if (loginMode == "manual")
            {
                var users = ReadManualUsers();
                var user = users.FirstOrDefault(u => u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));
                if (user == null || user.Password != req.Password)
                    return new JsonResult(new { success = false, error = "Invalid username or password." });

                var first = user.FirstName;
                var last  = user.LastName;
                fullName = (first, last) switch
                {
                    ({ Length: > 0 }, { Length: > 0 }) => $"{first} {last}",
                    ({ Length: > 0 }, _)               => first,
                    (_, { Length: > 0 })               => last,
                    _                                  => username
                };
                isStaff = user.IsAdmin;
            }
            else // ad
            {
                var adDomain = await GetSettingAsync("adDomain", "");
                var adAdminGroups = (await GetSettingAsync("adAdminGroups", ""))
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(g => g.Trim())
                    .Where(g => g.Length > 0)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                try
                {
                    using var ctx = new PrincipalContext(ContextType.Domain, adDomain, username, req.Password);

                    if (!ctx.ValidateCredentials(username, req.Password))
                        return new JsonResult(new { success = false, error = "Invalid username or password." });

                    using var userPrincipal = UserPrincipal.FindByIdentity(ctx, username);
                    if (userPrincipal != null)
                    {
                        var given   = userPrincipal.GivenName?.Trim();
                        var surname = userPrincipal.Surname?.Trim();
                        fullName = (given, surname) switch
                        {
                            ({ Length: > 0 }, { Length: > 0 }) => $"{given} {surname}",
                            ({ Length: > 0 }, _)               => given,
                            (_, { Length: > 0 })               => surname,
                            _                                  => userPrincipal.DisplayName ?? userPrincipal.Name
                        };

                        if (adAdminGroups.Count > 0)
                        {
                            foreach (var group in userPrincipal.GetGroups())
                            {
                                if (adAdminGroups.Contains(group.Name)) { isStaff = true; break; }
                            }
                        }
                    }
                }
                catch (Exception)
                {
                    return new JsonResult(new { success = false, error = "Unable to reach the authentication server. Please try again." });
                }
            }

            fullName ??= username;
            bool isAdmin = hardcodedAdmins.Contains(username) || isStaff
                || await _db.AdminUsers.AnyAsync(a => a.Username == username);

            HttpContext.Session.SetString("username",  username);
            HttpContext.Session.SetString("fullName",  fullName);
            HttpContext.Session.SetString("isAdmin",   isAdmin ? "true" : "false");
            HttpContext.Session.SetString("loginTime", DateTimeOffset.UtcNow.ToString("O"));

            return new JsonResult(new { success = true, username, fullName, isAdmin });
        }

        public IActionResult OnPostLogout()
        {
            HttpContext.Session.Clear();
            return new JsonResult(new { success = true });
        }

        // ── PIN (NO LOGIN MODE) ──

        public async Task<IActionResult> OnPostVerifyPinAsync([FromBody] PinRequest req)
        {
            if (await GetLoginModeAsync() != "nologin")
                return new JsonResult(new { success = false, error = "Not in no-login mode." });

            var correctPin = await GetEffectiveAdminPinAsync();
            if (string.IsNullOrEmpty(correctPin))
                return new JsonResult(new { success = false, error = "No admin PIN has been set." });
            if (req.Pin != correctPin)
                return new JsonResult(new { success = false, error = "Incorrect PIN." });

            HttpContext.Session.SetString("isPinAdmin", "true");
            HttpContext.Session.SetString("pinAdminLoginTime", DateTimeOffset.UtcNow.ToString("O"));
            await HttpContext.Session.CommitAsync();
            return new JsonResult(new { success = true });
        }

        public async Task<IActionResult> OnPostSavePinAsync([FromBody] PinRequest req)
        {
            if (!EffectiveAdmin) return Forbidden();
            if (await GetLoginModeAsync() != "nologin")
                return new JsonResult(new { success = false, error = "PIN is only available in no-login mode." });
            if (string.IsNullOrEmpty(req.Pin) || req.Pin.Length != 4 || !req.Pin.All(char.IsDigit))
                return new JsonResult(new { success = false, error = "PIN must be exactly 4 digits." });
            await SetSettingAsync("adminPin", req.Pin);
            return new JsonResult(new { success = true });
        }

        public IActionResult OnGetExitPinAdmin()
        {
            HttpContext.Session.Remove("isPinAdmin");
            HttpContext.Session.Remove("pinAdminLoginTime");
            return new JsonResult(new { success = true });
        }

        // ── ADMINS ──

        public async Task<IActionResult> OnGetAdmins()
        {
            if (!EffectiveAdmin) return Forbidden();
            var hardcoded = await GetHardcodedAdminsAsync();
            var list = _db.AdminUsers
                .Select(a => a.Username)
                .ToList()
                .Where(u => !hardcoded.Contains(u))
                .ToList();
            return new JsonResult(list);
        }

        public async Task<IActionResult> OnPostSaveAdminsAsync([FromBody] List<string> usernames)
        {
            if (!EffectiveAdmin) return Forbidden();
            if (usernames == null) return new JsonResult(new { success = false });

            var hardcoded = await GetHardcodedAdminsAsync();
            var existing = await _db.AdminUsers.ToListAsync();
            _db.AdminUsers.RemoveRange(existing);
            await _db.SaveChangesAsync();

            foreach (var u in usernames.Where(u =>
                !string.IsNullOrWhiteSpace(u) &&
                !hardcoded.Contains(u.Trim())))
                _db.AdminUsers.Add(new AdminUser { Username = u.Trim() });

            await _db.SaveChangesAsync();
            return new JsonResult(new { success = true });
        }

        // ── BOOKINGS ──

        public IActionResult OnGetBookings(string date)
        {
            var results = _db.Bookings.Where(b => b.Date == date).ToList();
            return new JsonResult(results);
        }

        public IActionResult OnGetStats(string? className, string? from, string? to)
        {
            if (!EffectiveAdmin) return Forbidden();

            var query = _db.Bookings.Where(b => b.BookingType == "booking").AsQueryable();
            if (!string.IsNullOrEmpty(className)) query = query.Where(b => b.StudentClass == className);
            if (!string.IsNullOrEmpty(from))      query = query.Where(b => string.Compare(b.Date, from) >= 0);
            if (!string.IsNullOrEmpty(to))        query = query.Where(b => string.Compare(b.Date, to)   <= 0);

            var rows = query.ToList();
            var students = rows
                .GroupBy(b => b.StudentName)
                .Select(g => new
                {
                    studentName = g.Key,
                    filaments   = g.GroupBy(b => b.FilamentType)
                                   .ToDictionary(fg => fg.Key, fg => new
                                   {
                                       grams = fg.Sum(b => b.WeightGrams),
                                       cost  = fg.Sum(b => b.Price)
                                   }),
                    totalGrams = g.Sum(b => b.WeightGrams),
                    totalCost  = g.Sum(b => b.Price)
                })
                .OrderBy(s => s.studentName)
                .ToList<object>();

            return new JsonResult(students);
        }

        public IActionResult OnGetAllBookings()
        {
            if (!EffectiveAdmin) return Forbidden();
            var results = _db.Bookings
                .OrderByDescending(b => b.Date)
                .ThenBy(b => b.PrinterName)
                .ThenBy(b => b.StartTime)
                .ToList();
            return new JsonResult(results);
        }

        public async Task<IActionResult> OnPostCreateBookingAsync([FromBody] Booking booking)
        {
            bool noLoginMode = await GetLoginModeAsync() == "nologin";
            if (!noLoginMode && SessionUsername == null) return Unauthorized401();
            if (booking.BookingType != "booking" && !EffectiveAdmin) return Forbidden();

            var filament = await _db.Filaments.FirstOrDefaultAsync(f => f.Name == booking.FilamentType);
            booking.Price = Math.Round((booking.WeightGrams / 1000.0) * (filament?.PricePerKg ?? 0), 2);

            _db.Bookings.Add(booking);
            await _db.SaveChangesAsync();
            await _hub.Clients.All.SendAsync("bookingsChanged");
            return new JsonResult(booking);
        }

        public IActionResult OnGetStudentNames(string query)
        {
            if (string.IsNullOrWhiteSpace(query) || query.Length < 3)
                return new JsonResult(new List<string>());

            var lower = query.ToLower();
            var names = _db.Bookings
                .Where(b => b.StudentName.ToLower().Contains(lower))
                .Select(b => b.StudentName)
                .Distinct()
                .OrderBy(n => n)
                .Take(8)
                .ToList();

            return new JsonResult(names);
        }

        // ── FILAMENTS ──

        public IActionResult OnGetFilaments() =>
            new JsonResult(_db.Filaments.OrderBy(f => f.SortOrder).ThenBy(f => f.Name).ToList());

        public async Task<IActionResult> OnPostSaveFilamentsAsync([FromBody] List<Filament> filaments)
        {
            if (!EffectiveAdmin) return Forbidden();
            if (filaments == null) return new JsonResult(new { success = false, error = "No data received" });

            try
            {
                var existing = await _db.Filaments.AsNoTracking().ToListAsync();
                _db.Filaments.RemoveRange(existing);
                await _db.SaveChangesAsync();

                for (int i = 0; i < filaments.Count; i++)
                    await _db.Filaments.AddAsync(new Filament { Name = filaments[i].Name, PricePerKg = filaments[i].PricePerKg, SortOrder = i });

                await _db.SaveChangesAsync();
                await _hub.Clients.All.SendAsync("settingsChanged");
                return new JsonResult(new { success = true });
            }
            catch (Exception ex) { return new JsonResult(new { success = false, error = ex.Message }) { StatusCode = 500 }; }
        }

        // ── PRINTERS ──

        public IActionResult OnGetPrinters() =>
            new JsonResult(_db.Printers.OrderBy(p => p.SortOrder).ToList());

        public async Task<IActionResult> OnPostSavePrintersAsync([FromBody] List<Printer> printers)
        {
            if (!EffectiveAdmin) return Forbidden();
            if (printers == null) return new JsonResult(new { success = false, error = "No data received" });

            try
            {
                var existing = await _db.Printers.AsNoTracking().ToListAsync();
                _db.Printers.RemoveRange(existing);
                await _db.SaveChangesAsync();

                for (int i = 0; i < printers.Count; i++)
                    await _db.Printers.AddAsync(new Printer { Name = printers[i].Name, SortOrder = i });

                await _db.SaveChangesAsync();
                await _hub.Clients.All.SendAsync("settingsChanged");
                return new JsonResult(new { success = true });
            }
            catch (Exception ex) { return new JsonResult(new { success = false, error = ex.Message }) { StatusCode = 500 }; }
        }

        // ── CLASSES ──

        public IActionResult OnGetClasses() =>
            new JsonResult(_db.ClassGroups.OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToList());

        public async Task<IActionResult> OnPostSaveClassesAsync([FromBody] List<ClassGroup> classes)
        {
            if (!EffectiveAdmin) return Forbidden();
            if (classes == null) return new JsonResult(new { success = false, error = "No data received" });

            try
            {
                var existing = await _db.ClassGroups.AsNoTracking().ToListAsync();
                _db.ClassGroups.RemoveRange(existing);
                await _db.SaveChangesAsync();

                for (int i = 0; i < classes.Count; i++)
                    await _db.ClassGroups.AddAsync(new ClassGroup { Name = classes[i].Name, SortOrder = i });

                await _db.SaveChangesAsync();
                await _hub.Clients.All.SendAsync("settingsChanged");
                return new JsonResult(new { success = true });
            }
            catch (Exception ex) { return new JsonResult(new { success = false, error = ex.Message }) { StatusCode = 500 }; }
        }

        // ── UPDATE / DELETE BOOKING ──

        public async Task<IActionResult> OnPostUpdateBookingAsync([FromBody] Booking booking)
        {
            bool noLoginMode = await GetLoginModeAsync() == "nologin";
            if (!noLoginMode && SessionUsername == null) return Unauthorized401();

            var existing = await _db.Bookings.FindAsync(booking.Id);
            if (existing == null)
                return new JsonResult(new { success = false, error = "Booking not found" }) { StatusCode = 404 };

            if (existing.BookingType != "booking")
            {
                if (!EffectiveAdmin) return Forbidden();
            }
            else
            {
                if (!EffectiveAdmin && !noLoginMode && existing.StudentName != SessionFullName)
                    return Forbidden();
            }

            var filament = await _db.Filaments.FirstOrDefaultAsync(f => f.Name == booking.FilamentType);
            double pricePerKg = filament?.PricePerKg ?? 0;

            existing.StudentName  = booking.StudentName;
            existing.StudentClass = booking.StudentClass;
            existing.PrinterName  = booking.PrinterName;
            existing.Date         = booking.Date;
            existing.StartTime    = booking.StartTime;
            existing.EndTime      = booking.EndTime;
            existing.FilamentType = booking.FilamentType;
            existing.WeightGrams  = booking.WeightGrams;
            existing.BookingType  = booking.BookingType;
            existing.Price        = Math.Round((booking.WeightGrams / 1000.0) * pricePerKg, 2);

            await _db.SaveChangesAsync();
            await _hub.Clients.All.SendAsync("bookingsChanged");
            return new JsonResult(existing);
        }

        public async Task<IActionResult> OnPostDeleteBookingAsync(int id)
        {
            bool noLoginMode = await GetLoginModeAsync() == "nologin";
            if (!noLoginMode && SessionUsername == null) return Unauthorized401();

            var booking = await _db.Bookings.FindAsync(id);
            if (booking == null) return new JsonResult(new { success = true });

            if (booking.BookingType != "booking")
            {
                if (!EffectiveAdmin) return Forbidden();
            }
            else
            {
                if (!EffectiveAdmin && !noLoginMode && booking.StudentName != SessionFullName)
                    return Forbidden();
            }

            _db.Bookings.Remove(booking);
            await _db.SaveChangesAsync();
            await _hub.Clients.All.SendAsync("bookingsChanged");
            return new JsonResult(new { success = true });
        }
    }

    // ── REQUEST MODELS ──

    public class LoginRequest
    {
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
    }

    public class PinRequest
    {
        public string Pin { get; set; } = "";
    }

    public class SetupRequest
    {
        public string LoginMode   { get; set; } = "";
        public string? AdDomain   { get; set; }
        public string? AdAdminGroups { get; set; }
        public string? AdminPin   { get; set; }
    }

    public record ManualUser(string Username, string FirstName, string LastName, string Password, bool IsAdmin);
}
