using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace SlicerBookingHelper;

/// Verifies the 6-digit booking code the student reads off the scheduler toast.
/// This class is duplicated VERBATIM from the 3DPrinterSchedulerWeb project so
/// an offline slicing PC can validate the code without any network connection.
///
/// IMPORTANT: if you change the algorithm or the default secret here, change it
/// in 3DPrinterSchedulerWeb/BookingCodes.cs too or the codes will stop matching.
public static class BookingCodes
{
    /// Derives a deterministic 6-digit code from the print weight, keyed by a
    /// shared secret. The weight is rounded to whole grams so the slicer and the
    /// scheduler agree even if the typed value differs slightly.
    public static string Generate(double grams, string secret)
    {
        int canonical = Math.Max(1, (int)Math.Round(grams, MidpointRounding.AwayFromZero));

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical.ToString(CultureInfo.InvariantCulture)));

        // Fixed byte order so the value is identical regardless of CPU endianness.
        uint n = ((uint)hash[0] << 24) | ((uint)hash[1] << 16) | ((uint)hash[2] << 8) | hash[3];
        return (n % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    }
}
