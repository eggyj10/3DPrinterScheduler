using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace _3DPrinterSchedulerWeb
{
    /// Generates the 6-digit booking code shown after a booking is made.
    /// The same algorithm runs in the Slicer Booking Helper, so an offline
    /// slicing PC can verify the code without any network connection.
    ///
    /// IMPORTANT: this class is duplicated verbatim in the SlicerBookingHelper
    /// project. If you change the algorithm or the default secret here, change
    /// it there too or the codes will stop matching.
    public static class BookingCodes
    {
        /// Derives a deterministic 6-digit code from the print weight, keyed by
        /// a shared secret. The weight is rounded to whole grams so the slicer
        /// and the scheduler agree even if the typed value differs slightly.
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
}
