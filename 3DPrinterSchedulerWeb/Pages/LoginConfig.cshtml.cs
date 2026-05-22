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
    public class LoginConfigModel : PageModel
    {
        private readonly AppDbContext _db;
        private readonly IHubContext<SchedulerHub> _hub;
        public LoginConfigModel(AppDbContext db, IHubContext<SchedulerHub> hub) { _db = db; _hub = hub; }

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

        // ── LOGIN MODE ──
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

        private async Task<HashSet<string>> GetHardcodedAdminsAsync()
        {
            var csv = await GetSettingAsync("hardcodedAdmins", "");
            return new HashSet<string>(
                csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
                   .Select(s => s.Trim())
                   .Where(s => s.Length > 0),
                StringComparer.OrdinalIgnoreCase);
        }

        private static List<ManualUser> ReadManualUsers()
        {
            var result = new List<ManualUser>();
            var csvPath = System.IO.Path.Combine(AppContext.BaseDirectory, "config", "users.csv");
            if (!System.IO.File.Exists(csvPath)) return result;
            bool first = true;
            foreach (var line in System.IO.File.ReadAllLines(csvPath))
            {
                if (first) { first = false; continue; }
                if (string.IsNullOrWhiteSpace(line)) continue;
                var parts = line.Split(',');
                if (parts.Length < 5) continue;
                result.Add(new ManualUser(
                    parts[0].Trim(), parts[1].Trim(), parts[2].Trim(),
                    parts[3].Trim(),
                    parts[4].Trim().Equals("true", StringComparison.OrdinalIgnoreCase)));
            }
            return result;
        }

        // ── LC AUTH HELPERS ──
        private bool LcAuthValid()
        {
            var auth    = HttpContext.Session.GetString("lcAuth");
            var timeStr = HttpContext.Session.GetString("lcAuthTime");
            if (auth != "1" || timeStr == null) return false;
            if (!DateTimeOffset.TryParse(timeStr, out var t)) return false;
            return DateTimeOffset.UtcNow - t < TimeSpan.FromMinutes(30);
        }

        private string GenerateAndStoreCode()
        {
            var code = Random.Shared.Next(100000, 1000000).ToString("D6");
            HttpContext.Session.SetString("lcConfirmCode", code);
            return code;
        }

        private IActionResult NotAuth() =>
            new JsonResult(new { authenticated = false, error = "Not authenticated." }) { StatusCode = 401 };

        // ── HANDLERS ──

        public async Task<IActionResult> OnGetAsync()
        {
            var loginMode = await GetLoginModeAsync();
            // If not configured, go back to main page for first-launch setup
            if (loginMode == "") return Redirect("/");
            return Page();
        }

        /// <summary>Returns current auth state and config values.</summary>
        public async Task<IActionResult> OnGetCurrentConfigAsync()
        {
            var loginMode = await GetLoginModeAsync();
            if (!LcAuthValid())
                return new JsonResult(new { authenticated = false, loginMode });

            var code = HttpContext.Session.GetString("lcConfirmCode") ?? GenerateAndStoreCode();

            return new JsonResult(new
            {
                authenticated   = true,
                loginMode,
                adDomain        = await GetSettingAsync("adDomain",      ""),
                adAdminGroups   = await GetSettingAsync("adAdminGroups", ""),
                hardcodedAdmins = await GetSettingAsync("hardcodedAdmins", ""),
                confirmCode     = code
            });
        }

        /// <summary>Authenticates the caller as an admin for the /loginconfig session.</summary>
        public async Task<IActionResult> OnPostLcLoginAsync([FromBody] LcLoginRequest req)
        {
            var loginMode = await GetLoginModeAsync();
            if (loginMode == "")
                return new JsonResult(new { success = false, error = "Application not configured." }) { StatusCode = 400 };

            bool authenticated = false;

            if (loginMode == "nologin")
            {
                var pin = await GetEffectiveAdminPinAsync();
                authenticated = !string.IsNullOrEmpty(pin) && req.Pin == pin;
            }
            else if (loginMode == "manual")
            {
                var users = ReadManualUsers();
                var username = req.Username?.Trim() ?? "";
                var user = users.FirstOrDefault(u => u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));
                var hardcoded = await GetHardcodedAdminsAsync();
                var dbAdmins  = await _db.AdminUsers.Select(a => a.Username).ToListAsync();

                bool isAdmin = (user?.IsAdmin == true)
                    || hardcoded.Contains(username)
                    || dbAdmins.Any(a => a.Equals(username, StringComparison.OrdinalIgnoreCase));

                if (user != null && user.Password == req.Password && isAdmin)
                    authenticated = true;
            }
            else // ad
            {
                var adDomain = await GetSettingAsync("adDomain", "");
                var adAdminGroups = (await GetSettingAsync("adAdminGroups", ""))
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(g => g.Trim())
                    .Where(g => g.Length > 0)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                var hardcoded = await GetHardcodedAdminsAsync();
                var dbAdmins  = await _db.AdminUsers.Select(a => a.Username).ToListAsync();
                var username  = req.Username?.Trim() ?? "";

                try
                {
                    using var ctx = new PrincipalContext(ContextType.Domain, adDomain, username, req.Password);
                    if (ctx.ValidateCredentials(username, req.Password))
                    {
                        using var userPrincipal = UserPrincipal.FindByIdentity(ctx, username);
                        if (userPrincipal != null)
                        {
                            bool isAdmin = hardcoded.Contains(username)
                                || dbAdmins.Any(a => a.Equals(username, StringComparison.OrdinalIgnoreCase));

                            if (!isAdmin && adAdminGroups.Count > 0)
                            {
                                foreach (var group in userPrincipal.GetGroups())
                                {
                                    if (adAdminGroups.Contains(group.Name)) { isAdmin = true; break; }
                                }
                            }
                            authenticated = isAdmin;
                        }
                    }
                }
                catch { /* AD unreachable */ }
            }

            if (!authenticated)
                return new JsonResult(new { success = false, error = "Invalid credentials or insufficient privileges." });

            HttpContext.Session.SetString("lcAuth", "1");
            HttpContext.Session.SetString("lcAuthTime", DateTimeOffset.UtcNow.ToString("O"));
            var code = GenerateAndStoreCode();
            await HttpContext.Session.CommitAsync();

            return new JsonResult(new { success = true, confirmCode = code });
        }

        /// <summary>Saves the new login configuration. Requires lc auth + correct confirmation code.</summary>
        public async Task<IActionResult> OnPostSaveConfigAsync([FromBody] LcSaveRequest req)
        {
            if (!LcAuthValid()) return NotAuth();

            // Validate confirmation code
            var storedCode = HttpContext.Session.GetString("lcConfirmCode");
            if (string.IsNullOrEmpty(storedCode) || req.ConfirmCode?.Trim() != storedCode)
                return new JsonResult(new { success = false, error = "Incorrect confirmation code." });

            // Consume the code — generate a new one immediately so the display refreshes
            HttpContext.Session.Remove("lcConfirmCode");

            var oldLoginMode = await GetLoginModeAsync();
            var newLoginMode = req.LoginMode;

            if (newLoginMode != "ad" && newLoginMode != "manual" && newLoginMode != "nologin")
                return new JsonResult(new { success = false, error = "Invalid login mode." });

            if (newLoginMode == "ad")
            {
                if (string.IsNullOrWhiteSpace(req.AdDomain))
                    return new JsonResult(new { success = false, error = "AD domain is required." });
                await SetSettingAsync("adDomain", req.AdDomain.Trim());
                await SetSettingAsync("adAdminGroups", req.AdAdminGroups?.Trim() ?? "");
            }
            else if (newLoginMode == "nologin")
            {
                if (!string.IsNullOrEmpty(req.AdminPin))
                {
                    if (req.AdminPin.Length != 4 || !req.AdminPin.All(char.IsDigit))
                        return new JsonResult(new { success = false, error = "Admin PIN must be exactly 4 digits." });
                    await SetSettingAsync("adminPin", req.AdminPin);
                }
                else if (oldLoginMode != "nologin")
                {
                    // Switching into nologin mode: require a PIN
                    return new JsonResult(new { success = false, error = "An admin PIN is required when switching to No Login mode." });
                }
            }

            // Clear admin PIN when switching away from No Login mode
            if (oldLoginMode == "nologin" && newLoginMode != "nologin")
                await SetSettingAsync("adminPin", "");

            // Save hardcoded admins
            await SetSettingAsync("hardcodedAdmins", req.HardcodedAdmins?.Trim() ?? "");

            // Save new login mode
            await SetSettingAsync("loginMode", newLoginMode);

            // Generate a fresh code for the next save
            GenerateAndStoreCode();
            await HttpContext.Session.CommitAsync();

            await _hub.Clients.All.SendAsync("settingsChanged");
            return new JsonResult(new { success = true });
        }

        public IActionResult OnGetLcLogout()
        {
            HttpContext.Session.Remove("lcAuth");
            HttpContext.Session.Remove("lcAuthTime");
            HttpContext.Session.Remove("lcConfirmCode");
            return new JsonResult(new { success = true });
        }
    }

    // ── REQUEST MODELS ──

    public class LcLoginRequest
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
        public string? Pin      { get; set; }
    }

    public class LcSaveRequest
    {
        public string  LoginMode       { get; set; } = "";
        public string? AdDomain        { get; set; }
        public string? AdAdminGroups   { get; set; }
        public string? AdminPin        { get; set; }
        public string? HardcodedAdmins { get; set; }
        public string? ConfirmCode     { get; set; }
    }
}
