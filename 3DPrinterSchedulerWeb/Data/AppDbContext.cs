using _3DPrinterSchedulerWeb.Models;
using Microsoft.EntityFrameworkCore;

namespace _3DPrinterSchedulerWeb.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<Booking> Bookings { get; set; }
        public DbSet<Filament> Filaments { get; set; }
        public DbSet<ClassGroup> ClassGroups { get; set; }
        public DbSet<Printer> Printers { get; set; }
        public DbSet<AdminUser> AdminUsers { get; set; }
        public DbSet<AppSetting> AppSettings { get; set; }
    }
}