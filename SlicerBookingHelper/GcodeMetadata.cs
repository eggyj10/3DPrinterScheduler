using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SlicerBookingHelper;

/// Print details pulled out of a sliced G-code file's comment header/footer.
/// Bambu Studio, OrcaSlicer and Orca-Flashforge are all PrusaSlicer/Slic3r
/// descendants, so they share most of these comment keys (with minor wording
/// differences that the parser tolerates).
public sealed class GcodeMetadata
{
    public string FilamentType { get; init; } = "";
    public double? WeightGrams { get; init; }
    public int? EstimatedMinutes { get; init; }

    /// Builds a prefill URL for the scheduler web app. The query parameter
    /// names here must match what the booking page reads on the web side.
    public string BuildBookingUrl(string baseUrl)
    {
        var parts = new List<string> { "prefill=1" };
        void Add(string key, string value) =>
            parts.Add($"{key}={Uri.EscapeDataString(value)}");

        if (!string.IsNullOrWhiteSpace(FilamentType)) Add("filament", FilamentType);
        if (WeightGrams is { } g) Add("grams", g.ToString("0.##", CultureInfo.InvariantCulture));
        if (EstimatedMinutes is { } m) Add("minutes", m.ToString(CultureInfo.InvariantCulture));

        return $"{baseUrl.TrimEnd('/')}/?{string.Join('&', parts)}";
    }

    public static GcodeMetadata Parse(string gcodePath)
    {
        var text = ReadEnds(gcodePath);

        return new GcodeMetadata
        {
            FilamentType = ParseFilamentType(text),
            WeightGrams = ParseWeightGrams(text),
            EstimatedMinutes = ParseEstimatedMinutes(text),
        };
    }

    /// G-code files can be tens of MB. The metadata we want lives in the
    /// comment summary near the top and the config block at the very bottom,
    /// so we only read those two chunks rather than the whole file.
    private static string ReadEnds(string path, int chunk = 256 * 1024)
    {
        using var fs = File.OpenRead(path);
        if (fs.Length <= chunk * 2L)
        {
            using var all = new StreamReader(fs, Encoding.UTF8);
            return all.ReadToEnd();
        }

        var head = new byte[chunk];
        var read = fs.Read(head, 0, chunk);

        var tail = new byte[chunk];
        fs.Seek(-chunk, SeekOrigin.End);
        var readTail = fs.Read(tail, 0, chunk);

        return Encoding.UTF8.GetString(head, 0, read)
             + "\n"
             + Encoding.UTF8.GetString(tail, 0, readTail);
    }

    private static readonly RegexOptions Opts =
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant;

    private static string ParseFilamentType(string text)
    {
        // e.g. "; filament_type = PLA" or for multi-material "PLA;PETG"
        var m = Regex.Match(text, @"^\s*;\s*filament_type\s*[:=]\s*(.+)$", Opts);
        if (!m.Success) return "";
        var raw = m.Groups[1].Value.Trim();
        // Take the first material if several are listed.
        return raw.Split(';', ',')[0].Trim();
    }

    private static double? ParseWeightGrams(string text)
    {
        // Preferred: the pre-summed total. Bambu Studio writes
        // "total filament weight [g]"; Orca/Prusa write "total filament used [g]".
        var total = Regex.Match(text, @"total filament (?:weight|used)\s*\[g\]\s*[:=]\s*([\d.]+)", Opts);
        if (total.Success &&
            double.TryParse(total.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var t))
            return t;

        // Fallback: per-extruder list like "12.34, 5.67" — sum it.
        var each = Regex.Match(text, @"(?<!total )filament used\s*\[g\]\s*[:=]\s*([\d.,\s]+)", Opts);
        if (each.Success)
        {
            double sum = 0;
            var any = false;
            foreach (var part in each.Groups[1].Value.Split(',', ';'))
            {
                if (double.TryParse(part.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var v))
                {
                    sum += v;
                    any = true;
                }
            }
            if (any) return sum;
        }

        return null;
    }

    private static int? ParseEstimatedMinutes(string text)
    {
        // Different slicers word this differently; try each in priority order.
        // Bambu puts two of these on one line ("model printing time: 4m 55s;
        // total estimated time: 12m 14s"), so we capture only up to the next
        // ';' or line break rather than the rest of the line.
        string[] labels =
        {
            @"total estimated time",                       // Bambu Studio (preferred)
            @"estimated printing time \(normal mode\)",    // Prusa / Orca
            @"estimated printing time",
            @"model printing time",                        // Bambu (excludes prep) — last resort
        };

        foreach (var label in labels)
        {
            var m = Regex.Match(text, label + @"\s*[:=]\s*([^\r\n;]+)", Opts);
            if (m.Success)
            {
                var minutes = ParseDurationToMinutes(m.Groups[1].Value);
                if (minutes is > 0) return minutes;
            }
        }
        return null;
    }

    /// Turns strings like "1d 2h 5m 30s", "1h 23m", "45m 12s" into whole
    /// minutes (rounded up so a 30s tail still books a minute).
    private static int? ParseDurationToMinutes(string raw)
    {
        raw = raw.Trim();
        int days = GrabUnit(raw, 'd');
        int hours = GrabUnit(raw, 'h');
        int mins = GrabUnit(raw, 'm');
        int secs = GrabUnit(raw, 's');

        if (days == 0 && hours == 0 && mins == 0 && secs == 0)
            return null;

        var total = ((days * 24 + hours) * 60) + mins + (secs > 0 ? 1 : 0);
        return total;
    }

    private static int GrabUnit(string text, char unit)
    {
        var m = Regex.Match(text, $@"(\d+)\s*{unit}", RegexOptions.IgnoreCase);
        return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }
}
