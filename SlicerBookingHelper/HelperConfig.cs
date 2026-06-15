using System.Text.Json;
using System.Text.Json.Serialization;

namespace SlicerBookingHelper;

/// Settings read from appsettings.json sitting next to the executable.
public sealed class HelperConfig
{
    [JsonPropertyName("BaseUrl")]
    public string BaseUrl { get; set; } = "http://localhost:5276";

    [JsonPropertyName("AlwaysOnTop")]
    public bool AlwaysOnTop { get; set; } = true;

    /// When true the helper never opens a browser. Instead it shows the booking
    /// details plus a code entry box for a disconnected slicing-only PC.
    [JsonPropertyName("OfflineMode")]
    public bool OfflineMode { get; set; } = false;

    /// Shared secret used to verify the booking code entered offline. MUST be
    /// identical to BookingCodeSecret in the scheduler's appsettings.json.
    [JsonPropertyName("BookingCodeSecret")]
    public string BookingCodeSecret { get; set; } = "";

    public static HelperConfig Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        if (!File.Exists(path))
            return new HelperConfig();

        try
        {
            var json = File.ReadAllText(path);
            var cfg = JsonSerializer.Deserialize<HelperConfig>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
            return cfg ?? new HelperConfig();
        }
        catch
        {
            // A malformed config should never stop a student from booking.
            return new HelperConfig();
        }
    }
}
