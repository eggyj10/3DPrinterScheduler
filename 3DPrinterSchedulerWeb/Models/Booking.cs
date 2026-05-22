namespace _3DPrinterSchedulerWeb.Models
{
    public class Booking
    {
        public int Id { get; set; }
        public string StudentName { get; set; } = "";
        public string StudentClass { get; set; } = "";
        public string PrinterName { get; set; } = "";
        public string Date { get; set; } = "";       // stored as "yyyy-MM-dd"
        public string StartTime { get; set; } = "";  // stored as "HH:mm"
        public string EndTime { get; set; } = "";
        public string FilamentType { get; set; } = "";
        public double WeightGrams { get; set; }
        public double Price { get; set; }
        public string BookingType { get; set; } = "booking"; // booking / maintenance / unavailable
    }
}
